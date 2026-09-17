# Adyen Payment Demo

Flask server and static browser demos for Adyen Checkout integrations.

## Requirements

- Python 3.8 or later
- An Adyen API key, client key, and merchant account

## Run locally

1. Create and activate a virtual environment:

   ```bash
   python3 -m venv .venv
   source .venv/bin/activate
   ```

2. Install dependencies:

   ```bash
   pip install -r requirements.txt
   ```

3. Create a `.env` file:

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

4. Start the application:

   ```bash
   python server.py
   ```

   Open http://localhost:3000.

## Production

Run the application with Gunicorn:

```bash
gunicorn server:app
```

Use publicly valid HTTPS for payment redirects and Apple Pay domain verification.
