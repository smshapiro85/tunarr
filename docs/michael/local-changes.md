# Local Changes

What this fork changes relative to upstream Tunarr v1.3.14, and why. Branch:
`michael/v1.3.14-tuning`, forked from tag `v1.3.14`.

Upstream is configured as the `upstream` remote, so fixes can be pulled later.

## Summary

A `streaming` section was added to system settings, surfaced in the UI under a
new **Michael's Settings** tab. Every value in it was previously hardcoded or
reachable only through an environment variable.

| Setting | Upstream | Fork default | What it does |
|---|---|---|---|
| `maxConcurrentSessions` | *did not exist* | 4 | Cap on simultaneous transcodes. 0 disables. |
| `sessionStalenessMs` | 120,000 (env only) | 30,000 | How long a viewer may go without requesting the playlist before being dropped. |
| `sessionCleanupDelaySeconds` | 15 (env only) | 10 | Grace period after the last viewer leaves before teardown. |
| `initialSegmentCount` | 2 (hardcoded) | 1 | Segments that must exist before the playlist is served. |
| `hlsSegmentSeconds` | 4 (hardcoded) | 2 | HLS segment duration. |

Changes apply to the next stream that starts. No restart required.

Environment variables still take precedence where they already existed
(`TUNARR_SESSION_STALENESS_MS`, `TUNARR_SESSION_CLEANUP_DELAY_SECONDS`), so
existing deployments are unaffected by the new defaults.

## Concurrency limiting

`SessionManager.enforceConcurrencyLimit()` runs immediately before a new session
is constructed. When the cap is reached it evicts existing sessions to make room.

Eviction order:

1. Sessions **nobody is watching** are evicted first. These are only a warm
   cache, so dropping one costs a re-tune and nothing else.
2. Within each group, **least-recently-active** first, using
   `Session.lastActivity()` (the most recent heartbeat across all connections).
3. The channel being requested is **never** a candidate.

Sessions with live viewers are only evicted when nothing else can be — that is,
when every slot is actively watched.

!!! warning "Sizing the cap"
    With the cap at *N* and *N* people genuinely watching, an *N+1*th tune
    interrupts somebody. A cap of 4 is generous for a single client; raise it if
    you add TVs.

Verified: surfing six channels with the cap at 3 held at exactly 3 sessions with
eviction logged each time, and load times stayed flat at 1.0–2.0 s instead of
climbing.

## Segment duration plumbing

Upstream read segment duration from a module-level static,
`HlsOutputFormat.SegmentSeconds = 4`, which drove `-hls_time`, `-g`,
`-keyint_min` and `-force_key_frames`. Separately, `HlsSession.getHlsOptions()`
set `hlsTime: 4`, which drove only the playlist's `EXT-X-TARGETDURATION`.

Two unrelated places, no link between them — change one and the playlist
advertises a duration its segments do not have.

This fork routes the value from the session's `hlsOptions` through a new
`FfmpegState.hlsSegmentSeconds` getter into the `HlsOutputFormat` constructor.
The static remains as the default parameter, so any caller that does not pass a
value behaves exactly as before.

## Files changed

| File | Change |
|---|---|
| `types/src/SystemSettings.ts` | `StreamingTuningSettingsSchema` + defaults |
| `types/src/api/index.ts` | `streaming` on the update-settings request |
| `server/src/db/SettingsDB.ts` | defaults for new installs |
| `server/src/api/systemApi.ts` | field-by-field merge in the PUT handler |
| `server/src/stream/SessionManager.ts` | concurrency limit, settings-driven session options |
| `server/src/stream/Session.ts` | `lastActivity()` accessor for eviction ordering |
| `server/src/stream/hls/HlsSession.ts` | `hlsTime` from settings |
| `server/src/ffmpeg/builder/state/FfmpegState.ts` | `hlsSegmentSeconds` getter |
| `server/src/ffmpeg/builder/options/HlsOutputFormat.ts` | accepts segment duration |
| `server/src/ffmpeg/builder/pipeline/BasePipelineBuilder.ts` | passes it through |
| `web/src/pages/settings/MichaelSettingsPage.tsx` | the settings form |
| `web/src/routes/settings/michael.tsx` | route |
| `web/src/pages/settings/SettingsLayout.tsx` | tab link |

The settings update handler merges field by field rather than replacing the
section, matching the pattern upstream already uses for `logging` — every field
carries a `.default()`, so a `.partial()` schema would deliver defaults for keys
the client never sent and the handler could not distinguish "omitted" from
"sent".

## Incidental fix

Regenerating the API client (it had drifted from the committed OpenAPI spec)
exposed a latent bug: `ShowSearchSlotProgrammingForm` called
`/programs/:id/children` without the required `limit` and `offset`. Runtime was
unaffected because the server defaults them, but the stale client had been
hiding the type error. They are now sent explicitly with the same values the
server would apply (`-1`, `0`).

This is an upstream bug, not one introduced here.

## Regenerating after schema changes

Adding a settings field requires three generated artifacts to be refreshed, in
order:

```bash
# 1. OpenAPI spec — MUST pass -d or it writes to the live database directory
cd server && pnpm generate-openapi

# 2. Typed API client for the web app
cd ../web && pnpm generate-client

# 3. i18n catalogs, or the UI renders message hashes instead of labels
pnpm extract-messages && pnpm compile-messages
```

!!! danger "`generate-openapi` defaults to the live database"
    It takes `-d` like the server does, and without it defaults to
    `~/Library/Preferences/tunarr`. During this work it wrote default settings
    into the production config. Harmless in that instance, but pass `-d` at a
    scratch directory.

## Known upstream issues not fixed here

Found during the investigation, left alone to keep the diff small:

- **Orphaned FFmpeg processes.** Deleting a session returns 404 but its FFmpeg
  may keep running and writing segments. A subsequent tune then finds the
  readiness gate already satisfied and serves a stale playlist pointing at dead
  segments — the client gets a valid manifest with nothing behind it.
- **Frame rate always 24.** `MediaStream.getNumericFrameRateOrDefault()` parses
  into a local `intParsed` that is never assigned to the result, so the default
  is always returned. This is why `-g 96` appears regardless of source frame
  rate.
- **Segment cleanup disabled.** `trimPlaylistAndDeleteSegments()` is commented
  out at both call sites in `HlsSession`, so segments accumulate for the life of
  a session.
- **Pre-existing lint error** in `HlsSession.ts` (`consistent-type-imports`),
  present at the `v1.3.14` tag.
