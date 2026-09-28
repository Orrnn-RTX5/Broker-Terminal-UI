#!/bin/sh
set -eu

html_dir="${NGINX_HTML_DIR:-/usr/share/nginx/html}"
runtime_config="${html_dir}/runtime-config.js"
index_template="${NGINX_INDEX_TEMPLATE:-/etc/nginx/rtx-index.template.html}"
runtime_config_template="${NGINX_RUNTIME_CONFIG_TEMPLATE:-/etc/nginx/rtx-runtime-config.template.js}"
inline_helper="${NGINX_INLINE_HELPER:-/etc/nginx/inline-runtime-config.awk}"

if [ ! -r "${index_template}" ] || [ ! -r "${inline_helper}" ]; then
  printf '%s\n' 'RTX runtime config: missing readable index template or inlining helper' >&2
  exit 1
fi

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

# The Vite build is the validated, complete base configuration. Deployment
# variables are a sparse overlay: a partial override must never replace other
# built values with generic fallbacks. Requiring the base also fails closed if
# an incomplete/incorrect image reaches this entrypoint.
if [ ! -r "${runtime_config_template}" ] || [ ! -s "${runtime_config_template}" ]; then
  printf '%s\n' 'RTX runtime config: missing readable nonempty built runtime configuration' >&2
  exit 1
fi
cp "${runtime_config_template}" "${runtime_tmp}"

backend_target="${BACKEND_TARGET:-${VITE_BACKEND_TARGET:-${BACKEND_MODE:-${VITE_BACKEND_MODE:-}}}}"
api_host="${API_HOST:-${VITE_API_HOST:-${VITE_API_URL:-${VITE_BACKEND_URL:-}}}}"
api_host_ext="${API_HOST_EXT:-${VITE_API_HOST_EXT:-${VITE_API_URL_EXT:-${VITE_BACKEND_URL_EXT:-}}}}"
ws_host="${WS_HOST:-${VITE_WS_HOST:-${VITE_WS_URL:-}}}"
default_mt5_server="${DEFAULT_MT5_SERVER:-${VITE_DEFAULT_MT5_SERVER:-}}"
shared_discovery_base_url="${SHARED_DISCOVERY_BASE_URL:-${VITE_SHARED_DISCOVERY_BASE_URL:-}}"
discovery_base_url="${DISCOVERY_BASE_URL:-${VITE_DISCOVERY_BASE_URL:-${VITE_BROKER_DISCOVERY_URL:-$shared_discovery_base_url}}}"
broker_id="${BROKER_ID:-${VITE_BROKER_ID:-}}"
feed_broker_id="${FEED_BROKER_ID:-${VITE_FEED_BROKER_ID:-}}"
use_mock_discovery="${USE_MOCK_DISCOVERY:-${VITE_USE_MOCK_DISCOVERY:-}}"

if [ -n "${backend_target}${api_host}${api_host_ext}${ws_host}${default_mt5_server}${discovery_base_url}${broker_id}${feed_broker_id}${use_mock_discovery}" ]; then
  cat >> "${runtime_tmp}" <<'EOF'
;(function () {
  if ((window.electron && window.electron.window) || window.electronAPI
      || window.location.protocol === 'file:' || navigator.userAgent.indexOf('Electron') !== -1) return;
  var config = Object.assign({}, window.__RTX_RUNTIME_CONFIG__ || window.RUNTIME_CONFIG || window.__RUNTIME_CONFIG__ || {});
EOF

  append_string_override() {
    override_key="$1"
    override_value="$(js_string "$2")"
    printf "  config.%s = '%s';\n" "${override_key}" "${override_value}" >> "${runtime_tmp}"
  }

  if [ -n "${backend_target}" ]; then
    append_string_override BACKEND_TARGET "${backend_target}"
  fi
  if [ -n "${api_host}" ]; then
    append_string_override API_HOST "$(trim_url "${api_host}")"
  fi
  if [ -n "${api_host_ext}" ]; then
    append_string_override API_HOST_EXT "$(trim_url "${api_host_ext}")"
  fi
  if [ -n "${ws_host}" ]; then
    append_string_override WS_HOST "$(trim_url "${ws_host}")"
  fi
  if [ -n "${default_mt5_server}" ]; then
    append_string_override DEFAULT_MT5_SERVER "${default_mt5_server}"
  fi
  if [ -n "${discovery_base_url}" ]; then
    normalized_discovery_base_url="$(trim_url "${discovery_base_url}")"
    append_string_override DISCOVERY_BASE_URL "${normalized_discovery_base_url}"
    append_string_override BROKER_DISCOVERY_URL "${normalized_discovery_base_url}"
  fi
  if [ -n "${broker_id}" ]; then
    append_string_override BROKER_ID "${broker_id}"
    append_string_override VITE_BROKER_ID "${broker_id}"
    # A broker identity override owns the feed identity unless deployment
    # supplies the latter independently.
    if [ -z "${feed_broker_id}" ]; then
      feed_broker_id="${broker_id}"
    fi
  fi
  if [ -n "${feed_broker_id}" ]; then
    append_string_override FEED_BROKER_ID "${feed_broker_id}"
  fi
  if [ -n "${use_mock_discovery}" ]; then
    printf '  config.USE_MOCK_DISCOVERY = %s;\n' "$(js_bool "${use_mock_discovery}")" >> "${runtime_tmp}"
  fi

  cat >> "${runtime_tmp}" <<'EOF'
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
