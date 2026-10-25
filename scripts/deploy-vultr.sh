#!/usr/bin/env bash
# Upload the local workspace without requiring an uncommitted project to exist on GitHub.
set -euo pipefail
: "${DEPLOY_HOST:?Set DEPLOY_HOST to the instance IP or SSH hostname}"
: "${SITE_ADDRESS:?Set SITE_ADDRESS to a domain or :80}"
: "${APP_BASE_URL:?Set APP_BASE_URL to the canonical https://domain or http://IP origin}"
deploy_user=${DEPLOY_USER:-root}
if [[ ! $DEPLOY_HOST =~ ^[A-Za-z0-9][A-Za-z0-9._-]*$ || ! $deploy_user =~ ^[a-z_][a-z0-9_-]*$ ]]; then
  printf '%s\n' 'Use a plain SSH host and Unix username.' >&2
  exit 1
fi
if [[ ! $SITE_ADDRESS =~ ^([A-Za-z0-9][A-Za-z0-9.-]*|:80)$ || ! $APP_BASE_URL =~ ^https?://[A-Za-z0-9][A-Za-z0-9.:/-]*$ ]]; then
  printf '%s\n' 'Use a domain (or :80) and a plain HTTP(S) origin.' >&2
  exit 1
fi
cd "$(dirname "$0")/.."
ssh_opts=(-o BatchMode=yes -o "StrictHostKeyChecking=${DEPLOY_STRICT_HOST_KEYS:-accept-new}" -o ConnectTimeout=15)
if [[ -n ${DEPLOY_SSH_KEY:-} ]]; then ssh_opts+=(-i "$DEPLOY_SSH_KEY" -o IdentitiesOnly=yes); fi
target="$deploy_user@$DEPLOY_HOST"
release_id=${DEPLOY_RELEASE:-$(date -u +%Y%m%dT%H%M%SZ)}
if [[ ! $release_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{6,80}$ ]]; then exit 1; fi
remote_dir="/opt/sidequest/releases/$release_id"
ssh "${ssh_opts[@]}" "$target" "sudo -n install -d -m 0750 -o '$deploy_user' '$remote_dir'"
# An allowlist of app/build sources, plus explicit secret/cache exclusions.
# No --delete: server-only settings and unrelated files are preserved.
ssh_wrapper=$(mktemp /tmp/sidequest-ssh.XXXXXX)
trap 'rm -f "$ssh_wrapper"' EXIT
{
  printf '#!/usr/bin/env bash\nexec '
  printf '%q ' ssh "${ssh_opts[@]}"
  printf ' "$@"\n'
} > "$ssh_wrapper"
chmod 700 "$ssh_wrapper"
rsync -az -e "$ssh_wrapper" --exclude=node_modules --exclude=.next --exclude='.env*' --exclude='.npmrc' --exclude='*.key' --exclude='*.pem' --exclude=tests \
  Dockerfile .dockerignore compose.yaml package.json pnpm-lock.yaml pnpm-workspace.yaml apps packages infra scripts "$target:$remote_dir/"
if [[ ${BOOTSTRAP_SERVER:-0} == 1 ]]; then
  printf '%s\n' 'Bootstrap is a one-time operation; run scripts/bootstrap-vultr.sh on /opt/sidequest first.' >&2
  exit 1
fi
ssh "${ssh_opts[@]}" "$target" "sudo -n bash '$remote_dir/scripts/release-vultr.sh' '$release_id'"
printf '%s\n' "Check $APP_BASE_URL/health/live and $APP_BASE_URL/plans?preview=1"
