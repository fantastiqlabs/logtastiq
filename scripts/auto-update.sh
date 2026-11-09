#!/usr/bin/env bash
set -euo pipefail

log() { printf '[%s] %s\n' "$(date -u +%Y-%m-%dT%H:%M:%SZ)" "$*"; }
fail() { log "$*" >&2; exit 1; }

repo=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
compose_files=${LOGTASTIQ_COMPOSE_FILE:-}
env_file=${LOGTASTIQ_ENV_FILE:-}
[[ -n "$compose_files" ]] || fail 'Set LOGTASTIQ_COMPOSE_FILE to the active Unraid Compose file(s).'
[[ -n "$env_file" && -f "$env_file" ]] || fail 'Set LOGTASTIQ_ENV_FILE to the active, private environment file.'
command -v docker >/dev/null || fail 'Docker CLI is required.'

if command -v flock >/dev/null 2>&1; then
    exec 9>/tmp/logtastiq-update.lock
    flock -n 9 || { log 'Another update is running; skipping.'; exit 0; }
fi

find_container() {
    local service=$1 image_prefix=$2 candidate image
    while IFS= read -r candidate; do
        [[ -n "$candidate" ]] || continue
        image=$(docker inspect --format '{{.Config.Image}}' "$candidate" 2>/dev/null || true)
        if [[ "$image" == "$image_prefix"* ]]; then
            printf '%s\n' "$candidate"
            return 0
        fi
    done < <(docker ps -q --filter "label=com.docker.compose.service=$service")
    return 1
}

backend=$(find_container backend ghcr.io/fantastiqlabs/logtastiq-backend) || fail 'Could not identify the running Logtastiq backend by image.'
frontend=$(find_container frontend ghcr.io/fantastiqlabs/logtastiq-frontend) || fail 'Could not identify the running Logtastiq frontend by image.'
project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$backend")
frontend_project=$(docker inspect --format '{{ index .Config.Labels "com.docker.compose.project" }}' "$frontend")
[[ -n "$project" && "$project" == "$frontend_project" ]] || fail 'Backend and frontend are not in the same Compose project.'

compose=(docker compose --env-file "$env_file" -p "$project")
IFS=: read -r -a compose_file_list <<<"$compose_files"
for compose_file in "${compose_file_list[@]}"; do
    [[ -f "$compose_file" ]] || fail "Compose file does not exist: $compose_file"
    compose+=(-f "$compose_file")
done
for service in backend frontend; do
    "${compose[@]}" config --services | grep -Fxq "$service" || fail "The selected Compose definition has no $service service."
done

old_backend=$(docker inspect --format '{{index .RepoDigests 0}}' "$backend")
old_frontend=$(docker inspect --format '{{index .RepoDigests 0}}' "$frontend")
[[ "$old_backend" == ghcr.io/fantastiqlabs/logtastiq-backend@sha256:* ]] || fail 'Could not capture the running backend digest for rollback.'
[[ "$old_frontend" == ghcr.io/fantastiqlabs/logtastiq-frontend@sha256:* ]] || fail 'Could not capture the running frontend digest for rollback.'

database_backup() {
    local container=$1 timestamp=$2
    docker exec "$container" python -c 'import os, sqlite3, sys; source="/data/hellotherelogs.sqlite3"; os.path.exists(source) or sys.exit("Database not found at the expected legacy path"); directory="/data/backups"; os.makedirs(directory, exist_ok=True); target=os.path.join(directory, "hellotherelogs-"+sys.argv[1]+".sqlite3"); src=sqlite3.connect("file:"+source+"?mode=ro", uri=True); dst=sqlite3.connect(target); src.backup(dst); dst.close(); src.close(); os.path.getsize(target) > 0 or sys.exit("Database backup is empty"); print("SQLite backup created")' "$timestamp"
}

revision() {
    docker image inspect --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' "$1"
}

running_backend_revision=$(revision "$(docker inspect --format '{{.Image}}' "$backend")")
running_frontend_revision=$(revision "$(docker inspect --format '{{.Image}}' "$frontend")")

log 'Pulling both latest Logtastiq images before changing either service.'
docker pull ghcr.io/fantastiqlabs/logtastiq-backend:latest >/dev/null
docker pull ghcr.io/fantastiqlabs/logtastiq-frontend:latest >/dev/null
backend_revision=$(revision ghcr.io/fantastiqlabs/logtastiq-backend:latest)
frontend_revision=$(revision ghcr.io/fantastiqlabs/logtastiq-frontend:latest)
[[ "$backend_revision" =~ ^[0-9a-f]{40}$ && "$backend_revision" == "$frontend_revision" ]] || fail 'Published images do not have matching full source revisions; leaving the running stack unchanged.'
if [[ "$backend_revision" == "$running_backend_revision" && "$frontend_revision" == "$running_frontend_revision" ]]; then
    log "Both running services already use source revision $backend_revision."
    exit 0
fi
new_backend=$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/fantastiqlabs/logtastiq-backend:latest)
new_frontend=$(docker image inspect --format '{{index .RepoDigests 0}}' ghcr.io/fantastiqlabs/logtastiq-frontend:latest)
[[ "$new_backend" == ghcr.io/fantastiqlabs/logtastiq-backend@sha256:* && "$new_frontend" == ghcr.io/fantastiqlabs/logtastiq-frontend@sha256:* ]] || fail 'Could not resolve both pulled image digests.'

timestamp=$(date -u +%Y%m%dT%H%M%SZ)
database_backup "$backend" "$timestamp" || fail 'SQLite backup failed; deployment was not changed.'

if LOGTASTIQ_BACKEND_IMAGE="$new_backend" LOGTASTIQ_FRONTEND_IMAGE="$new_frontend" "${compose[@]}" up -d --no-deps backend frontend; then
    new_backend_container=$("${compose[@]}" ps -q backend)
    new_frontend_container=$("${compose[@]}" ps -q frontend)
    if [[ -n "$new_backend_container" && -n "$new_frontend_container" ]] \
        && docker exec "$new_backend_container" python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=10)' \
        && [[ $(docker inspect --format '{{.State.Status}}' "$new_frontend_container") == running ]]; then
        log "Deployment healthy at source revision $backend_revision."
        exit 0
    fi
fi

log 'New deployment did not pass health checks; restoring the previous image pair.' >&2
LOGTASTIQ_BACKEND_IMAGE="$old_backend" LOGTASTIQ_FRONTEND_IMAGE="$old_frontend" "${compose[@]}" up -d --no-deps backend frontend || fail 'Rollback command failed; inspect Compose project immediately.'
rollback_backend=$("${compose[@]}" ps -q backend)
[[ -n "$rollback_backend" ]] && docker exec "$rollback_backend" python -c 'import urllib.request; urllib.request.urlopen("http://127.0.0.1:8000/api/health", timeout=10)' || fail 'Rollback completed but backend health check failed.'
fail 'Previous image pair restored after failed update. Investigate before the next scheduled run.'
