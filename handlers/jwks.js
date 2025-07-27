// handlers/jwks.js
//
// GET /jwks.json  –  publishes the broker’s public key(s) in JWKS format
//
// Put your JWKS in an env var (stringified) or in a JSON file you `require`.
// One key is enough; rotate by adding a new element with a new "kid" and
// keep the old one until all issued tokens have expired.
//
// ────────────────────────────────────────────────────────────────────────────

const enableLoggingDebug = process.env.EnableLoggingDebug === 'true';

/**
 * Option A – Load from env var (recommended in Lambda)
 *   AWS →  JWKS_JSON='{"keys":[{...}]}'    # one-liner
 */
let jwks;
if (process.env.JWKS_JSON) {
  jwks = JSON.parse(process.env.JWKS_JSON);
} else {
    jwks = {
      keys: [
        {"kty":"RSA","use":"sig","alg":"RS256","kid":"1","n":"8c4-Aq9Zu9imsyxLsc8oK_nmxUZ5suhoXMyo3II-BlPBiuRMy7usa2M3zE17D_9rPGx6p4fV8gd8Q24U6skafj11jJlw6XTLfgCY4pwj0Y-MXV6ljkUc-9LIU1CAPhEHULror-kIp4v0pfgB4V_ENKa1GuwPMI8BuQEcv_mRuGTn56MQDih2UFqAT-lSLT_oghbOkAD_JQlIZ0LY1mcnhRsE9hT5YPM0MD-RjqXvWi9Ct1TA_2hYV7RYYMTCP1anUT5IuKxb0vySjyd9G-YSX102yvoyGes5tfPrVtLhcZ3TTr7xGYduAOjVnJ8xXJkfUwKsKQUTSfApbl9AmtQGNQ","e":"AQAB"}
      ],
    };
}

exports.handler = async () => {
  enableLoggingDebug && console.debug('Running JWKS handler');

  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      // Tell Cognito / browsers to cache for 1 day
      'Cache-Control': 'public, max-age=86400, immutable',
    },
    body: JSON.stringify(jwks),
  };
};
