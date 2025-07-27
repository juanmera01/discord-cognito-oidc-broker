// handlers/discord-auth.js
//
// OIDC “token endpoint” for the Discord broker.
// Cognito will POST (or GET, depending on your mapping) with:
//   grant_type=authorization_code
//   code=....
//   redirect_uri=<same you used in /authorize>
//   client_id=<DISCORD CLIENT_ID>
//   client_secret=<DISCORD CLIENT_SECRET>   ← only if you set “client secret” in IdP
//
// We:
//   1. Exchange the code with Discord for an access_token.
//   2. Fetch /users/@me.
//   3. Build and SIGN an id_token (RS256, kid="1").
//   4. Return JSON { access_token, id_token, token_type, expires_in }.
//
// Extra: on first login, create user in Cognito & Dynamo; on later logins, just update lastLogin.
//
// ────────────────────────────────────────────────────────────────────────────

const crypto = require('crypto');
const { URLSearchParams } = require('url');
const jwt = require('jsonwebtoken');
const {
  CognitoIdentityProviderClient,
  ListUsersCommand,
  AdminCreateUserCommand,
  AdminUpdateUserAttributesCommand,
  AdminLinkProviderForUserCommand,
} = require('@aws-sdk/client-cognito-identity-provider');
const { DynamoDBClient } = require('@aws-sdk/client-dynamodb');
const {
  DynamoDBDocumentClient,
  PutCommand,
  UpdateCommand,
} = require('@aws-sdk/lib-dynamodb');
const { SecretsManagerClient, GetSecretValueCommand } = require('@aws-sdk/client-secrets-manager');

const secrets   = new SecretsManagerClient({});
let PRIVATE_KEY_PEM; // cache the value

async function getPrivateKey() {
  if (PRIVATE_KEY_PEM) return PRIVATE_KEY_PEM;

  const secretId = process.env.PRIVATE_KEY_SECRET;
  const res      = await secrets.send(
    new GetSecretValueCommand({ SecretId: secretId }),
  );
  PRIVATE_KEY_PEM = res.SecretString;
  return PRIVATE_KEY_PEM;
}

const {
  CLIENT_ID,
  CLIENT_SECRET,
  USER_POOL_ID,
  USERS_DYNAMO_TABLE = 'phi-brain-users',
  OIDC_PROVIDER_NAME = 'Discord',
  OIDC_ISSUER_URL,               // e.g. https://api.your-domain.com/discord
  KEY_ID = '1',                  // kid in JWKS
} = process.env;

const DISCORD_TOKEN_URL = 'https://discord.com/api/oauth2/token';
const DISCORD_ME_URL    = 'https://discord.com/api/users/@me';

const enableLoggingDebug = process.env.EnableLoggingDebug === 'true';

const cognito = new CognitoIdentityProviderClient({});
const ddbDoc  = DynamoDBDocumentClient.from(new DynamoDBClient({}));

// ── helpers ──────────────────────────────────────────────────────────
const respond = (status, bodyObj) => ({
  statusCode: status,
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify(bodyObj),
});

const fetchDiscordToken = async (code, redirectUri) => {
  const body = new URLSearchParams({
    client_id:     CLIENT_ID,
    client_secret: CLIENT_SECRET,
    grant_type:    'authorization_code',
    code,
    redirect_uri:  redirectUri, 
  });

const res = await fetch(DISCORD_TOKEN_URL, {
    method:  'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) throw new Error(`Discord token error: ${res.status}`);
  return res.json(); // { access_token, expires_in, token_type, scope }
};

const fetchDiscordProfile = async (accessToken) => {
  const res = await fetch(DISCORD_ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`Discord profile error: ${res.status}`);
  return res.json(); // { id, username, email, avatar, verified }
};


exports.handler = async (event) => {
  enableLoggingDebug && console.debug('Running OIDC token handler');

  // Accept both POST (Cognito default) and GET (if you mapped GET)
  const params = event.httpMethod === 'POST'
    ? new URLSearchParams(event.body)
    : new URLSearchParams(event.queryStringParameters || {});

  const grantType = params.get('grant_type');
  const code      = params.get('code');
  const redirectUri = params.get('redirect_uri');

  if (grantType !== 'authorization_code' || !code) {
    return respond(400, { error: 'invalid_request' });
  }

  try {
    // 1. Exchange code for access_token
    const discordTok = await fetchDiscordToken(code, redirectUri);
    const accessToken   = discordTok.access_token;
    const expiresIn     = discordTok.expires_in || 3600;

    // 2. Fetch profile
    const profile = await fetchDiscordProfile(accessToken);
    enableLoggingDebug && console.debug('Discord profile:', profile);

    const email   = profile.email || null;
    const sub     = profile.id;

    // 3. Upsert user in Cognito + Dynamo (same logic you used before)
    const userId = crypto.createHash('sha256')
                         .update(email || sub)
                         .digest('hex')
                         .slice(0, 10);

    let cognitoUsername = null;
    if (email) {
      const list = await cognito.send(new ListUsersCommand({
        UserPoolId: USER_POOL_ID,
        Filter:     `email = "${email}"`,
        Limit:      1,
      }));
      if (list.Users?.length) cognitoUsername = list.Users[0].Username;
    }

    const nowISO = new Date().toISOString();
    const usernameForCognito = email || `discord_${sub}@placeholder.local`;

    if (!cognitoUsername) { // First login
      const create = await cognito.send(new AdminCreateUserCommand({
        UserPoolId: USER_POOL_ID,
        Username:   usernameForCognito,
        UserAttributes: [
          { Name: 'email',          Value: usernameForCognito },
          { Name: 'email_verified', Value: email ? 'true' : 'false' },
          { Name: 'custom:userId',  Value: userId },
        ],
        MessageAction: 'SUPPRESS',
      }));
      cognitoUsername = create.User.Username;

      await cognito.send(new AdminLinkProviderForUserCommand({
        UserPoolId: USER_POOL_ID,
        DestinationUser: {
          ProviderName: 'Cognito',
          ProviderAttributeValue: cognitoUsername,
        },
        SourceUser: {
          ProviderName:          OIDC_PROVIDER_NAME,
          ProviderAttributeName: 'Cognito_Subject',
          ProviderAttributeValue: sub,
        },
      })).catch(() => {});

      await ddbDoc.send(new PutCommand({
        TableName: USERS_DYNAMO_TABLE,
        Item: {
          userId,
          email: usernameForCognito,
          createdAt: nowISO,
          lastLogin: nowISO,
          servers: [],
        },
      }));
    } else {
      // Subsequent login
      await cognito.send(new AdminUpdateUserAttributesCommand({
        UserPoolId: USER_POOL_ID,
        Username:   cognitoUsername,
        UserAttributes: [
          { Name: 'custom:userId', Value: userId },
        ],
      }));

      await ddbDoc.send(new UpdateCommand({
        TableName: USERS_DYNAMO_TABLE,
        Key: { userId, email: usernameForCognito },
        UpdateExpression: 'SET lastLogin = :t',
        ExpressionAttributeValues: { ':t': nowISO },
      }));
    }

    // 4. Build & sign id_token
    const privateKey = await getPrivateKey();
    const now   = Math.floor(Date.now() / 1000);
    const idTok = jwt.sign(
      {
        iss: OIDC_ISSUER_URL,
        sub,
        aud: CLIENT_ID,
        iat: now,
        exp: now + expiresIn,
        email:   profile.email,
        name:    profile.username,
        picture: `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`,
      },
      privateKey,
      { algorithm: 'RS256', keyid: KEY_ID },
    );

    enableLoggingDebug && console.debug('id_token issued');

    // 5. Return OIDC token response
    return respond(200, {
      access_token: accessToken,
      id_token:     idTok,
      token_type:   'Bearer',
      expires_in:   expiresIn,
    });

  } catch (err) {
    console.error('OIDC token handler error:', err);
    return respond(500, { error: 'server_error' });
  }
};
