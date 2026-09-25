#!/bin/sh
set -eu

html_dir="${NGINX_HTML_DIR:-/usr/share/nginx/html}"
runtime_config="${html_dir}/runtime-config.js"
index_template="${NGINX_INDEX_TEMPLATE:-/etc/nginx/rtx-index.template.html}"
inline_helper="${NGINX_INLINE_HELPER:-/etc/nginx/inline-runtime-config.awk}"

if [ ! -r "${index_template}" ] || [ ! -r "${inline_helper}" ]; then
  printf '%s\n' 'RTX runtime config: missing readable index template or inlining helper' >&2
  exit 1
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
  # The sentinel retains trailing newlines. Iterate bytes so Unicode line
  # separators and every ASCII control character produce valid JS strings.
  printf '%s_' "$1" | LC_ALL=C awk -v BINMODE=3 '
    { if (NR > 1) value = value "\n"; value = value $0 }
    END {
      value = substr(value, 1, length(value) - 1)
      for (n = 1; n < 32; n++) control[sprintf("%c", n)] = sprintf("\\u%04x", n)
      for (i = 1; i <= length(value); i++) {
        c = substr(value, i, 1)
        sequence = substr(value, i, 3)
        if (sequence == sprintf("%c%c%c", 226, 128, 168)) { printf "%s", "\\u2028"; i += 2 }
        else if (sequence == sprintf("%c%c%c", 226, 128, 169)) { printf "%s", "\\u2029"; i += 2 }
        else if (c == "\\") printf "%s", "\\\\"
        else if (c == sprintf("%c", 39)) printf "%s", "\\u0027"
        else if (c == "<") printf "%s", "\\u003c"
        else if (c in control) printf "%s", control[c]
        else printf "%s", c
      }
    }
  '
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

mkdir -p "${html_dir}"
runtime_tmp="$(mktemp "${html_dir}/.runtime-config.XXXXXX")"
index_tmp=''
trap 'rm -f "$runtime_tmp" "$index_tmp"' 0
trap 'exit 1' HUP INT TERM
index_tmp="$(mktemp "${html_dir}/.index.XXXXXX")"

# Preserve the selected build broker unless deployment explicitly overrides it.
# Keep the HTML template pristine so every container restart can inline again.
if [ -f "${runtime_config}" ] && [ -z "${BROKER_ID:-}${VITE_BROKER_ID:-}${FEED_BROKER_ID:-}${VITE_FEED_BROKER_ID:-}${API_HOST:-}${VITE_API_HOST:-}${VITE_API_URL:-}${VITE_BACKEND_URL:-}" ]; then
  cp "${runtime_config}" "${runtime_tmp}"
else
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

# Separate assignments let set -e catch any encoder failure before publication;
# a failed command substitution inside a successful cat would otherwise hide it.
js_backend_target="$(js_string "$backend_target")"
js_api_host="$(js_string "$api_host")"
js_api_host_ext="$(js_string "$api_host_ext")"
js_ws_host="$(js_string "$ws_host")"
js_default_mt5_server="$(js_string "$default_mt5_server")"
js_discovery_base_url="$(js_string "$discovery_base_url")"
js_broker_id="$(js_string "$broker_id")"
js_feed_broker_id="$(js_string "$feed_broker_id")"
js_use_mock_discovery="$(js_bool "$use_mock_discovery")"

cat > "${runtime_tmp}" <<EOF
(function () {
  if ((window.electron && window.electron.window) || window.electronAPI
      || window.location.protocol === 'file:' || navigator.userAgent.indexOf('Electron') !== -1) return;
  var config = {
    BACKEND_TARGET: '${js_backend_target}',
    API_HOST: '${js_api_host}',
    API_HOST_EXT: '${js_api_host_ext}',
    WS_HOST: '${js_ws_host}',
    DEFAULT_MT5_SERVER: '${js_default_mt5_server}',
    DISCOVERY_BASE_URL: '${js_discovery_base_url}',
    BROKER_ID: '${js_broker_id}',
    VITE_BROKER_ID: '${js_broker_id}',
    FEED_BROKER_ID: '${js_feed_broker_id}',
    USE_MOCK_DISCOVERY: ${js_use_mock_discovery}
  };

  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
EOF
fi

# Publish only after the configuration and the one expected script replacement
# succeed. Each rename is atomic and Nginx starts only after this script exits.
RTX_RUNTIME_CONFIG_FILE="${runtime_tmp}" awk -v BINMODE=3 -f "${inline_helper}" "${index_template}" > "${index_tmp}"
chmod 644 "${runtime_tmp}" "${index_tmp}"
mv -f "${runtime_tmp}" "${runtime_config}"
mv -f "${index_tmp}" "${html_dir}/index.html"
