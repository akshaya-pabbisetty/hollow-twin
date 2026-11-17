# Deploying the API (lane 1)

Nothing here has been deployed yet: these are instructions and files only. The API is one Node process with
no packages to install, so any host that can run `node api/server.js` works.

Every command is on its own line and works in Windows PowerShell and in macOS/Linux shells unless marked.

**Where to run what.** The API lives in the `api` folder of the team repository, and it reads the block list from
`contract/blocks.json` next to it. So a host is given the whole repository and starts the API with
`node api/server.js`. The `az`, `docker` and Render steps below run from the top of the repository. The
`node tools/...` helper commands run from the `api` folder.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Port to listen on. Azure and Render set this for you: do not set it there. |
| `DATA` | `api/readings.jsonl` (next to `server.js`) | The append-only data file (every reading, alert, family group, official count). The folder is created if missing. **This file is the whole database.** |
| `INGEST_KEY` | (unset) | When set, every POST needs the header `x-api-key: <value>`. GET endpoints stay open so the twin and the public broadcast page need no key. Set it on any public deployment. |
| `DEVICE_KEYS` | (unset) | Device signing secrets as a JSON string, e.g. `{"relay-l8-bore-bend":"long-random-secret"}`. Use this on hosts where you cannot place the private file `api/shared/keys.json`. |
| `RATE_LIMIT` | `20` | Single posts per device per second. |
| `BLOCKS` | `contract/blocks.json` in the repository | The block list. Only needed on a host that was given the `api` folder without the rest of the repository: point it at a copy of the file. |

`api/shared/keys.json` is gitignored and is not copied into the Docker image, so on a host use `DEVICE_KEYS`.

## Option A: Azure App Service (Microsoft is the hackathon sponsor)

You need the Azure CLI (`az`): https://learn.microsoft.com/cli/azure/install-azure-cli

1. Sign in:

```
az login
```

2. See which Node versions App Service offers today, and pick the newest LTS in the list (22 or 24):

```
az webapp list-runtimes --os linux
```

3. From the top of the repository, create and deploy in one step. Replace `hollow-twin-api` with a name nobody else has
   used (it becomes `https://<name>.azurewebsites.net`), and use the runtime string exactly as step 2 printed it:

```
az webapp up --name hollow-twin-api --resource-group hollow-twin-rg --runtime "NODE:22-lts" --sku B1 --location eastus
```

   `B1` (Basic) is the smallest tier with Always On. `F1` (free) also runs, but it sleeps when idle, which drops
   every `/live` connection.

4. Tell App Service how to start the server:

```
az webapp config set --name hollow-twin-api --resource-group hollow-twin-rg --startup-file "node api/server.js"
```

5. Keep it awake (not available on `F1`):

```
az webapp config set --name hollow-twin-api --resource-group hollow-twin-rg --always-on true
```

6. Put the data file on the persistent `/home` share and set the API key (choose your own key):

```
az webapp config appsettings set --name hollow-twin-api --resource-group hollow-twin-rg --settings DATA=/home/data/readings.jsonl INGEST_KEY=choose-a-long-key
```

7. Check it, from the `api` folder (this stores nothing):

```
node tools/check.js https://hollow-twin-api.azurewebsites.net
```

8. Watch the server log while teammates connect:

```
az webapp log tail --name hollow-twin-api --resource-group hollow-twin-rg
```

To deploy a new version later, run the step 3 command again from the top of the repository.

Then give the address to the team: devices post to `https://hollow-twin-api.azurewebsites.net/ingest` with the
header `x-api-key`, and the twin reads `https://hollow-twin-api.azurewebsites.net/live` with no key.

To delete everything when the hackathon is over:

```
az group delete --name hollow-twin-rg
```

### Azure with the Dockerfile instead (optional)

App Service can also run `api/Dockerfile` as a custom container. Then set the app setting
`WEBSITES_PORT=8787`, set `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` so `/home` persists, and set
`DATA=/home/data/readings.jsonl`. The code deploy above is simpler and is the recommended path.

## Option B: Render (fallback)

1. Push the repository to GitHub (Render deploys from a Git repository).
2. On https://dashboard.render.com choose **New > Web Service** and pick the repository.
3. Settings:
   - Language: **Node**
   - Root directory: leave empty (the top of the repository, so `contract/` is included)
   - Build command: `npm install` (there is nothing to install; it finishes at once)
   - Start command: `node api/server.js`
   - Instance type: Free works for a demo; see the warnings below.
4. Under **Environment** add `INGEST_KEY` (and `DEVICE_KEYS` if devices sign). Do not set `PORT`: Render provides it.
5. Deploy, then check it from the `api` folder:

```
node tools/check.js https://your-service.onrender.com
```

Render's free web services **spin down after 15 minutes without traffic** (the next request takes up to a
minute) and have an **ephemeral filesystem**: the data file is erased on every spin-down, restart and redeploy.
A persistent disk can only be attached to a paid instance; if you pay for one, mount it at `/data` and set
`DATA=/data/readings.jsonl`.

## Option C: any machine with Docker

Build from the top of the repository, so the image gets both `api/` and `contract/`:

```
docker build -f api/Dockerfile -t hollow-twin-api .
```

```
docker run -d --name hollow-twin-api -p 8787:8787 -v hollow-twin-data:/data -e INGEST_KEY=choose-a-long-key hollow-twin-api
```

The named volume `hollow-twin-data` keeps the data file across container restarts.

## Making the live stream (`/live`, server-sent events) work behind a proxy

Azure and Render both put a reverse proxy in front of the app. Three things keep the stream alive, and the
server already does all of them:

| Risk | What the server does |
|---|---|
| The proxy buffers the response and events arrive late or in clumps | Sends `X-Accel-Buffering: no` and `Cache-Control: no-cache, no-transform`, and never compresses |
| The proxy closes a connection that looks idle (Azure's limit is about 4 minutes) | Sends a `: ping` comment every 20 seconds |
| The connection drops anyway (deploy, restart, phone changes network) | Every event has an `id`. The browser reconnects by itself and sends `Last-Event-ID`; the server replays everything that was missed, in order |

What you must do:

- Run **one instance only** (do not scale out). The data file and the event numbering live in that one process.
- On Azure keep **Always On** enabled (step 5), otherwise the app is unloaded when idle.
- Do not put a CDN or a caching layer in front of `/live`.
- After deploying, run `node tools/check.js <url>`. It reports how quickly the first bytes of `/live` arrive. If
  nothing arrives within 8 seconds, something in front of the app is buffering.

If a proxy you cannot control still buffers, the twin can fall back to polling `GET /status` every few seconds and
`GET /history?after_seq=<last seq>` for the events in between: both give the same data as the stream.

## Free-tier disks can reset: how to handle it

The data file is the only state. If the host wipes it (Render free tier on every spin-down; Azure if `DATA` is not
under `/home`), the API starts empty and event ids restart at 1. A twin that reconnects with a higher
`Last-Event-ID` is sent `event: reset`, so it knows to clear and reload.

Pick one:

1. **Persistent path (best).** Azure: `DATA=/home/data/readings.jsonl` (step 6). Render: a paid disk. Docker: the
   named volume. Confirm it works: note `seq` from `node tools/check.js <url>`, restart the app, run it again.
   The number must not go back to 0.
2. **Re-run the scenarios before recording.** The demo data is scripted, so an empty server is refilled in a few
   seconds (PowerShell shown; on macOS/Linux use `export INGEST_KEY=...` instead of the first line):

```
$env:INGEST_KEY = "choose-a-long-key"
```

```
node tools/scenario.js all https://hollow-twin-api.azurewebsites.net --fast
```

3. **Record against a laptop.** `npm start` in the `api` folder on the same WiFi as the devices never resets and has no proxy.

Back up the data at any time (it is plain JSON):

```
node -e "fetch(process.argv[1]+'/history').then(r=>r.text()).then(t=>require('fs').writeFileSync('backup.json',t))" https://hollow-twin-api.azurewebsites.net
```

## Not verified

These instructions were written without an Azure or Render account and without Docker on the machine, so none of
the three paths has been run end to end. The parts most worth checking on first deploy: the exact runtime string
from step 2, that `/home/data` survives a restart (the `seq` check above), the `/live` timing from
`tools/check.js`, and that the Docker build picks up `api/Dockerfile.dockerignore` (it keeps the data file and
`api/shared/keys.json` out of the image; this needs BuildKit, which current Docker uses by default).
