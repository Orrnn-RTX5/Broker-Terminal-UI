#!/usr/bin/env bash
set -euo pipefail

if [ -z "${IMAGE_REF:-}" ]; then
  echo "IMAGE_REF is required." >&2
  exit 1
fi

if [ -n "${BROKER_JSON_B64:-}" ]; then
  broker_json="$(printf '%s' "$BROKER_JSON_B64" | base64 -d)"
elif [ -t 0 ]; then
  echo "Broker JSON must be provided through BROKER_JSON_B64 or stdin." >&2
  exit 1
else
  broker_json="$(cat)"
fi

export DEBIAN_FRONTEND=noninteractive

if ! command -v jq >/dev/null 2>&1; then
  apt-get update
  apt-get install -y jq
fi

require_field() {
  local jq_filter="$1"
  local value
  value="$(jq -r "$jq_filter // empty" <<<"$broker_json")"
  if [ -z "$value" ] || [ "$value" = "null" ]; then
    echo "Missing required broker field: ${jq_filter}" >&2
    exit 1
  fi
  printf '%s' "$value"
}

broker_id="$(require_field '.id')"
domain="$(require_field '.domain')"
app_port="$(require_field '.app_port')"
container_name="$(jq -r '.services.frontend.container_name // ("rtx5-webterminal-" + .id)' <<<"$broker_json")"
health_path="$(jq -r '.services.frontend.health_path // "/"' <<<"$broker_json")"
listen_host="${app_port%:*}"
listen_port="${app_port##*:}"
managed_dir="/etc/nginx/rtx5-managed"
managed_include="${managed_dir}/*.conf"
vhost_path="${managed_dir}/${domain}.conf"
env_dir="/etc/rtx5/env"
env_file="${env_dir}/${broker_id}.env"
docker_env_file_arg=""

extract_hostname() {
  local value="$1"
  value="${value#http://}"
  value="${value#https://}"
  value="${value%%/*}"
  value="${value%%:*}"
  printf '%s' "$value"
}

write_services_vhost() {
  local services_domain="$1"
  local with_ssl="$2"
  local gateway_origin="$3"
  local manager_origin="$4"
  local feed_origin="$5"
  local services_vhost_path="${managed_dir}/${services_domain}.conf"

  if [ "$with_ssl" = "true" ]; then
    cat > "$services_vhost_path" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${services_domain};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${services_domain};

    ssl_certificate /etc/letsencrypt/live/${services_domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${services_domain}/privkey.pem;

    set \$cors_origin "";
    if (\$http_origin ~* "^https://(webterminal|manager|admin)\\.growtradingacademy\\.com$") {
        set \$cors_origin \$http_origin;
    }

    proxy_hide_header Access-Control-Allow-Origin;
    proxy_hide_header Access-Control-Allow-Credentials;
    proxy_hide_header Access-Control-Allow-Methods;
    proxy_hide_header Access-Control-Allow-Headers;
    proxy_hide_header Access-Control-Max-Age;
    proxy_hide_header Vary;

    add_header Access-Control-Allow-Origin \$cors_origin always;
    add_header Access-Control-Allow-Credentials "true" always;
    add_header Access-Control-Allow-Methods "GET, POST, PUT, PATCH, DELETE, OPTIONS" always;
    add_header Access-Control-Allow-Headers "Authorization, Content-Type, X-API-Key, X-Requested-With, Accept, Origin" always;
    add_header Vary "Origin" always;

    if (\$request_method = OPTIONS) {
        return 204;
    }

    location = /health {
        proxy_pass ${gateway_origin}/health;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
    }

    location = /api/config {
        proxy_pass ${gateway_origin}/api/v2/broker/config;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header X-API-Key \$http_x_api_key;
    }

    location = /api/v2/symbols {
        proxy_pass ${gateway_origin}/api/v2/instruments;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header X-API-Key \$http_x_api_key;
    }

    location = /api/v1/symbols {
        proxy_pass ${gateway_origin}/api/v2/instruments;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header X-API-Key \$http_x_api_key;
    }

    location = /manager/api/v2/symbols {
        proxy_pass ${gateway_origin}/api/v2/instruments;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header X-API-Key \$http_x_api_key;
    }

    location /api/v2/ {
        proxy_pass ${gateway_origin};
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header X-API-Key \$http_x_api_key;
    }

    location /manager/ {
        proxy_pass ${manager_origin}/;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Authorization \$http_authorization;
        proxy_set_header X-API-Key \$http_x_api_key;
    }

    location = /ws/v2 {
        proxy_pass ${gateway_origin}/ws/v2;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }

    location /ws/feed {
        proxy_pass ${feed_origin}/ws/feed;
        proxy_http_version 1.1;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
  else
    cat > "$services_vhost_path" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${services_domain};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass ${gateway_origin};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
    }
}
EOF
  fi
}

if ! command -v docker >/dev/null 2>&1; then
  apt-get update
  apt-get install -y ca-certificates curl gnupg
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg | gpg --dearmor -o /etc/apt/keyrings/docker.gpg
  chmod a+r /etc/apt/keyrings/docker.gpg
  . /etc/os-release
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi

apt-get update
apt-get install -y nginx certbot python3-certbot-nginx

mkdir -p "$managed_dir"

if ! grep -RqsF "$managed_include" /etc/nginx/nginx.conf /etc/nginx/conf.d/*.conf 2>/dev/null; then
  cp /etc/nginx/nginx.conf /etc/nginx/nginx.conf.rtx5.bak
  awk -v include_line="    include /etc/nginx/rtx5-managed/*.conf;" '
    BEGIN { inserted = 0 }
    /^[[:space:]]*http[[:space:]]*\{/ {
      print
      print include_line
      inserted = 1
      next
    }
    { print }
    END {
      if (inserted == 0) {
        exit 2
      }
    }
  ' /etc/nginx/nginx.conf > /etc/nginx/nginx.conf.rtx5
  mv /etc/nginx/nginx.conf.rtx5 /etc/nginx/nginx.conf
fi

backend_url="$(jq -r '.backend_url // .env.API_HOST // .env.VITE_API_HOST // empty' <<<"$broker_json")"
services_domain="$(jq -r '.services.backend.domain // .services_domain // empty' <<<"$broker_json")"
if [ -z "$services_domain" ] && [ -n "$backend_url" ]; then
  services_domain="$(extract_hostname "$backend_url")"
fi

if [ -n "$services_domain" ] && [ "$services_domain" != "$domain" ]; then
  gateway_host="$(jq -r '.services.backend.gateway_host // .backend_host // "127.0.0.1"' <<<"$broker_json")"
  gateway_port="$(jq -r '.services.backend.gateway_port // .gateway_port // 8090' <<<"$broker_json")"
  manager_host="$(jq -r '.services.backend.manager_host // .manager_backend_host // "127.0.0.1"' <<<"$broker_json")"
  manager_port="$(jq -r '.services.backend.manager_port // .manager_backend_port // .backend_port // 8091' <<<"$broker_json")"
  feed_host="$(jq -r '.services.backend.feed_host // .feed_backend_host // "127.0.0.1"' <<<"$broker_json")"
  feed_port="$(jq -r '.services.backend.feed_port // .feed_backend_port // 8094' <<<"$broker_json")"
  gateway_origin="http://${gateway_host}:${gateway_port}"
  manager_origin="http://${manager_host}:${manager_port}"
  feed_origin="http://${feed_host}:${feed_port}"

  if [ -d "/etc/letsencrypt/live/${services_domain}" ]; then
    write_services_vhost "$services_domain" "true" "$gateway_origin" "$manager_origin" "$feed_origin"
  else
    write_services_vhost "$services_domain" "false" "$gateway_origin" "$manager_origin" "$feed_origin"
  fi

  nginx -t
  systemctl enable --now nginx
  systemctl reload nginx

  if [ ! -d "/etc/letsencrypt/live/${services_domain}" ]; then
    certbot --nginx --non-interactive --agree-tos --redirect --register-unsafely-without-email -d "$services_domain"
    write_services_vhost "$services_domain" "true" "$gateway_origin" "$manager_origin" "$feed_origin"
  fi
fi

cat > "$vhost_path" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        return 301 https://\$host\$request_uri;
    }
}

server {
    listen 443 ssl http2;
    listen [::]:443 ssl http2;
    server_name ${domain};

    ssl_certificate /etc/letsencrypt/live/${domain}/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/${domain}/privkey.pem;

    location / {
        proxy_pass http://${app_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Real-IP \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF

if [ ! -d "/etc/letsencrypt/live/${domain}" ]; then
  cat > "$vhost_path" <<EOF
server {
    listen 80;
    listen [::]:80;
    server_name ${domain};

    location /.well-known/acme-challenge/ {
        root /var/www/html;
    }

    location / {
        proxy_pass http://${app_port};
        proxy_http_version 1.1;
        proxy_set_header Host \$host;
        proxy_set_header Real-IP \$remote_addr;
        proxy_set_header X-Real-IP \$remote_addr;
        proxy_set_header X-Forwarded-For \$proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto \$scheme;
        proxy_set_header Upgrade \$http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_read_timeout 3600s;
        proxy_send_timeout 3600s;
    }
}
EOF
fi

nginx -t
systemctl enable --now nginx
systemctl reload nginx

if [ ! -d "/etc/letsencrypt/live/${domain}" ]; then
  certbot --nginx --non-interactive --agree-tos --redirect --register-unsafely-without-email -d "$domain"
fi

if [ -n "${GHCR_USERNAME:-}" ] && [ -n "${GHCR_TOKEN:-}" ]; then
  printf '%s' "$GHCR_TOKEN" | docker login ghcr.io -u "$GHCR_USERNAME" --password-stdin
fi

if jq -e '.env? | type == "object"' <<<"$broker_json" >/dev/null; then
  mkdir -p "$env_dir"
  jq -r '
    .env
    | to_entries[]
    | select(.value != null)
    | if ((.key | test("^[A-Za-z_][A-Za-z0-9_]*$")) | not) then
        error("invalid broker env key: " + .key)
      elif ((.value | type) == "array" or (.value | type) == "object") then
        error("arrays and objects are not supported in broker env values")
      elif ((.value | tostring) | test("[\r\n]")) then
        error("multiline broker env values are not supported")
      else
        .key + "=" + (.value | tostring)
      end
  ' <<<"$broker_json" > "$env_file"
  chmod 600 "$env_file"
  docker_env_file_arg="$env_file"
else
  rm -f "$env_file"
fi

docker pull "$IMAGE_REF"
docker rm -f "$container_name" >/dev/null 2>&1 || true
if [ -n "$docker_env_file_arg" ]; then
  docker run -d \
    --name "$container_name" \
    --restart unless-stopped \
    --label "rtx5.broker_id=${broker_id}" \
    --label "rtx5.domain=${domain}" \
    --env-file "$docker_env_file_arg" \
    -p "${listen_host}:${listen_port}:80" \
    "$IMAGE_REF"
else
  docker run -d \
    --name "$container_name" \
    --restart unless-stopped \
    --label "rtx5.broker_id=${broker_id}" \
    --label "rtx5.domain=${domain}" \
    -p "${listen_host}:${listen_port}:80" \
    "$IMAGE_REF"
fi

nginx -t
systemctl reload nginx

for attempt in 1 2 3 4 5; do
  if curl -fsS "http://${app_port}${health_path}" >/dev/null; then
    echo "Deployed ${broker_id} at https://${domain}"
    exit 0
  fi
  sleep 3
done

echo "Deployment finished, but local health check failed for http://${app_port}${health_path}" >&2
exit 1
