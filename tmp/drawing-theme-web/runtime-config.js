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
  "API_HOST": "https://nexa.orrnn.com",
  "API_HOST_EXT": "https://nexa.orrnn.com",
  "WS_HOST": "wss://nexa.orrnn.com",
  "DEFAULT_MT5_SERVER": "100.119.182.26",
  "DISCOVERY_BASE_URL": "https://fxtrustsuperbackned.orrnn.com",
  "BROKER_DISCOVERY_URL": "https://fxtrustsuperbackned.orrnn.com",
  "BROKER_ID": "Nexa",
  "VITE_BROKER_ID": "Nexa",
  "FEED_BROKER_ID": "Nexa",
  "FEED_BROKER_TOKEN": "",
  "USE_MOCK_DISCOVERY": false
};
  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
