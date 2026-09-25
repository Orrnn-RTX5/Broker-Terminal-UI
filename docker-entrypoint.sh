#!/bin/sh
set -eu

html_dir="${NGINX_HTML_DIR:-/usr/share/nginx/html}"
runtime_config="${html_dir}/runtime-config.js"

# An image built with .env.web already contains its selected broker. Only an
# explicit deployment broker/backend should replace that generated selection.
if [ -f "${runtime_config}" ] && [ -z "${BROKER_ID:-}${VITE_BROKER_ID:-}${FEED_BROKER_ID:-}${VITE_FEED_BROKER_ID:-}${API_HOST:-}${VITE_API_HOST:-}${VITE_API_URL:-}${VITE_BACKEND_URL:-}" ]; then
  exit 0
fi

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

trim_url() {
  printf '%s' "$1" | sed 's:/*$::'
}

backend_target="$(resolve_backend_target)"
api_host="${API_HOST:-${VITE_API_HOST:-${VITE_API_URL:-${VITE_BACKEND_URL:-https://backend.orrnn.com}}}}"
api_host_ext="${API_HOST_EXT:-${VITE_API_HOST_EXT:-${VITE_API_URL_EXT:-${VITE_BACKEND_URL_EXT:-$api_host}}}}"
ws_host="${WS_HOST:-${VITE_WS_HOST:-${VITE_WS_URL:-wss://backend.orrnn.com}}}"
default_mt5_server="${DEFAULT_MT5_SERVER:-${VITE_DEFAULT_MT5_SERVER:-backend.orrnn.com:443}}"
shared_discovery_base_url="${SHARED_DISCOVERY_BASE_URL:-${VITE_SHARED_DISCOVERY_BASE_URL:-https://superbackend.orrnn.com}}"
discovery_base_url="${DISCOVERY_BASE_URL:-${VITE_DISCOVERY_BASE_URL:-${VITE_BROKER_DISCOVERY_URL:-$shared_discovery_base_url}}}"
broker_id="${BROKER_ID:-${VITE_BROKER_ID:-${FEED_BROKER_ID:-${VITE_FEED_BROKER_ID:-}}}}"
feed_broker_id="${FEED_BROKER_ID:-${VITE_FEED_BROKER_ID:-$broker_id}}"
if [ "$(trim_url "$discovery_base_url")" = "$(trim_url "$api_host")" ] || [ "$(trim_url "$discovery_base_url")" = "$(trim_url "$api_host_ext")" ]; then
  discovery_base_url="$shared_discovery_base_url"
fi
use_mock_discovery="${USE_MOCK_DISCOVERY:-${VITE_USE_MOCK_DISCOVERY:-false}}"

mkdir -p "${html_dir}"
cat > "${runtime_config}" <<EOF
(function () {
  if ((window.electron && window.electron.window) || window.electronAPI
      || window.location.protocol === 'file:' || navigator.userAgent.indexOf('Electron') !== -1) return;
  var config = {
    BACKEND_TARGET: '$(js_string "$backend_target")',
    API_HOST: '$(js_string "$api_host")',
    API_HOST_EXT: '$(js_string "$api_host_ext")',
    WS_HOST: '$(js_string "$ws_host")',
    DEFAULT_MT5_SERVER: '$(js_string "$default_mt5_server")',
    DISCOVERY_BASE_URL: '$(js_string "$discovery_base_url")',
    BROKER_ID: '$(js_string "$broker_id")',
    VITE_BROKER_ID: '$(js_string "$broker_id")',
    FEED_BROKER_ID: '$(js_string "$feed_broker_id")',
    USE_MOCK_DISCOVERY: $(js_bool "$use_mock_discovery")
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
EOF

