// Generated from the active Vite environment. Deployment containers may replace this file.
(function () {
  var isElectron = Boolean(
    (window.electron && window.electron.window)
    || window.electronAPI
    || window.location.protocol === 'file:'
    || navigator.userAgent.indexOf('Electron') !== -1
  );
  if (isElectron) return;

  var config = {
  "BACKEND_TARGET": "web",
  "API_HOST": "https://service.achieverfinancials.com",
  "API_HOST_EXT": "https://service.achieverfinancials.com",
  "WS_HOST": "wss://service.achieverfinancials.com",
  "DEFAULT_MT5_SERVER": "Achiever Financials",
  "DISCOVERY_BASE_URL": "https://superbackend.orrnn.com",
  "BROKER_DISCOVERY_URL": "https://superbackend.orrnn.com",
  "BROKER_ID": "achiever-financials",
  "VITE_BROKER_ID": "achiever-financials",
  "FEED_BROKER_ID": "achiever-financials",
  "FEED_BROKER_TOKEN": "",
  "USE_MOCK_DISCOVERY": false
};
  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
