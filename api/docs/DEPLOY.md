# Deploying the backend

Nothing here has been deployed yet: these are instructions and files only. The backend is one Node process with
no packages to install, so any host that can run `node api/server.js` works.

Every command is on its own line and works in Windows PowerShell and in macOS/Linux shells unless marked.

The backend lives in the `api` folder of the team repository. Hosts are given the whole repository and start it with
`node api/server.js`. The `az`, `docker` and Render steps run from the repository root; the `node tools/...` helper
commands run from the `api` folder.

## Settings (environment variables)

| Variable | Default | What it does |
|---|---|---|
| `PORT` | `8787` | Port to listen on. Azure and Render set this for you: do not set it there. |
| `DATA` | `api/readings.jsonl` (next to `server.js`) | The append-only data file (every reading, alert, family group, official count). The folder is created if missing. **This file is the whole database.** |
| `INGEST_KEY` | (unset) | When set, every POST needs the header `x-api-key: <value>`. GET endpoints stay open so the twin and the public broadcast page need no key. Set it on any public deployment. |
| `DEVICE_KEYS` | (unset) | Device signing secrets as a JSON string, e.g. `{"relay-07":"long-random-secret"}`. Use this on hosts where you cannot place the private file `api/shared/keys.json`. |
| `RATE_LIMIT` | `20` | Single posts per device per second. |

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

3. From the project folder, create and deploy in one step. Replace `hollow-twin-api` with a name nobody else has
   used (it becomes `https://<name>.azurewebsites.net`), and use the runtime string exactly as step 2 printed it:

```
az webapp up --name hollow-twin-api --resource-group hollow-twin-rg --runtime "NODE:22-lts" --sku B1 --location eastus
```

   `B1` (Basic) is the smallest tier with Always On. `F1` (free) also runs, but it sleeps when idle, which drops
   every `/feed` connection.

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

7. Check it (this stores nothing):

```
node tools/check.js https://hollow-twin-api.azurewebsites.net
```

8. Watch the server log while teammates connect:

```
az webapp log tail --name hollow-twin-api --resource-group hollow-twin-rg
```

To deploy a new version later, run the step 3 command again from the project folder.

To delete everything when the hackathon is over:

```
az group delete --name hollow-twin-rg
```

### Azure with the Dockerfile instead (optional)

App Service can also run the included `Dockerfile` as a custom container. Then set the app setting
`WEBSITES_PORT=8787`, set `WEBSITES_ENABLE_APP_SERVICE_STORAGE=true` so `/home` persists, and set
`DATA=/home/data/readings.jsonl`. The code deploy above is simpler and is the recommended path.

## Option B: Render (fallback)

1. Push the repository to GitHub (Render deploys from a Git repository).
2. On https://dashboard.render.com choose **New > Web Service** and pick the repository.
3. Settings:
   - Language: **Node**
   - Build command: `npm install` (there is nothing to install; it finishes at once)
   - Start command: `node api/server.js`
   - Instance type: Free works for a demo; see the warnings below.
4. Under **Environment** add `INGEST_KEY` (and `DEVICE_KEYS` if devices sign). Do not set `PORT`: Render provides it.
5. Deploy, then check it:

```
node tools/check.js https://your-service.onrender.com
```

Render's free web services **spin down after 15 minutes without traffic** (the next request takes up to a
minute) and have an **ephemeral filesystem**: the data file is erased on every spin-down, restart and redeploy.
A persistent disk can only be attached to a paid instance; if you pay for one, mount it at `/data` and set
`DATA=/data/readings.jsonl`.

## Option C: any machine with Docker

```
docker build -f api/Dockerfile -t hollow-twin-api .
```

```
docker run -d --name hollow-twin-api -p 8787:8787 -v hollow-twin-data:/data -e INGEST_KEY=choose-a-long-key hollow-twin-api
```

The named volume `hollow-twin-data` keeps the data file across container restarts.

## Making the live feed (`/feed`, server-sent events) work behind a proxy

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
- Do not put a CDN or a caching layer in front of `/feed`.
- After deploying, run `node tools/check.js <url>`. It reports how quickly the first bytes of `/feed` arrive. If
  nothing arrives within 8 seconds, something in front of the app is buffering.

If a proxy you cannot control still buffers, the twin can fall back to polling `GET /status` every few seconds and
`GET /history?after_seq=<last seq>` for the events in between: both give the same data as the feed.

## Free-tier disks can reset: how to handle it

The data file is the only state. If the host wipes it (Render free tier on every spin-down; Azure if `DATA` is not
under `/home`), the backend starts empty and event ids restart at 1. A twin that reconnects with a higher
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

3. **Record against a laptop.** `node api/server.js` on the same WiFi as the devices never resets and has no proxy.

Back up the data at any time (it is plain JSON):

```
node -e "fetch(process.argv[1]+'/history').then(r=>r.text()).then(t=>require('fs').writeFileSync('backup.json',t))" https://hollow-twin-api.azurewebsites.net
```

## Not verified

These instructions were written without an Azure or Render account and without Docker on the machine, so none of
the three paths has been run end to end. The parts most worth checking on first deploy: the exact runtime string
from step 2, that `/home/data` survives a restart (the `seq` check above), and the `/feed` timing from
`tools/check.js`.
