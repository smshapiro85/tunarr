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
| `maxConcurrentSessions` | *did not exist* | 10 | Cap on simultaneous transcodes. 0 disables. |
| `sessionStalenessMs` | 120,000 (env only) | 30,000 | How long a viewer may go without requesting the playlist before being dropped. |
| `sessionCleanupDelaySeconds` | 15 (env only) | 10 | Grace period after the last viewer leaves before teardown. |
| `initialSegmentCount` | 2 (hardcoded) | 1 | Segments that must exist before the playlist is served. |
| `hlsSegmentSeconds` | 4 (hardcoded) | 2 | HLS segment duration. |
| `readinessPollMs` | 1000 (hardcoded) | 100 | How often to check whether the stream can be served. |
| `readinessTimeoutMs` | 15,000 (implied) | 15,000 | Total wait before failing the request. |
| `episodeOverlayEnabled` | *did not exist* | true | Show season/episode briefly when a channel starts. |
| `episodeOverlaySeconds` | *did not exist* | 5 | How long it stays up, fade included. |
| `transcodeReadRate` | 1 (hardcoded) | 2 | Input read rate as a multiple of real time. |
| `epgEpisodePrefix` | *did not exist* | true | Put season/episode/title in EPG descriptions. |

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

## Program overlay

Shows up to two right-aligned lines in the lower-right corner when a channel
starts, then fades out. What they say depends on the program type — the first
line is rendered larger, so it carries whatever identifies the program most
directly:

| Type | Line 1 | Line 2 |
|---|---|---|
| Episode | `Season 5 - Episode 2` | episode title |
| Episode, no numbering | show title | episode title |
| Movie | title | year |
| Track / music video | title | artist |
| Other video | title | — |

A line is dropped when its field is empty, so a movie with no year or a track
with no artist shows a single line rather than a gap.

Rendered as one `drawtext` per line. drawtext has no right-align mode, but each
filter resolves `tw` against its own string, so `x=w-tw-margin` aligns the lines
independently. The fade is an alpha ramp over the final 0.75s rather than
`enable=`, which would pop the text off in a single frame. Verified against a
live stream: text present through t≈4s, and the corner is pixel-identical to a
clean plate from t≈6s.

Gated on `isFirstTranscode`, so it appears when a viewer tunes in and not again
each time the session rolls to the next program. A session spawns a fresh ffmpeg
per program *and* mid-episode when the transcode buffer runs low, so anything
ungated would flash the overlay back up mid-show.

The setting keys are still named `episodeOverlay*`. They predate the overlay
covering movies and music, and renaming them would orphan the stored values for
no functional gain.

!!! warning "Requires an ffmpeg with libfreetype"
    `drawtext` needs libfreetype, and **Homebrew's default `ffmpeg` bottle does
    not have it** — check with `ffmpeg -filters | grep drawtext`. This
    deployment uses `ffmpeg-full` (keg-only, installs alongside without
    shadowing the default). The pipeline checks `hasFilter('drawtext')` and logs
    a warning rather than failing, since an unavailable filter would otherwise
    break the whole graph and drop the channel to the error screen.

Font resolution walks a candidate list covering macOS, Debian and Alpine, and is
cached — it runs on the latency-sensitive stream start path.

Episode titles routinely contain `:` and `'`, which drawtext parses as an option
separator and a quote. Rather than escape them, the filter substitutes: a
typographic apostrophe renders identically and `:` becomes a dash.

## Channel logos over a non-LAN address

Channel icons are stored as absolute URLs captured when the icon was uploaded —
in practice a LAN address, because that is how the browser reached the server.
The M3U and XMLTV outputs substitute `{{host}}` with the requesting host, so
stream URLs and programme icons follow whatever address a client arrived on, but
the stored channel icon URL was emitted verbatim.

The result: a client reaching Tunarr by any other route (Tailscale, a reverse
proxy, a hostname) plays streams fine but every channel logo silently fails to
load. On this deployment the phone IPTV app over Tailscale showed no logos while
the Apple TV on the LAN was unaffected.

`resolveHostTemplatedIconUrl()` rewrites a locally-uploaded icon to
`{{host}}/images/uploads/<file>` so host substitution applies. Externally hosted
icons are left alone.

!!! warning "Use it only where `{{host}}` is substituted"
    M3UService and XmlTvWriter run their output through host substitution, so
    they use the templated helper. `TvGuideService` emits real URLs for the web
    guide and must keep using plain `resolveIconUrl`, or the literal `{{host}}`
    would leak into the response.

No data migration is needed — the rewrite happens at render time, so existing
icons and any future upload are both covered.

## Season and episode in EPG descriptions

Some guide clients surface only the description field, ignoring `sub-title` and
`episode-num`. `XmlTvWriter.withEpisodePrefix()` prepends the season, episode
number and episode title:

```
Season 1 Episode 4 "Gates of the Arctic" - Alaska is often called the last...
```

It is applied **when the guide is rendered**, derived purely from the source
fields, and never written back to the stored description. That makes
double-application structurally impossible rather than something guarded
against — regenerating the guide always recomputes from the same inputs.

It degrades one piece at a time instead of emitting placeholders:

| Case | Result |
|---|---|
| Episode with season, number and title | full prefix |
| Episode title missing, or identical to the show title | prefix without the quoted part |
| Season or episode number missing | description returned untouched |
| No description at all | prefix alone, no dangling separator |
| Movie, track, anything not an episode | untouched |

Verified across a full 1,359-programme guide: 1,339 prefixed, zero
double-applied, zero episodes missed, and zero stored `Program.summary` rows
mutated. Regenerating a second time changed no description.

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
| `server/src/stream/hls/BaseHlsSession.ts` | readiness poll decoupled from timeout budget |
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
