# Operations

How this fork runs in production, and the procedures for changing, testing, and
reverting it.

## How it runs

Tunarr runs from this checkout as a user LaunchAgent, **not** from
`/Applications/Tunarr.app`.

| | |
|---|---|
| Service label | `com.michael.tunarr` |
| Plist | `~/Library/LaunchAgents/com.michael.tunarr.plist` |
| Checkout | `~/Github/tunarr` (branch `michael/v1.3.14-tuning`) |
| Data directory | `~/Library/Preferences/tunarr` |
| Port | 8000 |
| Reported version | `1.3.14-michael` |
| Service logs | `~/Library/Logs/tunarr-service.log` (and `.err.log`) |
| Application log | `~/Library/Preferences/tunarr/logs/tunarr.log` |

The agent runs `/opt/homebrew/bin/node` against `tsx` directly on the
TypeScript sources — there is no build step for the server. Homebrew's node is
used deliberately: `node` on the interactive `PATH` resolves through fnm to a
per-shell path that does not exist at boot.

`RunAtLoad` starts it at login and `KeepAlive` restarts it if it dies. Both were
verified: killing the process brought it back in 1 s (serving again in 4 s), and
a full `bootout`/`bootstrap` cycle brought it up in 4 s. `ProcessType` is
`Interactive` so macOS does not throttle transcoding.

Startup takes ~4 s because `tsx` transpiles on launch. The trade is that code
changes need only a restart, never a build.

### Self-contained dependencies

- **meilisearch** is copied to `~/Github/tunarr/bin/meilisearch` (gitignored)
  rather than read from inside the app bundle, so `/Applications/Tunarr.app` can
  be deleted without breaking the service.
- **The web UI** is a built bundle. `server/src/web` is a gitignored symlink to
  `web/dist`, which is where the server looks for static assets.

### The packaged app

Still installed at `/Applications/Tunarr.app`, kept only as a rollback path. It
has been **removed from Login Items**, so it will not start at boot and contend
for port 8000. Do not launch it while the service is running.

## Everyday commands

```bash
# status
launchctl print gui/$(id -u)/com.michael.tunarr | grep -E 'state|pid'
curl -s localhost:8000/api/version

# restart (after changing code)
launchctl kickstart -k gui/$(id -u)/com.michael.tunarr

# stop / start
launchctl bootout   gui/$(id -u)/com.michael.tunarr
launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.michael.tunarr.plist

# logs
tail -f ~/Library/Logs/tunarr-service.log

# who is connected (the only place client IP / user agent appears)
curl -s localhost:8000/api/sessions | python3 -m json.tool
```

## Changing settings

Streaming knobs live in the UI under **Settings → Michael's Settings** and apply
to the next stream. No restart.

The UI is the source of truth. `TUNARR_SESSION_STALENESS_MS` and
`TUNARR_SESSION_CLEANUP_DELAY_SECONDS` still override it if set, but they are
deliberately **not** set in the agent's environment — if someone sets them via
`launchctl setenv`, the UI values will appear to be ignored.

## Benchmarking

Two traps produce meaningless numbers. Both must be handled.

1. **Warm sessions** — reconnecting within the staleness window returns a live
   session instantly.
2. **Orphaned FFmpeg** — an orphan keeps writing segments into the working
   directory, satisfying the readiness gate immediately and yielding bogus
   sub-10 ms readings.

A correct cold measurement:

```bash
CH=113
curl -s -X DELETE "http://localhost:8000/api/channels/$CH/sessions" -o /dev/null
sleep 12                                   # let teardown finish
pkill -9 -f hls_segment_filename            # reap orphans
sleep 2
curl -s -o /dev/null -w "%{time_total}s\n" \
     "http://localhost:8000/stream/channels/$CH.m3u8"
```

!!! danger "Never delete the session working directory"
    Removing `~/Library/Preferences/tunarr/streams/stream_<uuid>/` while a
    session object exists wedges the channel in a cached error state — it returns
    HTTP 500 until the session is dropped. Delete the session through the API
    instead, and if you must clear files, remove the files and leave the
    directory.

To confirm a stream is real rather than the offline fallback, check what FFmpeg
is reading:

```bash
ps -ww -o args= -p $(pgrep -f hls_segment_filename | head -1) | grep -o '\-i [^ ]*'
```

A path under `/Volumes` is real media. `generic-offline-screen.png` means the
transcode failed and Tunarr fell back to the error screen.

## Rollback to the packaged app

A pre-cutover backup of the database, settings, and channel lineups is at
`~/tunarr-backup-pre-cutover-20260912` (128 MB).

```bash
# 1. stop the fork
launchctl bootout gui/$(id -u)/com.michael.tunarr

# 2. (only if the database needs restoring)
cp ~/tunarr-backup-pre-cutover-20260912/db.db* ~/Library/Preferences/tunarr/
cp ~/tunarr-backup-pre-cutover-20260912/settings.json ~/Library/Preferences/tunarr/

# 3. start the packaged app, and re-add it to Login Items if you want it at boot
open -a Tunarr
```

The packaged app ignores the `streaming` settings section it does not understand,
so the config does not need cleaning up first.

## Updating from upstream

!!! note "Rebundling the web app"
    The service reports version `1.3.14-michael` via `TUNARR_VERSION` in the
    LaunchAgent. The web bundle bakes its version in at build time from the same
    variable, so rebundle with it set or the UI shows a permanent
    "Version Mismatch!" banner:

    ```bash
    TUNARR_VERSION=1.3.14-michael pnpm --filter @tunarr/web bundle
    ```

!!! note "ffmpeg must have libfreetype"
    The episode overlay uses `drawtext`, which Homebrew's default `ffmpeg`
    bottle does not include. This deployment points at `ffmpeg-full`
    (`/opt/homebrew/opt/ffmpeg-full/bin/ffmpeg`), which is keg-only and installs
    alongside without shadowing the default. Verify with
    `ffmpeg -filters | grep drawtext`. If it is missing the overlay is skipped
    with a warning; streaming is unaffected.

```bash
git fetch upstream --tags
git rebase v1.3.15            # or whichever tag
pnpm install
pnpm build                    # typecheck; catches API drift
pnpm --filter @tunarr/web bundle
launchctl kickstart -k gui/$(id -u)/com.michael.tunarr
```

Rebasing onto a new tag is likely to conflict in `SessionManager.ts` and around
the HLS output format, since those are where the local changes concentrate. Read
[Local Changes](local-changes.md) before resolving.

After any change to the settings schema, regenerate the three generated
artifacts — see
[Regenerating after schema changes](local-changes.md#regenerating-after-schema-changes).

## Health checks

```bash
curl -s localhost:8000/api/version                    # expect 1.3.14-michael
curl -s localhost:8000/api/system/settings | python3 -c \
  "import sys,json; print(json.load(sys.stdin)['streaming'])"
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/channels.m3u
curl -s -o /dev/null -w '%{http_code}\n' localhost:8000/api/xmltv.xml
```

If startup latency regresses, **check the FFmpeg version first** — an FFmpeg in
the 8.x line silently reintroduces the original 10–12 second problem. See
[Performance Investigation](performance-investigation.md).
