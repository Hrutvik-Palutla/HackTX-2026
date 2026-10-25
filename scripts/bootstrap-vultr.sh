#!/usr/bin/env bash
# Run on the existing Ubuntu server after uploading this repository to /opt/sidequest.
set -euo pipefail
site_address=${1:?Usage: bootstrap-vultr.sh DOMAIN_OR_:80 APP_ORIGIN}
app_origin=${2:?Provide the canonical http://IP or https://domain origin}
if [[ $(id -u) != 0 ]]; then
  printf '%s\n' 'Run with sudo on the target server.' >&2
  exit 1
fi
if [[ ! -f /etc/os-release ]]; then exit 1; fi
. /etc/os-release
if [[ ${ID:-} != ubuntu ]]; then
  printf '%s\n' 'This bootstrap supports Ubuntu; adapt installation to the actual server OS first.' >&2
  exit 1
fi
if [[ ! $site_address =~ ^([A-Za-z0-9][A-Za-z0-9.-]*|:80)$ ]]; then
  printf '%s\n' 'Use a domain name or :80 for SITE_ADDRESS.' >&2
  exit 1
fi
cd /opt/sidequest
if [[ ! -f compose.yaml ]]; then
  printf '%s\n' 'Upload the deployment files to /opt/sidequest first.' >&2
  exit 1
fi
export DEBIAN_FRONTEND=noninteractive
apt-get update
apt-get install -y ca-certificates curl openssl python3
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  docker_arch=$(dpkg --print-architecture)
  docker_codename=${UBUNTU_CODENAME:-$VERSION_CODENAME}
  cat > /etc/apt/sources.list.d/docker.sources <<SOURCES
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: $docker_codename
Components: stable
Architectures: $docker_arch
Signed-By: /etc/apt/keyrings/docker.asc
SOURCES
  apt-get update
  apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
fi
systemctl enable --now docker
# Preserve existing secrets and provider settings on subsequent deployments.
if [[ ! -f .env.production ]]; then
  umask 077
  python3 - "$site_address" "$app_origin" <<'PY'
import base64,secrets,sys
from urllib.parse import urlsplit
site,origin=sys.argv[1:]
parsed=urlsplit(origin)
if parsed.scheme not in ('http','https') or not parsed.hostname or parsed.username or parsed.password or parsed.query or parsed.fragment or parsed.path not in ('','/'):
    raise SystemExit('Provide a plain http(s) origin with no path, credentials, or query.')
if site != ':80' and (parsed.scheme != 'https' or parsed.hostname != site):
    raise SystemExit('The HTTPS origin must match the domain.')
lines={'SITE_ADDRESS':site,'APP_BASE_URL':origin.rstrip('/'),'BETTER_AUTH_URL':origin.rstrip('/'),'BETTER_AUTH_SECRET':secrets.token_hex(32),'APP_ENCRYPTION_KEY':base64.b64encode(secrets.token_bytes(32)).decode(),'PHONE_LOOKUP_HMAC_KEY':secrets.token_hex(32),'DATABASE_URL':''}
with open('.env.production','x') as f:
    for key,value in lines.items(): f.write(f'{key}={value}\n')
PY
fi
chmod 600 .env.production
docker compose --env-file .env.production config --quiet
docker compose --env-file .env.production up -d --build --wait --wait-timeout 180
docker compose --env-file .env.production ps
printf '%s\n' 'Deployment started. Verify the public URL and /health/live. Accounts still require the shared database and private OTP integration.'
