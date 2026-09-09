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
    API_HOST: 'https://fxtrustbrokerbackend.orrnn.com',
    API_HOST_EXT: 'https://fxtrustbrokerbackend.orrnn.com',
    WS_HOST: 'wss://fxtrustbrokerbackend.orrnn.com',
    DEFAULT_MT5_SERVER: 'TEST',
    DISCOVERY_BASE_URL: 'https://fxtrustsuperbackned.orrnn.com',
    BROKER_ID: 'TEST',
    VITE_BROKER_ID: 'TEST',
    FEED_BROKER_ID: 'TEST',
    USE_MOCK_DISCOVERY: false
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
