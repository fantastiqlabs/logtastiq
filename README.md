# Logtastiq

**Turn Warcraft Logs into clear next steps.**

Logtastiq is a self-hosted Warcraft Logs Classic Fresh report reader. It loads public report data through the Fresh Warcraft Logs GraphQL API; Warcraft Logs credentials remain in FastAPI and are never sent to the browser.

## Deploy on Unraid

Unraid can run the prebuilt app images from GitHub Container Registry (GHCR); it does not need WSL or a local build toolchain. The repository workflow builds and publishes separate `linux/amd64` backend and frontend images to:

- `ghcr.io/fantastiqlabs/logtastiq-backend`
- `ghcr.io/fantastiqlabs/logtastiq-frontend`

Pushes to `main` publish the `latest` tag and a commit-specific `sha-...` tag. Version tags such as `v1.2.0` publish matching image tags. Pull requests build both images without publishing them.

1. After the first workflow run, open each image package under the Fantastiq Labs organization's **Packages** tab. In **Package settings**, change visibility to **Public** if you want Unraid to pull without registry credentials. GHCR packages default to private. Making a package public is a permanent visibility change on GitHub. If you prefer private packages, keep them private and sign in to GHCR on Unraid with a GitHub personal access token (classic) that has `read:packages` permission.
2. Install the community **Compose Manager Plus** plugin from the Unraid Apps tab, after checking that it supports your Unraid version. Clone this repository on Unraid, for example under `/mnt/user/appdata/logtastiq`, and add `docker-compose.unraid.yml` as a stack. GitHub builds and publishes the images; Unraid pulls them. This keeps GitHub out of your home network and avoids installing a GitHub runner or SSH deploy credential on Unraid.
3. Copy `.env.unraid.example` to `.env` in that directory and enter `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET` from your Warcraft Logs V2 API client. Keep this file private; credentials are passed only to the backend container.
4. From the directory containing the files, run:

   ```sh
   docker compose -f docker-compose.unraid.yml pull
   docker compose -f docker-compose.unraid.yml up -d
   ```

5. Open `http://UNRAID_ADDRESS:8080`. Set `LOGTASTIQ_PORT` in `.env` to use a different host port. SQLite data is stored under `/mnt/user/appdata/logtastiq/data` by default and remains across container updates; override `LOGTASTIQ_DATA_PATH` if you choose a different path.

To enable automatic updates, configure a scheduled image pull/update for this stack in Compose Manager Plus. It will pull the latest main images and recreate the containers on its schedule, causing a short restart. For a reproducible deployment, set both image variables in `.env` to the same `sha-<full Git SHA>` tag or release tag instead of `latest`. To roll back, restore the previous SHA image tags and redeploy. Back up the appdata directory with your other Unraid app data. If the Compose Manager project files are lost, follow [the Unraid recovery runbook](docs/UNRAID_RECOVERY.md) before recreating the stack.

For a private GHCR package, log in once on Unraid before pulling:

```sh
docker login ghcr.io --username YOUR_GITHUB_USERNAME
```

Enter a personal access token (classic) with `read:packages` when prompted. Docker stores the login on the Unraid host; do not put this token in the Compose file or repository.

## Run locally with Docker Compose

1. Create a Warcraft Logs **V2 API client** in the Warcraft Logs account client management page.
2. Copy `.env.example` to `.env`, then set `WCL_CLIENT_ID` and `WCL_CLIENT_SECRET`.
3. Run `docker compose up --build -d` from this directory.
4. Open `http://localhost:8080` on the local machine. If running Docker inside WSL 2, localhost forwarding is usually available; otherwise get the WSL address with `hostname -I` inside Ubuntu and open `http://WSL_ADDRESS:8080` from Windows. Set `LOGTASTIQ_PORT` to change the host port or `LOGTASTIQ_BIND_ADDRESS` to change the bind address.
5. Visit `/api/health` to check the Logtastiq API. Compose keeps its existing SQLite volume name so current cache data remains available.

## Local development

Backend: `cd backend && pip install -r requirements.txt && uvicorn app.main:app --reload --port 8000`.

Frontend: `cd frontend && npm install && npm run dev`. Vite proxies `/api` to `http://localhost:8000`.

Run `cd backend && pytest` for backend tests and `cd frontend && npm run build` for a production frontend build.

## Warcraft Logs API versions and schema

Warcraft Logs supports two API versions. **V1 is a REST API using a V1 key**, which provides access to non-private site data and has separate V1 documentation/playground. **V2 is GraphQL and uses OAuth client credentials**. Logtastiq uses V2; a V1 key cannot be used as the V2 client ID or secret. The V2 client-credentials exchange posts `grant_type=client_credentials` with HTTP Basic credentials to `https://www.warcraftlogs.com/oauth/token`; requests then send the returned Bearer token to GraphQL. Defaults are `https://fresh.warcraftlogs.com/api/v2/client` for Fresh GraphQL and the Warcraft Logs OAuth token URL. Both are backend settings. See the [Warcraft Logs API documentation](https://www.warcraftlogs.com/api/docs) and [Fresh V2 schema](https://fresh.warcraftlogs.com/v2-api-docs/warcraft/).

The report query follows documented `Query.reportData.report(code:)` fields: `code`, `title`, `startTime`, `endTime`, `zone { name }`, `guild { name }`, and `fights`. The Fresh `ReportFight` schema documents `id`, `encounterID`, `name`, `startTime`, `endTime`, `kill`, `fightPercentage`, and `friendlyPlayers`. Report start/end values are UNIX milliseconds; fight times are millisecond offsets from report start. Normalization derives report duration from report start/end and fight duration from fight end/start. Boss progression groups fights by nonzero `encounterID`, counting `kill: true` as kills and `kill: false` as wipes; it preserves null kill values without treating them as wipes.

Selected-fight review scopes the player roster to the fight's `friendlyPlayers`, then queries Warcraft Logs tables for damage, healing, damage taken, casts, interrupts, buffs, and debuffs. Friendly fire is computed from outgoing damage events whose source and target are both players in the selected fight, excluding NPC damage. The dashboard groups players by class for side-by-side comparison, lets each top-five board expand to the full roster, and shows player/ability uptime, death and interrupt timelines, and per-player review suggestions. Uptime views include reported raid buffs and debuff abilities such as armor debuffs, curses, and stings; values are based on the uptime and total-time values returned by Warcraft Logs. A raid learning plan turns survival, kick assignments, raid coverage, and cooldown planning into practical prompts for the next pull; its topics expand to show review steps and it does not label actions as mistakes where the report lacks the needed context. Itemization is summarized as average item level with separate enchant and gem counts/details, alongside auras and consumable-like casts returned by WCL. The top bar has a persistent text-size slider (defaulting to a larger middle setting) and persistent Dark, Light, Catppuccin Mocha, Tokyo Night, and Nord themes. A build identifier and UTC build date show which GitHub-built frontend is running. Some optional fields depend on the report, and consumable matching is heuristic, so absent detail is labeled unavailable rather than treated as proof that an item was not used. Suggestions are evidence-led prompts, not grades or class-specific rotation prescriptions. API usage is observable via `rateLimitData { limitPerHour pointsSpentThisHour pointsResetIn }`; the app does not assume one fixed quota.

The encounter review can compare a selected kill against two public cohorts: **Recent peer parses** asks WCL for same-spec, item-level-bracket rankings surfaced through up to ten characters in the selected raid, while **Top execution kills** uses the encounter leaderboard. For wipe pulls, **Same-report attempts** compares other wipes in the same report, using WCL's reported fight percentage to keep strict and balanced cohorts within ±10 or ±20 percentage points when that value is available. The service examines up to 25 candidates in batches and returns up to five that pass the selected filters. All sources verify encounter, difficulty, kill/wipe state, and raid size. Strict and balanced modes also filter by pull duration (±10% or ±20%), class composition (at least 80% or 60% overlap), and average item level (within ±3 or ±6) when data is available; broad mode relaxes these filters. The comparison summarizes raid DPS/HPS, damage taken per second, deaths, landed interrupts, and per-player DPS/HPS, damage taken, ability uptime, and cast rates. Each reference report contributes one sample per player metric; when possible, exact-spec peers are preferred and same-class players with unknown specs are fallback matches. Review highlights need at least three matched logs and say which fields to inspect, rather than assigning blame. Recent references are a small, roster-seeded sample, not a representative random baseline; execution kills are aspirational. Same-report attempts can have strategy and roster changes and are not aligned by named encounter phase. Role, assignment, mechanics, cooldown availability, and strategy still affect comparisons. Damage taken, output, and successful interrupts do not diagnose mistakes or establish missed kick opportunities. WCL percentile and best-score rankings for the selected pull are shown separately from these cohort comparisons.

## Report workflow

Live updates stop automatically after **2 hours** by default. Choose **Stop after** 30 minutes, 1 hour, 2 hours, or 4 hours before starting. Background time counts toward the deadline, which is saved in the report URL so reloading or reopening it does not restart polling. Changing the refresh interval does not extend the deadline. Choose **Off** to stop sooner; after stopping, choose a refresh interval to explicitly start a new timed session. Already loaded data stays visible.

Choose **Live updates** to check an ongoing public report every 30 seconds, 1 minute (default), 2 minutes, or 5 minutes. Paste the report URL and choose **ANALYZE LOG**. The report page lets you change the interval or turn it **Off**, and preserves your selected pull while adding new fights. Checks pause in background tabs. Someone must be uploading to the same report through Warcraft Logs for new data to appear. Failed updates retain the last loaded report and retry at the selected interval. Live checks fetch a fresh overview instead of waiting for the normal server cache; benchmark comparisons retain their existing cache lifetime. The regular Warcraft Logs and file-upload tabs remain available.

Paste a Fresh URL such as `https://fresh.warcraftlogs.com/reports/REPORTCODE`, choose **ANALYZE LOG**, then the app navigates to `/reports/REPORTCODE`. The backend validates the Fresh report URL, retrieves and normalizes report/fight data, and caches the JSON representations in SQLite for `CACHE_TTL_SECONDS` (default 900 seconds).

## Configuration

| Variable | Purpose |
| --- | --- |
| `WCL_CLIENT_ID`, `WCL_CLIENT_SECRET` | Backend-only V2 OAuth client credentials |
| `WCL_TOKEN_URL` | OAuth token endpoint |
| `WCL_GRAPHQL_URL` | Fresh V2 GraphQL endpoint |
| `DATABASE_URL` | SQLite URL; Compose uses the persistent volume |
| `CACHE_TTL_SECONDS` | Normalized report/fight cache lifetime |
| `FRONTEND_ORIGIN` | CORS origin for direct API access |
| `LOGTASTIQ_PORT` | Optional nginx host port (default `8080`) |
| `LOGTASTIQ_BIND_ADDRESS` | Host interface Docker publishes on (default `0.0.0.0`, all interfaces) |

Unraid deployment uses `.env.unraid.example` and `docker-compose.unraid.yml`. `LOGTASTIQ_BACKEND_IMAGE` and `LOGTASTIQ_FRONTEND_IMAGE` can override the default GHCR `latest` tags to pin a release or commit image. Compose still accepts the former `HELLOTHERELOGS_*` variables so existing Unraid environment files keep working.

## Contributing

See [AGENTS.md](AGENTS.md) for repository conventions and [PROJECT_STATUS.md](PROJECT_STATUS.md) for the implementation handoff, current limitations, and next analysis work.
