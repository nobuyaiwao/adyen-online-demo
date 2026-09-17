# Adyen Payment Demo

## Project layout

- `server.py` is the Flask API proxy and static-file server.
- `src/` contains standalone Adyen Checkout demo pages.
- Each payment-method demo normally has an `index.html` and matching JavaScript file.
- Shared browser helpers, including `/payments` and `/payments/details` calls, are in `src/util.js`.

## Local development

```sh
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python server.py
```

The application listens on port `3000` by default.

## Implementation guidelines

- Keep payment-method changes scoped to the relevant `src/<payment-method>/` directory.
- Use the existing `makePayment` and `makeDetails` helpers for API calls.
- Forward Adyen response actions through the component callbacks.
- Preserve `redirectResult` and other payment tokens without decoding or changing them.
- Never commit `.env` files, API keys, payment tokens, or real shopper data.

## Validation

- Run `node --check` on modified JavaScript files.
- Run `git diff --check`.
- For server changes, parse the file with `python3 -c` or run the Flask test client when dependencies are installed.
