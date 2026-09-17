# Adyen Payment Demo

Static Adyen Checkout demos with a zero-dependency Node.js server that proxies
Checkout API calls to Adyen.

## Requirements

- Node.js 20 or later
- An Adyen API key, client key, and merchant account

## Run locally

1. Create a `.env` file:

   ```dotenv
   ADYEN_ENVIRONMENT=test
   ADYEN_API_KEY=your_adyen_api_key
   ADYEN_CLIENT_KEY=your_adyen_client_key
   ADYEN_MERCHANT_ACCOUNT=your_merchant_account
   API_VERSION=v71
   PORT=3000
   ```

   For live payments, set `ADYEN_ENVIRONMENT=live` and provide
   `ENDPOINT_PREFIX`.

2. Start the application:

   ```bash
   node --env-file=.env server.js
   ```

   Open http://localhost:3000.

## Heroku

This repository needs no npm dependencies. Heroku detects the Node.js runtime
from `package.json` and runs `web: node server.js` from the `Procfile`.

Set the required environment variables as Heroku config vars:

```bash
heroku config:set ADYEN_ENVIRONMENT=test
heroku config:set ADYEN_API_KEY=your_adyen_api_key
heroku config:set ADYEN_CLIENT_KEY=your_adyen_client_key
heroku config:set ADYEN_MERCHANT_ACCOUNT=your_merchant_account
```

To run the Procfile locally with the Heroku CLI:

```bash
heroku local web -p 3000
```

Use publicly valid HTTPS for payment redirects and Apple Pay domain verification.
