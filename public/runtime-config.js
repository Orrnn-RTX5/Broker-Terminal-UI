(function () {
  var config = {
    BACKEND_TARGET: 'web',
    API_HOST: 'https://services.myprop.trade',
    API_HOST_EXT: 'https://services.myprop.trade',
    WS_HOST: 'wss://services.myprop.trade',
    DEFAULT_MT5_SERVER: 'MyProp-Server',
    DISCOVERY_BASE_URL: 'https://superbackend.orrnn.com',
    USE_MOCK_DISCOVERY: false
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
