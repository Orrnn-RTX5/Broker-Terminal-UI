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
if grep -q 'runtime-config-validator[.]js' "${index_template}" &&
    { [ ! -r "${html_dir}/runtime-config-validator.js" ] || [ ! -s "${html_dir}/runtime-config-validator.js" ]; }; then
  printf '%s\n' 'RTX runtime config: missing readable nonempty runtime configuration validator' >&2
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
  printf '%s' "$1" | sed -e 's/^[[:space:]]*//' -e 's/[[:space:]]*$//' -e 's:/*$::'
}

mkdir -p "${html_dir}"
runtime_tmp="$(mktemp "${html_dir}/.runtime-config.XXXXXX")"
index_tmp=''
trap 'rm -f "$runtime_tmp" "$index_tmp"' 0
trap 'exit 1' HUP INT TERM
index_tmp="$(mktemp "${html_dir}/.index.XXXXXX")"

# Container configuration is complete deployment input, never a sparse overlay
# on a broker compiled into the image. An explicitly empty canonical value must
# not be rescued by a VITE_ alias or by the previous generated file.
backend_target="${BACKEND_TARGET-${BACKEND_MODE-${VITE_BACKEND_TARGET-${VITE_BACKEND_MODE-web}}}}"
api_host="${API_HOST-${API_URL-${BACKEND_URL-${RTX5_API_URL-${API_V2_URL-${FIX_API_URL-${VITE_API_HOST-${VITE_API_URL-${VITE_BACKEND_URL-${VITE_RTX5_API_URL-${VITE_API_V2_URL-${VITE_FIX_API_URL-}}}}}}}}}}}}"
api_host_ext="${API_HOST_EXT-${API_URL_EXT-${BACKEND_URL_EXT-${VITE_API_HOST_EXT-${VITE_API_URL_EXT-${VITE_BACKEND_URL_EXT-$api_host}}}}}}"
ws_host="${WS_HOST-${WS_URL-${RTX5_WS_URL-${MARKET_WS_URL-${FIX_WS_URL-${VITE_WS_HOST-${VITE_WS_URL-${VITE_RTX5_WS_URL-${VITE_MARKET_WS_URL-${VITE_FIX_WS_URL-}}}}}}}}}}"
default_mt5_server="${DEFAULT_MT5_SERVER-${VITE_DEFAULT_MT5_SERVER-}}"
discovery_base_url="${DISCOVERY_BASE_URL-${BROKER_DISCOVERY_URL-${SHARED_DISCOVERY_BASE_URL-${VITE_DISCOVERY_BASE_URL-${VITE_BROKER_DISCOVERY_URL-${VITE_SHARED_DISCOVERY_BASE_URL-}}}}}}"
broker_id="${BROKER_ID-${VITE_BROKER_ID-}}"
feed_broker_id="${FEED_BROKER_ID-${VITE_FEED_BROKER_ID-$broker_id}}"
allowed_broker_origins="${BROKER_ALLOWED_ORIGINS-${VITE_BROKER_ALLOWED_ORIGINS-}}"
use_mock_discovery="${USE_MOCK_DISCOVERY-${VITE_USE_MOCK_DISCOVERY-false}}"
public_candle_bridge="${PUBLIC_CANDLE_BRIDGE-${VITE_PUBLIC_CANDLE_BRIDGE-false}}"
public_market_api="${PUBLIC_MARKET_API-${VITE_PUBLIC_MARKET_API-gateway-v2}}"
broker_name="${BROKER_NAME-${VITE_BROKER_NAME-}}"
broker_logo_url="${BROKER_LOGO_URL-${VITE_BROKER_LOGO_URL-}}"
broker_login_hero_url="${BROKER_LOGIN_HERO_URL-${VITE_BROKER_LOGIN_HERO_URL-}}"
broker_login_hero_mobile_url="${BROKER_LOGIN_HERO_MOBILE_URL-${VITE_BROKER_LOGIN_HERO_MOBILE_URL-}}"
broker_terms_url="${BROKER_TERMS_URL-${VITE_BROKER_TERMS_URL-}}"

config_error() {
  printf 'RTX runtime config: %s\n' "$1" >&2
  exit 1
}

require_value() {
  if [ -z "$2" ] || ! printf '%s' "$2" | LC_ALL=C grep -q '[^[:space:]]'; then
    config_error "missing required deployment setting $1"
  fi
}

# Basic startup URL validation protects the generated page before Nginx starts.
# The browser additionally parses URL syntax and validates the pinned identity.
# No broker hostname naming convention or broker-specific domain list is used.
secure_origin() {
  printf '%s' "$1" | LC_ALL=C awk -v expected="$2" '
    BEGIN { RS = "\034" }
    {
      value = $0
      if (value ~ /[[:space:]\001-\037\177@?#\\]/) exit 1
      if (tolower(substr(value, 1, length(expected) + 3)) != expected "://") exit 1
      rest = substr(value, length(expected) + 4)
      slash = index(rest, "/")
      authority = tolower(slash ? substr(rest, 1, slash - 1) : rest)
      if (authority == "" || authority ~ /[^a-z0-9.:[\]-]/) exit 1
      # Bracketed IPv6 and DNS authorities use the same URL parser downstream.
      if (authority !~ /^\[[0-9a-f:]+\](:[0-9]+)?$/ && authority !~ /^[a-z0-9.-]+(:[0-9]+)?$/) exit 1
      host = authority
      sub(/:[0-9]+$/, "", host)
      if (host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host ~ /[.]localhost$/) exit 1
      if (authority ~ /:[0-9]+$/) {
        port = authority
        sub(/^.*:/, "", port)
        if (port + 0 < 1 || port + 0 > 65535) exit 1
      }
      sub(/:443$/, "", authority)
      printf "https://%s", authority
    }
  '
}

require_value API_HOST "$api_host"
require_value WS_HOST "$ws_host"
require_value BROKER_ID "$broker_id"
require_value DEFAULT_MT5_SERVER "$default_mt5_server"
[ "$(printf '%s' "$broker_id" | LC_ALL=C tr -d '[:cntrl:]')" = "$broker_id" ] || config_error 'BROKER_ID must not contain control characters'
case "$(printf '%s' "$backend_target" | tr '[:upper:]' '[:lower:]')" in
  web|browser|public) ;;
  *) config_error 'web containers require BACKEND_TARGET=web' ;;
esac
[ "$(js_bool "$use_mock_discovery")" = false ] || config_error 'mock discovery is not allowed in a production container'
case "$public_market_api" in
  gateway-v2|mt5-bridge-v1) ;;
  *) config_error 'PUBLIC_MARKET_API must be gateway-v2 or mt5-bridge-v1' ;;
esac

api_host="$(trim_url "$api_host")"
api_host_ext="$(trim_url "$api_host_ext")"
[ -n "$api_host_ext" ] || api_host_ext="$api_host"
ws_host="$(trim_url "$ws_host")"
discovery_base_url="$(trim_url "$discovery_base_url")"
api_origin="$(secure_origin "$api_host" https)" || config_error 'API_HOST must be a valid HTTPS URL without credentials, query, or fragment'
ext_origin="$(secure_origin "$api_host_ext" https)" || config_error 'API_HOST_EXT must be a valid HTTPS URL without credentials, query, or fragment'
ws_origin="$(secure_origin "$ws_host" wss)" || config_error 'WS_HOST must be a valid WSS URL without credentials, query, or fragment'
if [ -n "$discovery_base_url" ]; then
  secure_origin "$discovery_base_url" https > /dev/null || config_error 'DISCOVERY_BASE_URL must be a valid HTTPS URL without credentials, query, or fragment'
fi
validate_public_url() {
  asset_label="$1"
  asset_url="$2"
  [ -n "$asset_url" ] || return 0
  # Asset URLs may contain CDN version queries/fragments and path characters.
  # Credentials are checked in the URL authority, never by scanning its path.
  case "$asset_url" in
    [Hh][Tt][Tt][Pp][Ss]://*) ;;
    *) config_error "$asset_label must be a valid HTTPS URL without credentials" ;;
  esac
  logo_authority="${asset_url#*://}"
  logo_authority="${logo_authority%%/*}"
  logo_authority="${logo_authority%%\?*}"
  logo_authority="${logo_authority%%#*}"
  secure_origin "https://${logo_authority}" https > /dev/null || config_error "$asset_label must be a valid HTTPS URL without credentials"
}
validate_public_url BROKER_LOGO_URL "$broker_logo_url"
validate_public_url BROKER_LOGIN_HERO_URL "$broker_login_hero_url"
validate_public_url BROKER_LOGIN_HERO_MOBILE_URL "$broker_login_hero_mobile_url"
validate_public_url BROKER_TERMS_URL "$broker_terms_url"

broker_origin_allowed() {
  [ "$1" = "$api_origin" ] && return 0
  while IFS= read -r origin; do
    [ -n "$origin" ] || continue
    parsed_origin="$(secure_origin "$(trim_url "$origin")" https)" || return 1
    [ "$1" = "$parsed_origin" ] && return 0
  done <<EOF
$(printf '%s' "$allowed_broker_origins" | tr ',' '\n')
EOF
  return 1
}

# Validate every supplied allowlist entry, including unused entries. This list
# authorizes only explicitly configured endpoints for this deployment broker.
if [ -n "$allowed_broker_origins" ]; then
  printf '%s' "$allowed_broker_origins" | tr ',' '\n' | while IFS= read -r origin || [ -n "$origin" ]; do
    [ -n "$origin" ] || exit 1
    secure_origin "$(trim_url "$origin")" https > /dev/null || exit 1
  done || config_error 'BROKER_ALLOWED_ORIGINS must contain valid comma-separated HTTPS origins'
fi
broker_origin_allowed "$ext_origin" || config_error 'API_HOST_EXT belongs to an unconfigured broker origin'
broker_origin_allowed "$ws_origin" || config_error 'WS_HOST belongs to an unconfigured broker origin'

# Discovery aliases may not silently choose conflicting catalog authorities.
for discovery_alias in "${DISCOVERY_BASE_URL-}" "${BROKER_DISCOVERY_URL-}" "${VITE_DISCOVERY_BASE_URL-}" "${VITE_BROKER_DISCOVERY_URL-}" "${SHARED_DISCOVERY_BASE_URL-}" "${VITE_SHARED_DISCOVERY_BASE_URL-}"; do
  [ -z "$discovery_alias" ] && continue
  [ "$(trim_url "$discovery_alias")" = "$discovery_base_url" ] || config_error 'discovery settings disagree'
done

cat > "${runtime_tmp}" <<'EOF'
// Generated only from public deployment settings at container startup.
(function () {
  if ((window.electron && window.electron.window) || window.electronAPI
      || window.location.protocol === 'file:' || navigator.userAgent.indexOf('Electron') !== -1) return;
  var config = { CONFIG_SOURCE: 'deployment', PINNED_BROKER: true, CONFIG_ERRORS: [] };
EOF

  append_string_setting() {
    override_key="$1"
    override_value="$(js_string "$2")"
    printf "  config.%s = '%s';\n" "${override_key}" "${override_value}" >> "${runtime_tmp}"
  }

  append_string_setting BACKEND_TARGET "$backend_target"
  append_string_setting API_HOST "$api_host"
  append_string_setting API_HOST_EXT "$api_host_ext"
  append_string_setting WS_HOST "$ws_host"
  append_string_setting DEFAULT_MT5_SERVER "$default_mt5_server"
  append_string_setting DISCOVERY_BASE_URL "$discovery_base_url"
  append_string_setting BROKER_DISCOVERY_URL "$discovery_base_url"
  append_string_setting BROKER_ID "$broker_id"
  append_string_setting VITE_BROKER_ID "$broker_id"
  append_string_setting FEED_BROKER_ID "$feed_broker_id"
  append_string_setting BROKER_ALLOWED_ORIGINS "$allowed_broker_origins"
  append_string_setting BROKER_NAME "$broker_name"
  append_string_setting BROKER_LOGO_URL "$broker_logo_url"
  append_string_setting BROKER_LOGIN_HERO_URL "$broker_login_hero_url"
  append_string_setting BROKER_LOGIN_HERO_MOBILE_URL "$broker_login_hero_mobile_url"
  append_string_setting BROKER_TERMS_URL "$broker_terms_url"
  append_string_setting PUBLIC_MARKET_API "$public_market_api"
  printf '  config.USE_MOCK_DISCOVERY = false;\n' >> "${runtime_tmp}"
  printf '  config.PUBLIC_CANDLE_BRIDGE = %s;\n' "$(js_bool "$public_candle_bridge")" >> "${runtime_tmp}"

  cat >> "${runtime_tmp}" <<'EOF'
  window.__RTX_RUNTIME_CONFIG__ = config;
  window.RUNTIME_CONFIG = config;
  window.__RUNTIME_CONFIG__ = config;
})();
EOF

# Publish only after the configuration and the one expected script replacement
# succeed. Each rename is atomic and Nginx starts only after this script exits.
RTX_RUNTIME_CONFIG_FILE="${runtime_tmp}" awk -v BINMODE=3 -f "${inline_helper}" "${index_template}" > "${index_tmp}"
chmod 644 "${runtime_tmp}" "${index_tmp}"
mv -f "${runtime_tmp}" "${runtime_config}"
mv -f "${index_tmp}" "${html_dir}/index.html"
