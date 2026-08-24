(function () {
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
    FEED_BROKER_TOKEN: 'rtx5_clp_feed_test_zFME8a4Koen-dxouADdZffWr_emD3IJuTsI49qZdvq8',
    USE_MOCK_DISCOVERY: false
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
