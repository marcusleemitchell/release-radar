# 📡 Release Radar

> Analyse what's shipping — generate a polished release summary from your GitHub diff in seconds.

## Overview

Release Radar is a local Express web app that compares a production Git tag against the `master` branch of any repository in your GitHub organisation, surfacing the pull requests that make up the delta. It fetches repo lists, tags sorted by commit date, branch comparisons, and associated PRs through the GitHub API via Octokit. PR titles and descriptions are passed to the GitHub Copilot CLI to produce a human-readable release summary, which is streamed back to the browser in real time using Server-Sent Events. Repo and tag data is cached locally for 24 hours so the UI stays snappy, with manual refresh controls when you need the latest.

## Prerequisites

- **Node.js 18+**
- A **GitHub Personal Access Token** with the `repo` and `read:org` scopes
- The **GitHub Copilot CLI** installed as a `gh` extension and available on your `PATH` as `copilot`:
  ```sh
  gh extension install github/gh-copilot
  ```

## Installation

```sh
git clone <repo-url>
cd release-radar
cp .env.example .env   # then fill in your values
npm install
npm start
```

Open [http://localhost:3000](http://localhost:3000) in your browser.

## Configuration

All configuration is provided through environment variables. Copy `.env.example` to `.env` and set the required values before starting the app.

| Variable | Required | Default | Description |
|---|---|---|---|
| `GITHUB_TOKEN` | ✅ Yes | — | Personal Access Token with `repo` and `read:org` scopes |
| `GITHUB_ORG` | ✅ Yes | — | GitHub organisation slug to list repositories from |
| `PORT` | No | `3000` | Local port the Express server listens on |
| `COPILOT_BIN` | No | `copilot` | Name or path of the Copilot CLI binary |

## Usage

1. Open the app at [http://localhost:3000](http://localhost:3000).
2. **Select a repository** from the dropdown — the list is populated from your configured GitHub org.
3. The **base tag** auto-selects the most recent `production-*` tag by commit date. Change it using the tag dropdown if needed.
4. The **head branch** defaults to `master`. Adjust it if your repo uses a different default branch.
5. Click **Analyse Release** to fetch the diff and display all pull requests merged since the base tag.
6. Review the PR list — titles, numbers, and descriptions are shown for each PR in the diff.
7. Click **Generate AI Summary** to invoke the Copilot CLI. The summary streams back to the page as it is generated.
8. Click **Copy to Clipboard** to grab the finished summary and paste it wherever you need it.

## How It Works

The backend exposes four API routes:

| Route | Description |
|---|---|
| `GET /api/repos` | Lists all repositories in the configured org using Octokit, with 24-hour caching. |
| `GET /api/tags/:repo` | Returns tags for the given repo sorted by commit date, filtered to `production-*` by default. |
| `GET /api/compare/:repo` | Compares the selected base tag against the head branch and resolves each commit to its associated pull request. |
| `POST /api/summarise` | Accepts PR titles and descriptions, spawns `copilot -p` as a child process, and streams its stdout back to the browser as Server-Sent Events (SSE). |

`/api/summarise` pipes a structured prompt — containing the PR list — into `copilot -p` via stdin. The process stdout is read chunk-by-chunk and forwarded to the browser over an SSE connection so the summary appears progressively as it is generated, with the connection closing cleanly once the process exits.

## Caching

Repo lists and tag lists are cached with a **24-hour TTL** and persisted to `cache/cache.json`. Because the cache is written to disk, it survives app restarts — subsequent startups will serve cached data immediately without hitting the GitHub API. Each cacheable resource has an independent **Refresh** button in the UI that busts only that entry, leaving the rest of the cache intact.

## Logging

All activity is written to `logs/app.log` as **newline-delimited JSON (NDJSON)**, one entry per line, making it straightforward to pipe into `jq` or ingest into a log aggregator.

Every log entry includes at minimum:

| Field | Description |
|---|---|
| `ts` | ISO 8601 timestamp |
| `level` | `INFO`, `WARN`, `ERROR`, or `DEBUG` |
| `event` | Machine-readable event identifier (e.g. `http.request`, `cache.hit`) |
| `msg` | Human-readable description |

Additional context fields (repo name, route, status code, duration in ms, cache key, CLI exit code, etc.) are appended to entries where relevant. The logger covers:

- **HTTP** — every incoming request and outgoing response, including method, path, status code, and duration.
- **GitHub API** — every Octokit call, with repo/org context and outcome.
- **Cache** — hits, misses, and manual invalidations, keyed by resource.
- **Copilot CLI** — invocation arguments, process start, stdout/stderr, and exit code.

## Desktop app (Electron)

Release Radar can run as a standalone macOS app.

```sh
npm run electron    # run in an Electron window without packaging
npm run dist        # build dist/mac-arm64/Release Radar.app (unsigned)
npm run dist:dmg    # build a .dmg instead
```

The packaged app keeps its config, cache and logs in `~/Library/Application Support/Release Radar/`:

- `.env` — set `GITHUB_TOKEN` and `GITHUB_ORG` here (created on first launch; also reachable from the app menu via **Open Config File**)
- `cache/` and `logs/`

The `copilot` CLI is not bundled. The app resolves your shell `PATH` at launch so it can find it; if it lives somewhere unusual, set `COPILOT_BIN` in the `.env` file.

Because the app is unsigned, the first launch of a copy that has been moved or downloaded may need right-click → Open.

### Copy as image (for Slack)

Once a summary has been generated, **Copy as image** (next to **Copy**) puts a screenshot of the whole release card on the clipboard, ready to paste into Slack. It captures at full retina resolution, includes the PR list even if it is taller than the window, and leaves out anything marked `data-no-capture` in `public/index.html` (currently the *Generate AI Summary* and *Copy as image* buttons). The button only appears in the desktop app, not when running via `npm start` in a browser.

## Development

```sh
npm run dev
```

`npm run dev` starts the server with **nodemon**, which watches for file changes and automatically restarts the process. The `cache/` and `logs/` directories are listed in `.gitignore` and will not be committed.
