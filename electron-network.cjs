'use strict';

const BROKER_WEBSOCKET_PATH = /^\/ws\/(?:feed|v2)\/?$/i;

function isBrokerWebSocketRequest(details = {}) {
    if (details.resourceType !== 'webSocket') return false;

    try {
        const parsed = new URL(String(details.url || ''));
        return (parsed.protocol === 'ws:' || parsed.protocol === 'wss:')
            && BROKER_WEBSOCKET_PATH.test(parsed.pathname);
    } catch {
        return false;
    }
}

function sanitizeBrokerWebSocketHeaders(details = {}) {
    const requestHeaders = { ...(details.requestHeaders || {}) };
    if (!isBrokerWebSocketRequest(details)) return requestHeaders;

    for (const name of Object.keys(requestHeaders)) {
        if (name.toLowerCase() === 'origin') {
            delete requestHeaders[name];
        }
    }

    return requestHeaders;
}

function registerBrokerWebSocketOriginPolicy(webRequest) {
    webRequest.onBeforeSendHeaders(
        { urls: ['<all_urls>'], types: ['webSocket'] },
        (details, callback) => {
            callback({ requestHeaders: sanitizeBrokerWebSocketHeaders(details) });
        }
    );
}

module.exports = {
    isBrokerWebSocketRequest,
    registerBrokerWebSocketOriginPolicy,
    sanitizeBrokerWebSocketHeaders,
};
