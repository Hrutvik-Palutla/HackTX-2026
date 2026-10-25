#!/usr/bin/env bash
# Server-side release switch. Preserve environment, volumes and the previous working release.
set -euo pipefail
release_id=${1:?Provide a commit SHA or release identifier}
if [[ ! $release_id =~ ^[A-Za-z0-9][A-Za-z0-9._-]{6,80}$ ]]; then
  printf '%s\n' 'Invalid release identifier.' >&2
  exit 1
fi
release_dir="/opt/sidequest/releases/$release_id"
env_file=/opt/sidequest/.env.production
[[ -f "$release_dir/compose.yaml" && -f "$env_file" ]]
# Serializes manual deployments as well as CI deployments.
exec 9>/opt/sidequest/.deploy.lock
flock -w 900 9
export APP_ENV_FILE="$env_file"
export DEPLOY_RELEASE="$release_id"
if python3 -c 'from pathlib import Path; import sys; lines=Path(sys.argv[1]).read_text().splitlines(); sys.exit(0 if any(line.startswith("DATABASE_URL=") and line.split("=",1)[1].strip().strip(chr(34)+chr(39)) for line in lines) else 1)' "$env_file"; then
 export COMPOSE_PROFILES=live
fi
previous_dir=/opt/sidequest
if [[ -L /opt/sidequest/current ]]; then previous_dir=$(readlink -f /opt/sidequest/current); fi
previous_image=$(docker inspect --format '{{.Image}}' sidequest-web-1 2>/dev/null || true)
previous_worker_image=$(docker inspect --format '{{.Image}}' sidequest-worker-1 2>/dev/null || true)
compose() { docker compose --project-name sidequest --env-file "$env_file" --project-directory "$1" -f "$1/compose.yaml" "${@:2}"; }
origin=$(python3 -c 'from pathlib import Path; import sys; print(next(line.split("=",1)[1].strip().strip(chr(34)+chr(39)) for line in Path(sys.argv[1]).read_text().splitlines() if line.startswith("APP_BASE_URL=")))' "$env_file")
[[ $origin =~ ^https?://[A-Za-z0-9][A-Za-z0-9.:/-]*$ ]]
printf 'Building revision %s while the current container remains running.\n' "$release_id"
export COMPOSE_PARALLEL_LIMIT=1
compose "$release_dir" build
if compose "$release_dir" up -d --no-build --wait --wait-timeout 180 && curl --fail --silent --show-error --max-time 15 --retry 8 --retry-delay 3 --retry-connrefused "$origin/health/live" && { [[ ${COMPOSE_PROFILES:-} != live ]] || curl --fail --silent --show-error --max-time 15 --retry 3 --retry-delay 3 "$origin/health/ready"; }; then
 ln -sfnT "$release_dir" /opt/sidequest/current
 printf '%s\n' "$release_id" > /opt/sidequest/deployed-revision
 printf '\nDeployed revision %s\n' "$release_id"
 compose "$release_dir" ps
else
 printf '%s\n' 'Deployment did not become healthy. Restoring the previous container.' >&2
 if [[ -n $previous_image && -f "$previous_dir/compose.yaml" ]]; then
  docker tag "$previous_image" sidequest-web:local
  if [[ -n $previous_worker_image ]]; then docker tag "$previous_worker_image" sidequest-worker:local; fi
  if [[ -z $previous_worker_image ]]; then docker rm -f sidequest-worker-1 2>/dev/null || true; fi
  compose "$previous_dir" up -d --no-build --wait --wait-timeout 180
 fi
 exit 1
fi
