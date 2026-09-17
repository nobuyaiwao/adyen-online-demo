import { createServer } from "node:http";
import { readFile, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const PROJECT_ROOT = path.dirname(fileURLToPath(import.meta.url));
const STATIC_ROOT = path.join(PROJECT_ROOT, "src");
const API_VERSION = process.env.API_VERSION || "v71";
const ADYEN_ENVIRONMENT = process.env.ADYEN_ENVIRONMENT || "test";
const REQUEST_TIMEOUT_MS = 15_000;
const MAX_REQUEST_BODY_BYTES = 10 * 1024 * 1024;
const REDACTED_LOG_VALUE = "[REDACTED]";
const SENSITIVE_LOG_FIELDS = new Set([
    "apikey",
    "authorization",
    "bankaccountnumber",
    "billingaddress",
    "cvc",
    "cvv",
    "dateofbirth",
    "deliveryaddress",
    "encryptedcardnumber",
    "encryptedexpirymonth",
    "encryptedexpiryyear",
    "encryptedsecuritycode",
    "holdername",
    "iban",
    "password",
    "payload",
    "paymentdata",
    "redirectresult",
    "sessiondata",
    "shopperemail",
    "shoppername",
    "shopperreference",
    "socialsecuritynumber",
    "telephonenumber",
    "threedsmethoddata",
    "threedsresult",
    "token",
    "url",
    "x-api-key"
]);
const MIME_TYPES = {
    ".css": "text/css; charset=utf-8",
    ".html": "text/html; charset=utf-8",
    ".ico": "image/x-icon",
    ".js": "text/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8",
    ".svg": "image/svg+xml",
    ".txt": "text/plain; charset=utf-8"
};

let latestThreeDSNotification = null;

const adyenApiUrl = () => {
    if (ADYEN_ENVIRONMENT === "test") {
        return `https://checkout-test.adyen.com/${API_VERSION}`;
    }

    const endpointPrefix = process.env.ENDPOINT_PREFIX;
    if (!endpointPrefix) {
        throw new Error("ENDPOINT_PREFIX is required in live mode.");
    }

    return `https://${endpointPrefix}-checkout-live.adyenpayments.com/checkout/${API_VERSION}`;
};

const redactForLog = (value) => {
    if (Array.isArray(value)) {
        return value.map(redactForLog);
    }
    if (value && typeof value === "object") {
        return Object.fromEntries(
            Object.entries(value).map(([key, item]) => [
                key,
                SENSITIVE_LOG_FIELDS.has(key.toLowerCase())
                    ? REDACTED_LOG_VALUE
                    : redactForLog(item)
            ])
        );
    }
    return value;
};

const logAdyenPayload = (label, method, upstreamPath, payload) => {
    console.info(
        `Adyen ${method} ${upstreamPath} ${label}:`,
        JSON.stringify(redactForLog(payload))
    );
};

const sendJson = (response, statusCode, body) => {
    response.writeHead(statusCode, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "application/json; charset=utf-8"
    });
    response.end(JSON.stringify(body));
};

const sendText = (response, statusCode, body) => {
    response.writeHead(statusCode, {
        "Access-Control-Allow-Origin": "*",
        "Content-Type": "text/plain; charset=utf-8"
    });
    response.end(body);
};

const readRequestBody = async (request) => {
    const chunks = [];
    let totalLength = 0;

    for await (const chunk of request) {
        totalLength += chunk.length;
        if (totalLength > MAX_REQUEST_BODY_BYTES) {
            throw new Error("Request body too large.");
        }
        chunks.push(chunk);
    }

    return Buffer.concat(chunks).toString("utf8");
};

const requestBody = async (request) => {
    const body = await readRequestBody(request);
    if (!body) return {};

    try {
        const parsed = JSON.parse(body);
        return parsed && typeof parsed === "object" && !Array.isArray(parsed)
            ? parsed
            : {};
    } catch {
        return {};
    }
};

const formBody = async (request) => {
    const body = await readRequestBody(request);
    return Object.fromEntries(new URLSearchParams(body));
};

const parseResponseBody = async (response) => {
    try {
        return await response.json();
    } catch {
        return "<non-JSON response>";
    }
};

const forwardAdyenRequest = async (
    response,
    method,
    upstreamPath,
    {
        body,
        params,
        errorMessage,
        preserveErrorStatus = true
    }
) => {
    try {
        const url = new URL(`${adyenApiUrl()}/${upstreamPath}`);
        for (const [key, value] of Object.entries(params || {})) {
            url.searchParams.set(key, value);
        }

        logAdyenPayload("request", method, upstreamPath, { body, params });
        const upstreamResponse = await fetch(url, {
            method,
            headers: {
                "Content-Type": "application/json",
                "X-API-Key": process.env.ADYEN_API_KEY || ""
            },
            body: body ? JSON.stringify(body) : undefined,
            signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
        });
        const responseBody = await parseResponseBody(upstreamResponse);
        logAdyenPayload("response", method, upstreamPath, {
            body: responseBody,
            status: upstreamResponse.status
        });

        if (!upstreamResponse.ok) {
            sendJson(
                response,
                preserveErrorStatus ? upstreamResponse.status : 500,
                { error: errorMessage }
            );
            return;
        }

        sendJson(response, upstreamResponse.status, responseBody);
    } catch (error) {
        console.error(`Adyen request to ${upstreamPath} failed:`, error.message);
        sendJson(response, 500, { error: errorMessage });
    }
};

const requestOrigin = (request) => {
    const trustProxy = Number(process.env.TRUSTED_PROXY_COUNT || "0") > 0;
    const forwardedProtocol = request.headers["x-forwarded-proto"];
    const forwardedHost = request.headers["x-forwarded-host"];
    const protocol = trustProxy && forwardedProtocol
        ? forwardedProtocol.split(",")[0].trim()
        : "http";
    const host = trustProxy && forwardedHost
        ? forwardedHost.split(",")[0].trim()
        : request.headers.host;

    return `${protocol}://${host}`;
};

const handleApiRequest = async (request, response, pathname) => {
    if (request.method === "GET" && pathname === "/api/config") {
        sendJson(response, 200, {
            clientKey: process.env.ADYEN_CLIENT_KEY || "test_xxxxxxxxxxxxx",
            environment: ADYEN_ENVIRONMENT
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/paymentMethods") {
        const body = await requestBody(request);
        body.merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
        await forwardAdyenRequest(response, "POST", "paymentMethods", {
            body,
            errorMessage: "Failed to fetch payment methods",
            preserveErrorStatus: false
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/payments") {
        const body = await requestBody(request);
        if (body.recurringProcessingModel === "" || body.recurringProcessingModel === undefined) {
            delete body.recurringProcessingModel;
        }
        body.merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
        await forwardAdyenRequest(response, "POST", "payments", {
            body,
            errorMessage: "Failed to process payment"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/payments/details") {
        await forwardAdyenRequest(response, "POST", "payments/details", {
            body: await requestBody(request),
            errorMessage: "Failed to process additional details"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/storedPaymentMethods") {
        const body = await requestBody(request);
        if (!body.shopperReference) {
            sendJson(response, 400, { error: "Missing shopperReference" });
            return true;
        }

        await forwardAdyenRequest(response, "GET", "storedPaymentMethods", {
            params: {
                merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
                shopperReference: body.shopperReference
            },
            errorMessage: "Failed to fetch stored payment methods"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/sessions") {
        const body = await requestBody(request);
        body.merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
        body.returnUrl = body.returnUrl || `${requestOrigin(request)}/return`;
        body.channel = "Web";
        await forwardAdyenRequest(response, "POST", "sessions", {
            body,
            errorMessage: "Failed to create session"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/balance") {
        const body = await requestBody(request);
        body.amount = body.amount || { currency: "USD", value: 2000 };
        body.merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
        await forwardAdyenRequest(response, "POST", "paymentMethods/balance", {
            body,
            errorMessage: "Failed to check balance"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/orders") {
        const body = await requestBody(request);
        await forwardAdyenRequest(response, "POST", "orders", {
            body: {
                amount: body.amount,
                merchantAccount: process.env.ADYEN_MERCHANT_ACCOUNT,
                reference: `order-${new Date().toISOString()}`
            },
            errorMessage: "Failed to create order"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/api/orders/cancel") {
        const body = await requestBody(request);
        body.merchantAccount = process.env.ADYEN_MERCHANT_ACCOUNT;
        await forwardAdyenRequest(response, "POST", "orders/cancel", {
            body,
            errorMessage: "Failed to cancel order"
        });
        return true;
    }

    if (request.method === "POST" && pathname === "/own-3ds/notification") {
        const contentType = request.headers["content-type"] || "";
        const body = contentType.includes("application/json")
            ? await requestBody(request)
            : await formBody(request);
        const notification = {
            threeDSMethodData: body.threeDSMethodData,
            cres: body.cres
        };

        if (!notification.threeDSMethodData && !notification.cres) {
            sendText(response, 400, "Invalid request");
            return true;
        }

        latestThreeDSNotification = notification;
        response.writeHead(200, { "Access-Control-Allow-Origin": "*" });
        response.end();
        return true;
    }

    if (request.method === "GET" && pathname === "/own-3ds/notification-check") {
        sendJson(response, 200, latestThreeDSNotification || {});
        return true;
    }

    return false;
};

const serveStaticFile = async (request, response, pathname) => {
    let decodedPath;
    try {
        decodedPath = decodeURIComponent(pathname);
    } catch {
        sendText(response, 404, "Not found");
        return;
    }

    const relativePath = decodedPath === "/"
        ? "index.html"
        : decodedPath.replace(/^\/+/, "");
    let candidate = path.resolve(STATIC_ROOT, relativePath);
    const staticRootWithSeparator = `${STATIC_ROOT}${path.sep}`;
    if (candidate !== STATIC_ROOT && !candidate.startsWith(staticRootWithSeparator)) {
        sendText(response, 404, "Not found");
        return;
    }

    try {
        if ((await stat(candidate)).isDirectory()) {
            candidate = path.join(candidate, "index.html");
        }
        const file = await readFile(candidate);
        const contentType = MIME_TYPES[path.extname(candidate)]
            || "application/octet-stream";
        response.writeHead(200, {
            "Access-Control-Allow-Origin": "*",
            "Content-Type": contentType
        });
        if (request.method !== "HEAD") {
            response.end(file);
            return;
        }
        response.end();
    } catch {
        sendText(response, 404, "Not found");
    }
};

const createApp = () => createServer(async (request, response) => {
    const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);
    const pathname = url.pathname;

    if (request.method === "OPTIONS") {
        response.writeHead(204, {
            "Access-Control-Allow-Headers": "Content-Type",
            "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
            "Access-Control-Allow-Origin": "*"
        });
        response.end();
        return;
    }

    if (await handleApiRequest(request, response, pathname)) {
        return;
    }

    if (pathname.startsWith("/api/") || pathname.startsWith("/own-3ds/")) {
        sendText(response, 404, "Not found");
        return;
    }

    if (!["GET", "HEAD"].includes(request.method)) {
        sendText(response, 405, "Method not allowed");
        return;
    }

    await serveStaticFile(request, response, pathname);
});

if (process.argv[1] === fileURLToPath(import.meta.url)) {
    const port = Number(process.env.PORT || "3000");
    createApp().listen(port, "0.0.0.0", () => {
        console.info(`Adyen Payment Demo listening on port ${port}`);
    });
}

export { createApp };
