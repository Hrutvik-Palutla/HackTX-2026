# Vultr deployment

Target: existing Ubuntu 22.04 instance, `144.202.19.9`. Deployment preserves the instance and uses Docker Compose behind Caddy. No rebuild, reinstall, plan change, or new compute resource is needed.

## Local configuration

The Vultr API key stays in ignored local `.env` as `VULTR_API_KEY` (the existing `Vultr_API_KEY` spelling is also accepted), or in `.vultr-private/api-key`. API status output deliberately excludes initial passwords and credentials:

```sh
VULTR_INSTANCE_ID=21870759-6ec6-4372-b7fb-0d8b571b60cf \
  node --env-file=.env scripts/vultr-status.mjs
```

The dedicated deployment key lives in `.vultr-private/deploy_ed25519`. Its public half is registered in Vultr as “SideQuest deployment”. This folder is excluded from Git and Docker. Install the public key in the existing server's `/root/.ssh/authorized_keys` through the Vultr web console before the first deployment. Registering a key in Vultr alone does not add it to an already-running server. The API did not expose an initial password for this instance.

Once SSH key authentication succeeds, deploy the current local workspace, including files not yet committed:

```sh
DEPLOY_HOST=144.202.19.9 \
DEPLOY_SSH_KEY="$PWD/.vultr-private/deploy_ed25519" \
SITE_ADDRESS=:80 \
APP_BASE_URL=http://144.202.19.9 \
  bash scripts/deploy-vultr.sh
```

The upload uses an allowlist of app/build directories, excludes secrets and caches, and does not delete server-only files. It installs Docker from Docker's Ubuntu repository if missing, generates fresh application secrets on the server only if no environment file exists, builds the image, and starts the services with restart policies. Subsequent deployments preserve `/opt/sidequest/.env.production` and Caddy certificate volumes.

## Domain and HTTPS

For a domain you control, point its A record at `144.202.19.9`, then deploy initially with `SITE_ADDRESS=app.example.com` and `APP_BASE_URL=https://app.example.com`. Caddy provisions HTTPS once public DNS and ports 80/443 work. For an already-running HTTP deployment, edit the server environment file's `SITE_ADDRESS`, `APP_BASE_URL`, and `BETTER_AUTH_URL` together, then recreate the services:

```sh
cd /opt/sidequest
sudo docker compose --env-file .env.production up -d --force-recreate
```

The bootstrap intentionally does not replace existing environment values. An IP-only HTTP deployment is for the labeled public preview; use a real HTTPS origin before phone login, Calendar OAuth, wallet callbacks, or real private data.

## Operations

Only Caddy publishes host ports: 80/tcp, 443/tcp and 443/udp. Next.js port 3000 remains on the Compose network. Restrict SSH at the Vultr firewall to the deployment IP when practical. No database or wallet process is exposed publicly by this configuration.

```sh
cd /opt/sidequest
sudo docker compose --env-file .env.production ps
sudo docker compose --env-file .env.production logs --tail=100
```

`/health/live` checks the web process only and does not call a database or paid provider. Compose waits for that check before starting Caddy. Persistent certificate data uses named volumes; do not remove those volumes during routine updates.

The Docker build uses pinned Node 22.22.0, pnpm 10.18.3 and the workspace lockfile. `NEXT_STANDALONE=1` enables the monorepo-aware Next standalone output only for deployment builds; normal local builds remain compatible with `next start`. The runtime image includes public/static assets and runs as the non-root `node` user.

## Application readiness

This configuration can serve the labeled preview immediately once server access is available. Live accounts still require Part 2's shared DB/migrations and Part 3's private OTP sender. Planner, Calendar, Studio and payment APIs remain with their assigned owners. Deployment does not create pretend production accounts or apply competing schema migrations.

## Validation performed locally

- Standalone production build completed.
- The generated standalone server served `/health/live`, the preview page, its logo and static assets with HTTP 200.
- Compose configuration passed validation using placeholder environment values.
- Shell scripts passed syntax checks; Node image tag exists in the registry.
- A local Docker daemon was unavailable, so a full image build/container launch must be verified on the server after SSH setup.

References: [Next standalone output](https://nextjs.org/docs/15/app/api-reference/config/next-config-js/output), [Docker Ubuntu installation](https://docs.docker.com/engine/install/ubuntu/), [Caddy HTTPS](https://caddyserver.com/docs/automatic-https).
