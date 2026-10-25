# Automatic Vultr deployment

GitHub Actions workflow: `.github/workflows/deploy.yml`.

- Pull requests to `main`: type checking, account unit tests, PostgreSQL integration test, production build, and desktop/mobile browser tests.
- Pushes to `main`: the same checks, then automatic deployment to the existing Vultr server.
- Manual re-deployment: run the workflow with `workflow_dispatch` on `main`.

The repository has deployment secrets `VULTR_HOST`, `VULTR_SSH_KEY`, and `VULTR_KNOWN_HOSTS`. They are configured through GitHub's secret API; the private key never enters Git. CI pins the SSH host key. Vultr API credentials and the root password are not used by the workflow.

Each deployment uploads the exact commit to `/opt/sidequest/releases/<SHA>`. The server builds the image while the current container continues running, then switches containers and checks liveness. Deployments are serialized in GitHub and with a server-side lock. If replacement health checks fail, the script restores the previous image and Compose configuration. The successful release is recorded in `/opt/sidequest/deployed-revision`, `/opt/sidequest/current`, and the image's OCI revision label. Older releases/images are retained for recovery.

Application environment stays in `/opt/sidequest/.env.production` with restricted permissions. It is not uploaded from the laptop and is outside each release's build context. Certificates persist in Caddy volumes. Database migrations are intentionally not applied automatically by this workflow; Part 2 owns their integration.

[Workflow runs](https://github.com/Hrutvik-Palutla/HackTX-2026/actions/workflows/deploy.yml).

The current public URL is `http://144.202.19.9/plans?preview=1`. Configure a domain and update the server's `SITE_ADDRESS`, `APP_BASE_URL`, and `BETTER_AUTH_URL` for HTTPS before enabling live private/account/provider flows. CI preserves those server values.
