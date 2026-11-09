# Recover a Logtastiq Unraid deployment

Use this runbook when the Unraid Compose Manager project files are missing but
the containers or appdata remain. It restores a repeatable deployment from the
repository and host-only `.env`; it does not recover lost Warcraft Logs
credentials or repair a missing database.

## Guardrails

- Do not run `docker compose down --volumes`, `docker volume prune`, or
  `docker system prune` during recovery.
- Do not start a second stack on the existing host port while the old frontend
  is running.
- Keep the current image references, host port, database path, and Warcraft
  Logs settings until they have been compared with the live deployment.
- Never print or copy `.env` values into logs, issues, or Git. Report required
  variable names and whether they are populated only.
- A recovered Compose file is not a reviewed deployment plan. Compare its
  rendered service names, image references, host ports, and data mounts before
  recreating any container.

## 1. Record the live state without exposing credentials

On Unraid, find the running service containers and record their image names,
immutable image digests, Compose project/service labels, published ports,
mount source paths, restart policy, and running/health status. For example:

```sh
docker ps --format '{{.Names}}|{{.Image}}|{{.Status}}'
docker inspect --format '{{.Config.Image}} {{.Image}} {{json .Config.Labels}}' CONTAINER
docker inspect --format '{{range .Mounts}}{{.Source}} -> {{.Destination}} (rw={{.RW}}){{println}}{{end}}' CONTAINER
docker inspect --format '{{json .HostConfig.PortBindings}}' CONTAINER
```

If checking environment configuration, print variable names only:

```sh
docker inspect CONTAINER | jq -r '.[0].Config.Env[] | split("=")[0]' | sort -u
```

Do not use unrestricted `docker inspect` output in tickets or terminal
transcripts; it contains environment values. Identify the database file inside
the mounted host data directory and verify that it exists before changing the
stack.

## 2. Locate the canonical deployment files

Use this repository's `docker-compose.unraid.yml` and `.env.unraid.example` as
the maintained source. Keep the actual `.env` on Unraid, outside Git, with mode
`0600` and owner `root`. If the checkout or file is missing, restore the
repository checkout and copy the example to `.env`; restore the secret values
from the approved host secret store rather than from chat or shell history.

The deployed `.env` must contain the Warcraft Logs V2 credentials and any
existing non-default deployment settings, including image pins, port, and data
path. Do not replace a populated file with the example. Back it up privately
before changing it:

```sh
install -m 0600 .env "/path/to/private-backup/logtastiq.env"
```

Keep the live data directory. `LOGTASTIQ_DATA_PATH` must resolve to the same
host directory that the current backend mounts at `/data`; the application
database is `hellotherelogs.sqlite3` inside that mount for backward
compatibility. Do not rename or move that directory as part of Compose repair.

## 3. Validate the recovered Compose configuration

From the repository checkout, run a quiet config validation so secret values
are not emitted:

```sh
docker compose --env-file .env -f docker-compose.unraid.yml config --quiet
docker compose --env-file .env -f docker-compose.unraid.yml config --services
docker compose --env-file .env -f docker-compose.unraid.yml config --images
```

Compare the result with the live inventory. Stop here if the Compose project
would change the image, port, host data path, service/container names, or
required Warcraft Logs settings unexpectedly. A different Compose project name
can make Compose create duplicate containers instead of reconciling the
existing ones.

When the project directory in Compose Manager is missing, recreate its entry
using the canonical repository checkout and the host-only `.env` path. Keep a
single Compose Manager project for the app; do not start a duplicate stack to
test the recovered entry.

## 4. Apply only after reviewing the diff

Back up the data directory with the normal Unraid appdata backup procedure.
Then, during a short maintenance window, use Compose Manager to apply the
reviewed configuration. Do not remove volumes or appdata. Prefer immutable
image tags shared by the frontend and backend; change from the currently
running image only after confirming the new GHCR packages are readable from
Unraid and the matching build succeeded.

After applying, check the frontend URL and `http://UNRAID_ADDRESS:PORT/api/health`.
Confirm the API is healthy, the old reports/cache remain available, and the
container mounts still point to the expected appdata directory. Check the
Unraid update schedule and the corresponding GitHub image publish/Discord
workflow separately; a healthy service does not prove those automations work.

## 5. Roll back safely

If the new containers fail, stop only the Logtastiq services, restore the
previous Compose file and immutable image references, then apply the previous
configuration. Keep the same host data directory. Do not delete the old image,
database, or appdata until the rollback and backup are verified.

Record the final image digests, Compose source path, host port, data path,
health result, and update authority in the private operations inventory. Record
only secret names and storage paths, never secret values.

## 6. Optional scheduled image updater

`scripts/auto-update.sh` can be scheduled with Unraid User Scripts after the
active Compose Manager project has been identified. It deliberately requires
the actual Compose file(s) and private `.env` path as `LOGTASTIQ_COMPOSE_FILE`
and `LOGTASTIQ_ENV_FILE`; set multiple Compose files as a colon-separated list
in the same order Compose Manager uses them. Do not point it at a clean example
stack if the live project uses an override file.

The script identifies the running Logtastiq containers by their GHCR images,
confirms they share one Compose project, and pulls both `latest` images before
it changes either service. It requires both images to carry the same full
`org.opencontainers.image.revision` label. It then creates a SQLite online
backup under `/data/backups/`, applies the pair by immutable digest, and checks
the backend health route plus frontend container state. A failed rollout
triggers a restore using the previously running image digests. If rollback or
its health check fails, investigate immediately and disable the schedule.

Before enabling the schedule, verify that the active Compose definition has
`backend` and `frontend` services, uses the existing `hellotherelogs.sqlite3`
file mounted at `/data`, and accepts `LOGTASTIQ_BACKEND_IMAGE` and
`LOGTASTIQ_FRONTEND_IMAGE` overrides. Keep the current Compose Manager project
name, data mount, port, environment file, and any override files. Run the
script manually once with the two paths set, review its output, then add it to
User Scripts at a conservative interval (for example, every six hours). Keep
the User Scripts log available for confirming each release and its recovery
path. This repository change does not edit the Unraid schedule or files.

Example User Scripts command (replace both paths with the verified live paths):

```bash
LOGTASTIQ_COMPOSE_FILE="/path/to/docker-compose.yml:/path/to/docker-compose.override.yml" \
LOGTASTIQ_ENV_FILE="/path/to/.env" \
bash /path/to/logtastiq/repo/scripts/auto-update.sh
```

The first run can update production containers. Confirm the current image
revisions, backup destination, Compose project, and maintenance window before
enabling the schedule.
