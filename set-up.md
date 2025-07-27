## 🛠️ Quick Setup Guide

> A zero‑to‑login checklist to get the Discord ↔ Cognito broker running.

---

### 0. Prerequisites

| Tool / Account                                                                             | Why you need it                                         |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------- |
| **AWS CLI** (configured)                                                                   | To create the secret and deploy the Lambda/API Gateway. |
| **Node 18 + npm**                                                                          | Build & install project dependencies.                   |
| **Discord Developer account**                                                              | To register your OAuth2 application.                    |
| **AWS Account** with permissions *Lambda, API Gateway, Secrets Manager, DynamoDB, Cognito* | Where the broker will run.                              |

---

### 1. Clone & Install

```bash
# Grab the source
$ git clone https://github.com/<you>/discord-cognito-oidc-broker.git
$ cd discord-cognito-oidc-broker

# Install Node dependencies (jsonwebtoken, AWS SDK v3 only)
$ npm install
```

---

### 2. Generate RSA‑256 Key Pair & JWKS

```bash
# 2.1 private key (2048 bit)
$ openssl genrsa -out discord-oidc.key 2048

# 2.2 public key (PEM)
$ openssl rsa -in discord-oidc.key -pubout -out discord-oidc.pub

# 2.3 JWKS (public) – install once: npm i -g pem-jwk
$ pem-jwk discord-oidc.pub | jq ' . + {use:"sig",alg:"RS256",kid:"1"}' \
    | jq -n '{keys:[input]}' > jwks.json
```

*Commit **`jwks.json`* → served by the broker at `/jwks.json`.

---

### 3. Store the Private Key in AWS Secrets Manager

```bash
# 3.1 create secret (plaintext)
$ aws secretsmanager create-secret \
    --name /phi-brain/discord-auth/rsa256-private-key \
    --secret-string file://discord-oidc.key
```

Create an env var that points to it:

```ini
PRIVATE_KEY_SECRET=/phi-brain/discord-auth/rsa256-private-key
```

---

### 4. Create a Discord OAuth2 Application

1. **Discord Developer Portal → New Application**
2. **OAuth2 → General**\
   • Copy **Client ID** / **Client Secret**.
3. **OAuth2 → Redirects → Add Redirect**\
   `https://<your‑cognito-domain>.auth.<region>.amazoncognito.com/oauth2/idpresponse`
4. Save.

---

### 5. Prepare Cognito

1. **User Pools → Create/Use existing**
2. **App Integration → Domain name** → create `myapp.auth.eu-west-3.amazoncognito.com`.
3. **Federation → Identity providers → OIDC → Add**\
   *Issuer* =`https://<api-gw>/discord`\
   *Client ID / Secret* = (Discord)\
   *Authorize / Token / UserInfo / JWKS* → endpoints of the broker\
   *Scopes* =`openid email`
4. **App clients → Create new (no secret)**\
   • Enable Hosted UI\
   • Allowed OAuth Flows: **Authorization code grant**\
   • Require PKCE ✅\
   • Callback URL(s): your SPA (e.g. `https://release.d2k315bn0lar5k.amplifyapp.com`)\
   • Enabled IdPs: **Cognito User Pool**, **Discord** (Google optional)

---

### 6. Deploy AWS Infrastructure

#### 6.1 DynamoDB (user mirror)

```bash
aws dynamodb create-table \
  --table-name phi-brain-users \
  --attribute-definitions \
    AttributeName=userId,AttributeType=S \
    AttributeName=email,AttributeType=S \
  --key-schema \
    AttributeName=userId,KeyType=HASH \
    AttributeName=email,KeyType=RANGE \
  --billing-mode PAY_PER_REQUEST
aws dynamodb update-continuous-backups --table-name phi-brain-users --point-in-time-recovery-specification PointInTimeRecoveryEnabled=true
```

#### 6.2 Lambda + API Gateway You can deploy manually or with SAM/Serverless. Minimum IAM policy for the Lambda role:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    { "Effect": "Allow", "Action": "secretsmanager:GetSecretValue", "Resource": "arn:aws:secretsmanager:*:*:secret:/phi-brain/discord-auth/rsa256-private-key-*" },
    { "Effect": "Allow", "Action": ["dynamodb:PutItem","dynamodb:UpdateItem"], "Resource": "arn:aws:dynamodb:*:*:table/phi-brain-users" },
    { "Effect": "Allow", "Action": [
        "cognito-idp:AdminCreateUser",
        "cognito-idp:AdminUpdateUserAttributes",
        "cognito-idp:ListUsers",
        "cognito-idp:AdminLinkProviderForUser"
      ], "Resource": "arn:aws:cognito-idp:*:*:userpool/<USER_POOL_ID>" }
  ]
}
```

Deploy the Lambda, attach the role, create a **HTTP API** or **REST API** with routes:

```
/authorize → GET  → Lambda
/token     → POST → Lambda
/userinfo  → GET  → Lambda
/.well-known/openid-configuration → GET → Lambda
/jwks.json → GET → Lambda
```

---

\### 7. `.env` Template Create `.env` from the sample:

```ini
CLIENT_ID=<discord-client-id>
CLIENT_SECRET=<discord-client-secret>
USER_POOL_ID=<cognito-user-pool-id>
OIDC_ISSUER_URL=https://<api-gw>/discord
PRIVATE_KEY_SECRET=/phi-brain/discord-auth/rsa256-private-key
USERS_DYNAMO_TABLE=phi-brain-users
REGION=eu-west-3
KEY_ID=1
EnableLoggingDebug=true
```

---

### 8. Run & Test

```bash
# invoke locally (AWS SAM / serverless offline) or hit Hosted UI
$ curl "https://<cognito-domain>.auth.<region>.amazoncognito.com/oauth2/authorize?response_type=code&client_id=<app-client>&identity_provider=Discord&redirect_uri=<spa-url>&scope=openid+email"
```

Complete Discord auth → Cognito → your SPA should receive `?code=…`. Amplify exchanges it and you’re logged in 🎉.

---

*All set! From here you can add rate‑limiting (WAF), key‑rotation, or plug other OIDC providers with almost no code changes.*

