(function () {
  // This file is the deployed webterminal configuration. The packaged desktop
  // loads the same index.html from file://, so it must keep the broker selected
  // by the Electron session instead of being pinned back to this web broker.
  var isElectron = Boolean(
    (window.electron && window.electron.window)
    || window.electronAPI
    || window.location.protocol === 'file:'
    || navigator.userAgent.indexOf('Electron') !== -1
  );
  if (isElectron) return;

  var config = {
    BACKEND_TARGET: 'web',
    API_HOST: 'https://service.achieverfinancials.com',
    API_HOST_EXT: 'https://service.achieverfinancials.com',
    WS_HOST: 'wss://service.achieverfinancials.com',
    DEFAULT_MT5_SERVER: 'Achiever Financials',
    DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
    BROKER_ID: 'achiever-financials',
    VITE_BROKER_ID: 'achiever-financials',
    FEED_BROKER_ID: 'achiever-financials',
    USE_MOCK_DISCOVERY: false
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
