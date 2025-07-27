// handlers/authorize.js
//
// GET /authorize  → 302 to Discord OAuth2 /authorize
//
// Cognito calls this endpoint and *includes its own redirect_uri*
// (…/oauth2/idpresponse). We must forward THAT SAME URI to Discord,
// otherwise the flow breaks when Discord comes back.
//
// Required env vars:
//   CLIENT_ID – Discord application client_id
//
const { URL } = require('url');

const enableLoggingDebug = process.env.EnableLoggingDebug === 'true';
const CLIENT_ID          = process.env.CLIENT_ID;               // Discord app client_id

exports.handler = async (event) => {
  enableLoggingDebug && console.debug('Running OIDC /authorize handler');

  const qs = event.queryStringParameters || {};

  // Ensure redirect_uri is present (Cognito always sends it)
  if (!qs.redirect_uri) {
    return {
      statusCode: 400,
      body: 'Missing redirect_uri',
    };
  }
  const cognitoRedirect = qs.redirect_uri;  // e.g. https://…/oauth2/idpresponse

  // Build Discord authorize URL 
  const discordURL = new URL('https://discord.com/oauth2/authorize');
  discordURL.searchParams.set('client_id',     CLIENT_ID);
  discordURL.searchParams.set('redirect_uri',  cognitoRedirect);
  discordURL.searchParams.set('response_type', 'code');
  discordURL.searchParams.set('scope',         'identify email');

  // Preserve state (CSRF) from Cognito
  if (qs.state) discordURL.searchParams.set('state', qs.state);

  // Forward PKCE & nonce if present
  ['code_challenge', 'code_challenge_method', 'nonce'].forEach(p => {
    if (qs[p]) discordURL.searchParams.set(p, qs[p]);
  });

  enableLoggingDebug && console.debug('Redirecting to Discord:', discordURL.toString());

  return {
    statusCode: 302,
    headers: { Location: discordURL.toString() },
  };
};
