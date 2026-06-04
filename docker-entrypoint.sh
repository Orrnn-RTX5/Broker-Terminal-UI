#!/bin/sh
set -eu

html_dir="${NGINX_HTML_DIR:-/usr/share/nginx/html}"
runtime_config="${html_dir}/runtime-config.js"

resolve_backend_target() {
  if [ -n "${BACKEND_TARGET:-}" ]; then
    printf '%s' "${BACKEND_TARGET}"
  elif [ -n "${VITE_BACKEND_TARGET:-}" ]; then
    printf '%s' "${VITE_BACKEND_TARGET}"
  elif [ -n "${BACKEND_MODE:-}" ]; then
    printf '%s' "${BACKEND_MODE}"
  elif [ -n "${VITE_BACKEND_MODE:-}" ]; then
    printf '%s' "${VITE_BACKEND_MODE}"
  else
    printf 'web'
  fi
}

js_string() {
  printf '%s' "$1" | sed "s/\\\\/\\\\\\\\/g; s/'/\\\\'/g; s/\r//g; s/$/\\\\n/" | tr -d '\n' | sed 's/\\n$//'
}

js_bool() {
  case "$(printf '%s' "$1" | tr '[:upper:]' '[:lower:]')" in
    1|true|yes|on) printf 'true' ;;
    *) printf 'false' ;;
  esac
}

backend_target="$(resolve_backend_target)"
api_host="${API_HOST:-${VITE_API_HOST:-${VITE_API_URL:-${VITE_BACKEND_URL:-https://services.myprop.trade}}}}"
api_host_ext="${API_HOST_EXT:-${VITE_API_HOST_EXT:-${VITE_API_URL_EXT:-${VITE_BACKEND_URL_EXT:-$api_host}}}}"
ws_host="${WS_HOST:-${VITE_WS_HOST:-${VITE_WS_URL:-wss://services.myprop.trade}}}"
default_mt5_server="${DEFAULT_MT5_SERVER:-${VITE_DEFAULT_MT5_SERVER:-MyProp-Server}}"
discovery_base_url="${DISCOVERY_BASE_URL:-${VITE_DISCOVERY_BASE_URL:-${VITE_BROKER_DISCOVERY_URL:-https://superbackend.orrnn.com}}}"
use_mock_discovery="${USE_MOCK_DISCOVERY:-${VITE_USE_MOCK_DISCOVERY:-false}}"

mkdir -p "${html_dir}"
cat > "${runtime_config}" <<EOF
(function () {
  var config = {
    BACKEND_TARGET: '$(js_string "$backend_target")',
    API_HOST: '$(js_string "$api_host")',
    API_HOST_EXT: '$(js_string "$api_host_ext")',
    WS_HOST: '$(js_string "$ws_host")',
    DEFAULT_MT5_SERVER: '$(js_string "$default_mt5_server")',
    DISCOVERY_BASE_URL: '$(js_string "$discovery_base_url")',
    USE_MOCK_DISCOVERY: $(js_bool "$use_mock_discovery")
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
EOF
