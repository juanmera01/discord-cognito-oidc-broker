// handlers/userinfo.js
//
// GET /userinfo  – part of the OIDC broker.
//
// Cognito calls this endpoint with:
//
//   GET /userinfo
//   Authorization: Bearer <access_token>
//
// We:
//
//   1. Extract the Bearer token (it is the *Discord* access_token we
//      returned from /token).
//   2. Call Discord `/users/@me`.
//   3. Map the profile to the standard OIDC claims and return JSON.
//

const enableLoggingDebug = process.env.EnableLoggingDebug === 'true';

const DISCORD_ME_URL = 'https://discord.com/api/users/@me';

exports.handler = async (event) => {
  enableLoggingDebug && console.debug('Running OIDC userinfo handler');

  // Extract bearer token
  const authHeader = event.headers?.Authorization || event.headers?.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return {
      statusCode: 401,
      headers: { 'WWW-Authenticate': 'Bearer' },
      body: JSON.stringify({ error: 'invalid_token' }),
    };
  }
  const accessToken = authHeader.slice('Bearer '.length).trim();

  try {
    // Call Discord `/@me`
    const res = await fetch(DISCORD_ME_URL, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });

    if (!res.ok) {
      enableLoggingDebug &&
        console.debug('Discord /@me error', res.status, await res.text());
      return {
        statusCode: 401,
        body: JSON.stringify({ error: 'invalid_token' }),
      };
    }

    const profile = await res.json();
    enableLoggingDebug && console.debug('Discord profile (userinfo):', profile);

    // Map to OIDC standard claims
    const body = {
      sub:    profile.id,
      email:  profile.email,
      name:   profile.username,
      picture: profile.avatar
        ? `https://cdn.discordapp.com/avatars/${profile.id}/${profile.avatar}.png`
        : null,
    };

    return {
      statusCode: 200,
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    };

  } catch (err) {
    console.error('userinfo handler error:', err);
    return {
      statusCode: 500,
      body: JSON.stringify({ error: 'server_error' }),
    };
  }
};
