const enableLoggingDebug = process.env.EnableLoggingDebug === 'true';

exports.handler = async () => {
  enableLoggingDebug && console.debug('Running OIDC configuration handler');

  const ISSUER = process.env.OIDC_ISSUER_URL; // e.g. https://api.your-domain.com/discord

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'public, max-age=3600',
    },
    body: JSON.stringify({
      issuer: ISSUER,
      authorization_endpoint: `${ISSUER}/authorize`,
      token_endpoint:         `${ISSUER}/token`,
      userinfo_endpoint:      `${ISSUER}/userinfo`,
      jwks_uri:               `${ISSUER}/jwks.json`,
      response_types_supported: ['code'],
      subject_types_supported:  ['public'],
      id_token_signing_alg_values_supported: ['RS256'],
      scopes_supported: ['openid', 'email', 'profile'],
      token_endpoint_auth_methods_supported: ['client_secret_post'],
    }),
  };
};