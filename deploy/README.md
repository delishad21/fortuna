# Home server deployment

```
browser ─HTTPS─▶ nginx :443 (fortuna.delishad.com) ─▶ 127.0.0.1:3040 frontend ─▶ data-service, file-parser (+ sandbox), chat-worker ─▶ postgres
Hermes ─▶ 127.0.0.1:4002 finance-mcp ─▶ data-service
```

- Stack: [docker-compose.yml](../docker-compose.yml), compose project `fortuna`.
  Every image is built on the server from the deployed commit and tagged
  `fortuna-<service>:<commit>`. Nothing is pulled from Docker Hub except
  `postgres:16-alpine`.
- Settings and secrets: `~/services/fortuna/.env` on the server (mode 600),
  from [fortuna.env.example](fortuna.env.example).
- Data: `/srv/fortuna/postgres`, `/srv/fortuna/statements`,
  `/srv/fortuna/inbox`, plus the `fortuna_chat-credentials` and
  `fortuna_parser-sandbox-queue` volumes. Those two aren't backed up
  (`x-devbot.backup` in the compose file): the queue only holds transient
  jobs, and Codex sign-ins are kept out of backups (users reconnect in the app).
- Migrations: the one-shot `migrate` service runs `prisma migrate deploy`
  before data-service, chat-worker and the frontend start.
- Health: `https://fortuna.delishad.com/api/health` (checks the app and the
  database; reports the running commit).
- nginx: [nginx/fortuna.conf](nginx/fortuna.conf), with the shared
  `*.delishad.com` certificate.

## Deploying

Say `ship <task>` or run `devbot deploy fortuna`; `devbot rollback fortuna`
undoes it.

devbot uploads the commit to `~/services/fortuna/releases/<commit>/`, builds
it with `REVISION=<commit> docker compose -p fortuna build`, starts it, waits
for health and rolls back on failure.

Logs: `docker logs fortuna-frontend` (also `fortuna-data-service`,
`fortuna-file-parser`, `fortuna-parser-sandbox`, `fortuna-finance-mcp`,
`fortuna-chat-worker-1`, `fortuna-migrate-1`) and
`/var/log/nginx/fortuna_*.log`.

## First-time checklist

Fortuna already runs as Portainer stack 66. The switch keeps the project
name, container names, volumes, `/srv/fortuna` folders and ports, so all data
stays.

1. Take a database backup first:

   ```sh
   docker exec fortuna-postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > fortuna-$(date +%F).dump
   ```

2. Check where nginx sends the site. The app now listens on 127.0.0.1 only:

   ```sh
   grep -nE 'set \$(server|port)|proxy_pass' /etc/nginx/sites-enabled/fortuna.conf
   ```

   If that isn't `127.0.0.1` and `3040`, install the version from this repo
   (copy it over first: `scp deploy/nginx/fortuna.conf delishad21@192.168.1.2:/tmp/`):

   ```sh
   sudo cp /etc/nginx/sites-enabled/fortuna.conf ~/fortuna.conf.bak
   sudo cp /tmp/fortuna.conf "$(readlink -f /etc/nginx/sites-enabled/fortuna.conf)"
   sudo nginx -t && sudo systemctl reload nginx
   ```

   This can go in before the switch as long as the Portainer stack's
   `APP_BIND` is `0.0.0.0` (it then answers on 127.0.0.1:3040 too).

3. Run `devbot adopt fortuna 66` to copy the Portainer stack's environment
   into `~/services/fortuna/.env`.
4. Ship (`ship <task>` or `devbot deploy fortuna`). The first deploy stops
   and removes the Portainer stack, keeping its data, and starts the stack
   from this repo.
5. Check `https://fortuna.delishad.com/api/health`, sign in, and confirm
   Hermes still reaches the MCP gateway at `http://127.0.0.1:4002/mcp`.

## Changes from the Portainer setup

- The app is no longer reachable directly on `http://192.168.1.2:3040`; use
  `https://fortuna.delishad.com` (Pi-hole resolves it to the server on the
  LAN).
- `APP_BIND`, `APP_PORT`, `MCP_BIND`, `MCP_PORT`, `DOCKERHUB_NAMESPACE`,
  `IMAGE_TAG` and the per-service `*_IMAGE_TAG` variables are still accepted
  in `.env` but no longer do anything.
- Deprecated: the Docker Hub flow (`deployment/push-dockerhub-images.sh`,
  `scripts/portainer-stack.sh` and `deployment/README.md`, which only ever
  lived in the local, untracked checkout). Don't push `delishad21/fortuna-*`
  images or update stack 66 any more.
