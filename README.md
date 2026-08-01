# RideLog — 325km x8 Training Tracker

A standalone desktop app (Electron) for logging mileage and weight, browsing your
Audax 200/300km calendar, and importing your training plan spreadsheet.

## Run it (development mode — fastest way to try it)

You need Node.js installed (you already have this for Claude Code / VS Code).

```
cd ride-weight-log
npm install
npm start
```

This opens the app in its own desktop window immediately. Your data is saved to a
local JSON file (the app shows you the exact path on the Import tab), so it persists
between launches.

## Build a real installer (.exe)

```
npm run build
```

This uses electron-builder to produce a Windows installer (NSIS `.exe`) in the `dist/`
folder. Run that installer once and it adds RideLog as a normal installed application
with its own Start Menu entry and desktop shortcut — exactly like any other app.

(electron-builder also supports `--mac` and `--linux` targets if you ever need those;
edit the `build` section of `package.json` or pass `--win`/`--mac`/`--linux` explicitly.)

## Data

- All data (mileage/weight entries, imported plan rows) is stored in a single JSON
  file in your user data folder, e.g.
  `C:\\Users\\<you>\\AppData\\Roaming\\RideLog\\ridelog-data.json`
- First launch seeds it with your mileage/weight history from
  Mileage.xlsx / weight1.xlsx (12 Dec 2025 – 13 Jun 2026 daily, plus monthly totals
  back to Jan 2022).
- To back up or move your data, just copy that JSON file.
- To re-import your training plan, use the Import tab and select your
  "325km x8days Training Plan.xlsx" file (reads the "Plan" sheet).

## Strava sync (replaces manual distance entry)

The Log tab no longer has a manual distance field — distance comes from Strava.
One-time setup, in the app's **Settings** tab:

1. Go to https://www.strava.com/settings/api and create an API application. Note
   the **Client ID** and **Client Secret**.
2. In a browser, visit (replace `YOUR_ID`):
  `https://www.strava.com/oauth/authorize?client_id=YOUR_ID&redirect_uri=http://localhost&response_type=code&approval_prompt=force&scope=activity:read,activity:read_all`
   Authorize the app. You'll be redirected to a `localhost` URL that won't load —
   that's fine, copy the `code=...` value from the address bar.
3. Exchange that code for a refresh token, e.g. with curl:
   ```
   curl -X POST https://www.strava.com/oauth/token \
     -d client_id=YOUR_ID -d client_secret=YOUR_SECRET \
     -d code=THE_CODE -d grant_type=authorization_code
   ```
  The response includes a `refresh_token`.
4. Enter Client ID, Client Secret and that refresh token in Settings, click **Save**,
   then **Sync now**. This pulls the last 12 months of Ride activities and fills in
   daily distances. Re-click "Sync now" any time to refresh.

If you already connected Strava before, you need to re-authorize after changing the scopes so the new refresh token carries `activity:read` as well as `activity:read_all`.

Strava rotates refresh tokens on use — the app stores the latest one automatically
after each sync.

⚠️ Credentials are stored in plain text in `ridelog-data.json` alongside your other
data, since this is a local single-user app. Don't share that file.

## Requirements

- Electron 31 bundles Node ~20, which includes a global `fetch` used for the Strava
  API calls — no extra dependencies needed.

## Audax Finder

- Filters now show **every Audax UK event of 200km or more** (200, 300, 400, 600,
  1000km etc.), not just 200/300.
- Every time you open the Audax Finder tab, the app re-fetches the live list from
  audax.uk in a hidden window (takes a few seconds — status shown above the table).
  If that fails (no internet, site changes), it falls back to the last list it has.
- Click an event's name to open its full audax.uk page in your browser — route
  sheets, GPX files, organiser details etc. are whatever that page shows.
- Use the **Mark** column to flag an event as "Maybe" or "Entered". Marked events
  appear in the **My events** list below, and persist even if that event later drops
  off the live audax.uk list.


- Internet is needed on first load to fetch two small libraries (Chart.js and
  SheetJS) from a CDN for charts and spreadsheet import. Everything else runs offline.
- Audax 200/300km calendar (124 events) is built in.
