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
docker_env_args=()

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
  : > "$env_file"

  env_entries="$(
    jq -r '
      .env
      | to_entries[]
      | select(.value != null)
      | if ((.value | type) == "array" or (.value | type) == "object") then
          error("arrays and objects are not supported in broker env values")
        elif ((.value | tostring) | test("[\r\n]")) then
          error("multiline broker env values are not supported")
        else
          [.key, (.value | tostring)] | @tsv
        end
    ' <<<"$broker_json"
  )"

  while IFS=$'\t' read -r key value; do
    if [ -z "$key" ]; then
      continue
    fi
    if [[ ! "$key" =~ ^[A-Za-z_][A-Za-z0-9_]*$ ]]; then
      echo "Invalid broker env key for ${broker_id}: ${key}" >&2
      exit 1
    fi
    printf '%s=%s\n' "$key" "$value" >> "$env_file"
  done <<<"$env_entries"

  chmod 600 "$env_file"
  docker_env_args+=(--env-file "$env_file")
else
  rm -f "$env_file"
fi

docker pull "$IMAGE_REF"
docker rm -f "$container_name" >/dev/null 2>&1 || true
docker run -d \
  --name "$container_name" \
  --restart unless-stopped \
  --label "rtx5.broker_id=${broker_id}" \
  --label "rtx5.domain=${domain}" \
  "${docker_env_args[@]}" \
  -p "${listen_host}:${listen_port}:80" \
  "$IMAGE_REF"

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
