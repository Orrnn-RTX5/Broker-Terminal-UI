(function () {
  var config = {
    BACKEND_TARGET: 'web',
    API_HOST: 'https://services.growtradingacademy.com',
    API_HOST_EXT: 'https://services.growtradingacademy.com',
    WS_HOST: 'wss://services.growtradingacademy.com',
    DEFAULT_MT5_SERVER: 'FlexyMarkets-Server',
    DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
    USE_MOCK_DISCOVERY: false
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
