import json
import logging
import os
from datetime import datetime, timezone
from pathlib import Path

import requests
from dotenv import load_dotenv
from flask import Flask, abort, jsonify, request, send_from_directory
from flask_cors import CORS
from werkzeug.middleware.proxy_fix import ProxyFix


load_dotenv()

PROJECT_ROOT = Path(__file__).resolve().parent
STATIC_ROOT = PROJECT_ROOT / "src"
API_VERSION = os.getenv("API_VERSION", "v71")
ADYEN_ENVIRONMENT = os.getenv("ADYEN_ENVIRONMENT", "test")
LATEST_3DS_NOTIFICATION = None
REDACTED_LOG_VALUE = "[REDACTED]"
SENSITIVE_LOG_FIELDS = frozenset(
    {
        "apikey",
#        "authorization",
#        "bankaccountnumber",
#        "billingaddress",
#        "cvc",
#        "cvv",
#        "dateofbirth",
#        "deliveryaddress",
#        "encryptedcardnumber",
#        "encryptedexpiryyear",
#        "encryptedexpirymonth",
#        "encryptedsecuritycode",
#        "holdername",
#        "iban",
#        "password",
#        "payload",
#        "paymentdata",
#        "redirectresult",
#        "sessiondata",
#        "shopperemail",
#        "shoppername",
#        "shopperreference",
#        "socialsecuritynumber",
#        "telephonenumber",
#        "threedsmethoddata",
#        "threedsresult",
#        "token",
#        "url",
        "x-api-key",
    }
)

app = Flask(__name__, static_folder=None)
CORS(app)
app.logger.setLevel(os.getenv("LOG_LEVEL", "INFO").upper())

trusted_proxy_count = int(os.getenv("TRUSTED_PROXY_COUNT", "0"))
if trusted_proxy_count:
    app.wsgi_app = ProxyFix(
        app.wsgi_app,
        x_for=trusted_proxy_count,
        x_proto=trusted_proxy_count,
        x_host=trusted_proxy_count,
    )


def adyen_api_url():
    if ADYEN_ENVIRONMENT == "test":
        return f"https://checkout-test.adyen.com/{API_VERSION}"

    endpoint_prefix = os.getenv("ENDPOINT_PREFIX")
    if not endpoint_prefix:
        raise RuntimeError("ENDPOINT_PREFIX is required in live mode.")

    return (
        f"https://{endpoint_prefix}-checkout-live.adyenpayments.com"
        f"/checkout/{API_VERSION}"
    )


def request_body():
    body = request.get_json(silent=True)
    return body if isinstance(body, dict) else {}


def adyen_headers():
    return {
        "X-API-Key": os.getenv("ADYEN_API_KEY", ""),
        "Content-Type": "application/json",
    }


def redact_for_log(value):
    if isinstance(value, dict):
        return {
            key: (
                REDACTED_LOG_VALUE
                if str(key).lower() in SENSITIVE_LOG_FIELDS
                else redact_for_log(item)
            )
            for key, item in value.items()
        }
    if isinstance(value, list):
        return [redact_for_log(item) for item in value]
    return value


def log_adyen_payload(label, method, path, payload):
    app.logger.info(
        "Adyen %s %s %s: %s",
        method,
        path,
        label,
        json.dumps(redact_for_log(payload), default=str, sort_keys=True),
    )


def response_body_for_log(response):
    try:
        return response.json()
    except ValueError:
        return "<non-JSON response>"


def adyen_request(method, path, *, json_body=None, params=None):
    return requests.request(
        method,
        f"{adyen_api_url()}/{path}",
        json=json_body,
        params=params,
        headers=adyen_headers(),
        timeout=15,
    )


def forward_adyen_request(
    method,
    path,
    *,
    json_body=None,
    params=None,
    error_message,
    preserve_error_status=True,
):
    try:
        log_adyen_payload("request", method, path, {"body": json_body, "params": params})
        response = adyen_request(method, path, json_body=json_body, params=params)
        response.raise_for_status()
        response_body = response.json()
        log_adyen_payload(
            "response",
            method,
            path,
            {"body": response_body, "status": response.status_code},
        )
        return jsonify(response_body), response.status_code
    except requests.HTTPError as error:
        status_code = (
            error.response.status_code
            if preserve_error_status and error.response is not None
            else 500
        )
        if error.response is not None:
            log_adyen_payload(
                "response",
                method,
                path,
                {
                    "body": response_body_for_log(error.response),
                    "status": error.response.status_code,
                },
            )
        app.logger.error("Adyen request to %s failed with status %s", path, status_code)
        return jsonify(error=error_message), status_code
    except (requests.RequestException, RuntimeError, ValueError):
        app.logger.exception("Adyen request to %s failed", path)
        return jsonify(error=error_message), 500


@app.get("/api/config")
def client_config():
    return jsonify(
        clientKey=os.getenv("ADYEN_CLIENT_KEY", "test_xxxxxxxxxxxxx"),
        environment=ADYEN_ENVIRONMENT,
    )


@app.post("/api/paymentMethods")
def payment_methods():
    payload = request_body()
    payload["merchantAccount"] = os.getenv("ADYEN_MERCHANT_ACCOUNT")
    return forward_adyen_request(
        "POST",
        "paymentMethods",
        json_body=payload,
        error_message="Failed to fetch payment methods",
        preserve_error_status=False,
    )


@app.post("/api/payments")
def payments():
    payload = request_body()
    if payload.get("recurringProcessingModel") in (None, ""):
        payload.pop("recurringProcessingModel", None)
    payload["merchantAccount"] = os.getenv("ADYEN_MERCHANT_ACCOUNT")
    return forward_adyen_request(
        "POST",
        "payments",
        json_body=payload,
        error_message="Failed to process payment",
    )


@app.post("/api/payments/details")
def payment_details():
    return forward_adyen_request(
        "POST",
        "payments/details",
        json_body=request_body(),
        error_message="Failed to process additional details",
    )


@app.post("/api/storedPaymentMethods")
def stored_payment_methods():
    shopper_reference = request_body().get("shopperReference")
    if not shopper_reference:
        return jsonify(error="Missing shopperReference"), 400

    return forward_adyen_request(
        "GET",
        "storedPaymentMethods",
        params={
            "merchantAccount": os.getenv("ADYEN_MERCHANT_ACCOUNT"),
            "shopperReference": shopper_reference,
        },
        error_message="Failed to fetch stored payment methods",
    )


@app.post("/api/sessions")
def sessions():
    payload = request_body()
    payload["merchantAccount"] = os.getenv("ADYEN_MERCHANT_ACCOUNT")
    payload["returnUrl"] = payload.get("returnUrl") or f"{request.url_root.rstrip('/')}/return"
    payload["channel"] = "Web"
    return forward_adyen_request(
        "POST",
        "sessions",
        json_body=payload,
        error_message="Failed to create session",
    )


@app.post("/api/balance")
def balance():
    payload = request_body()
    payload["amount"] = payload.get("amount") or {"currency": "USD", "value": 2000}
    payload["merchantAccount"] = os.getenv("ADYEN_MERCHANT_ACCOUNT")
    return forward_adyen_request(
        "POST",
        "paymentMethods/balance",
        json_body=payload,
        error_message="Failed to check balance",
    )


@app.post("/api/orders")
def orders():
    payload = request_body()
    order_payload = {
        "amount": payload.get("amount"),
        "reference": f"order-{datetime.now(timezone.utc).isoformat().replace('+00:00', 'Z')}",
        "merchantAccount": os.getenv("ADYEN_MERCHANT_ACCOUNT"),
    }
    return forward_adyen_request(
        "POST",
        "orders",
        json_body=order_payload,
        error_message="Failed to create order",
    )


@app.post("/api/orders/cancel")
def cancel_order():
    payload = request_body()
    payload["merchantAccount"] = os.getenv("ADYEN_MERCHANT_ACCOUNT")
    return forward_adyen_request(
        "POST",
        "orders/cancel",
        json_body=payload,
        error_message="Failed to cancel order",
    )


@app.post("/own-3ds/notification")
def three_ds_notification():
    global LATEST_3DS_NOTIFICATION

    payload = request_body() or request.form.to_dict(flat=True)
    notification = {
        "threeDSMethodData": payload.get("threeDSMethodData"),
        "cres": payload.get("cres"),
    }
    if not any(notification.values()):
        return "Invalid request", 400

    LATEST_3DS_NOTIFICATION = notification
    return "", 200


@app.get("/own-3ds/notification-check")
def three_ds_notification_check():
    return jsonify(LATEST_3DS_NOTIFICATION or {})


def serve_static_file(path):
    candidate = (STATIC_ROOT / path).resolve()
    try:
        candidate.relative_to(STATIC_ROOT.resolve())
    except ValueError:
        abort(404)

    if candidate.is_dir():
        candidate /= "index.html"
    if not candidate.is_file():
        abort(404)

    return send_from_directory(
        STATIC_ROOT,
        candidate.relative_to(STATIC_ROOT).as_posix(),
    )


@app.get("/")
def index():
    return serve_static_file("index.html")


@app.get("/<path:path>")
def static_files(path):
    return serve_static_file(path)


if __name__ == "__main__":
    logging.basicConfig(level=os.getenv("LOG_LEVEL", "INFO"))
    app.run(host="0.0.0.0", port=int(os.getenv("PORT", "3000")))
