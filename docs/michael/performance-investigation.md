# Performance Investigation

Record of the September 2026 investigation into slow channel startup. Every
number here was measured on the deployment described in the [index](index.md),
against Tunarr v1.3.14. Nothing is estimated unless labelled as such.

## The symptom

Starting a channel on the Apple TV took 10–12 seconds. Reconnecting to a channel
watched moments earlier was instant, which pointed at session reuse masking a
slow cold path.

Reproduced with a direct request to the playlist endpoint, bypassing the client:

```
GET /stream/channels/114.m3u8   →  11,060 ms (median of 3: 11056, 11060, 11060)
time until 3 segments available →  14,423 ms
```

## Root cause: FFmpeg 8.x ignores `-readrate_initial_burst`

Tunarr starts every transcode with `-readrate 1 -readrate_initial_burst 60`. The
intent is: read the first 60 seconds of input as fast as possible to fill the
startup buffer, then settle to 1× real time so the transcode does not race ahead
of the wall clock.

**FFmpeg 8.x accepts that flag and does nothing with it.** The input therefore
stays pinned at 1× from the first frame, so the startup buffer fills in real
time. Producing the ~8 seconds of media the readiness gate required took ~8
seconds of wall clock.

Isolated with the simplest possible command — stream copy, no filters, no
hardware acceleration, 20 seconds of output:

| FFmpeg | `-readrate 1` + `burst 60` | `-readrate 1` alone | no `-readrate` |
|---|---|---|---|
| 8.0.1 | 19.93 s | 19.95 s | 0.08 s |
| 7.1.5 | **0.52 s** | 19.63 s | 0.09 s |
| 9.0.1 | **0.04 s** | — | — |

The burst had no effect at *any* value on 8.0.1 (tested 5, 25, and 60). It works
correctly on both 7.1.5 and 9.0.1, so this is specific to the 8.x line.

`-readrate` itself works fine on 8.0.1 and scales as documented — 20 seconds of
media took 21.74 s at `-readrate 1`, 10.96 s at 2, and 6.30 s at 4. Only the
burst is broken.

### The fix

Upgrading FFmpeg 8.0.1 → 9.0.1 resolved it with **no Tunarr changes**:

| | FFmpeg 8.0.1 | FFmpeg 9.0.1 |
|---|---|---|
| Playlist served | 11,060 ms | **2,543 ms** |
| 3 segments ready | 14,423 ms | 4,078 ms |

Verified across channels 100/101/116/119/120 at 2.0–3.1 s, with zero errors
during clean sessions and segments decoding as valid 1080p h264 / AAC.

!!! warning "Check the FFmpeg version first"
    If startup latency ever regresses, check `curl -s localhost:8000/api/version`
    before touching any setting. An FFmpeg downgrade into the 8.x line
    reintroduces this with no other symptom.

## The readiness gate

`BaseHlsSession.waitForStreamReady()` blocks the HTTP response until
`initialSegmentCount` segment files exist, polling on a fixed 1-second interval.
Upstream sets `initialSegmentCount: 2` with 4-second segments, so the server
waits for roughly 8 seconds of encoded media before answering.

The 1-second poll is visible in the raw data — baseline measurements clustered on
second boundaries (9060, 10060, 11060, 12059 ms) rather than distributing
smoothly.

Measured contribution of the gate, on FFmpeg 9 with the burst working:

| Configuration | Gate reached |
|---|---|
| `hls_time 4`, wait for 2 segments (upstream) | 2,849 ms |
| `hls_time 4`, wait for 1 segment | 1,247 ms |
| `hls_time 2`, wait for 1 segment | 892 ms |
| `hls_time 1`, wait for 1 segment | 750 ms |

Dropping to one segment is the single largest remaining win, and it is a
one-line change. See [Local Changes](local-changes.md).

## Concurrency: why surfing got slower

Each channel visited leaves a transcode running for the full staleness window.
Upstream's default is 120 s plus a 15 s teardown delay, so surfing eight channels
in two minutes leaves eight FFmpeg processes competing for the VideoToolbox
encoder.

Measured by surfing eight channels with a 6-second dwell, killing nothing:

| Concurrent transcodes | Load time |
|---|---|
| 2 | 3.0 s |
| 4 | 4.0 s |
| 6 | 6.0 s |
| 8 | **9.0 s** |

Isolated directly: the same channel took **2.02 s alone** and **9.03 s with eight
other sessions running** — a 4.5× penalty purely from contention. Total FFmpeg
CPU was only ~127% across all of them, so this is contention for the hardware
encoder and SMB reads, not CPU saturation.

There is no concurrency limit anywhere in upstream Tunarr. `hdhr.tunerCount`
applies only to HDHomeRun emulation, which is disabled here.

## What turned out not to matter

**The NAS and network.** Cold SMB open measured 22–46 ms across six files,
sequential read 335 MB/s, and `ffprobe` on a 2.5 GB 2160p HEVC file 52 ms. None
of this contributed.

!!! note
    One early reading showed a 78-second `open()`. That was an artifact of
    killing FFmpeg mid-read and forcing an SMB session recovery — not a real
    condition. It did not reproduce.

**Transcode profiles.** Four profiles were created and benchmarked over 3 cold
runs each against the 1080p 10 Mbps default:

| Profile | Playlist (median) |
|---|---|
| Default — 1080p 10 Mbps | 11,060 ms |
| 720p 4 Mbps | 9,060 ms |
| 720p 2 Mbps, reduced audio | 10,071 ms |
| 1080p, `threadCount: 8` | 10,067 ms |

Even 720p at 2 Mbps bought about one second. The bottleneck was input *read
rate*, not encoding work, so no profile could fix it. The profiles were deleted
afterwards.

**`threadCount`.** Ignored entirely whenever hardware decoding is active —
`BasePipelineBuilder.getThreadCountOption()` forces `-threads 1` when
`decoderHwAccelMode !== None`, before the config value is consulted.

**`-movflags +faststart` and `-threads 0`.** Both measured within noise of the
baseline.

## Benchmarking correctly

Two traps make results meaningless:

**Warm sessions.** Reconnecting within the staleness window returns a live
session instantly. Always `DELETE /api/channels/<number>/sessions` first.

**Orphaned FFmpeg processes.** Tunarr does not always reap FFmpeg on session
teardown. An orphan keeps writing segments into the working directory, which
satisfies the readiness gate immediately and produces bogus sub-10 ms readings.
Always `pkill -f hls_segment_filename` as well.

Do **not** delete the session working directory while a session object exists —
the master playlist never reappears and the channel wedges in a cached error
state, returning HTTP 500 until the session is dropped.

The full procedure is in [Operations](operations.md#benchmarking).

## Client-side latency

Server-side is ~1–2 s, but the Apple TV shows 3–5 s. The remainder is iPlayTV,
which is built on libVLC 3.0.4 and reports `VLC/3.0.4 LibVLC/3.0.4`. libVLC
defaults to 1000 ms `network-caching` and prefetches segments before rendering.
That is a client setting and cannot be influenced from the server.

Note that Tunarr does **no HTTP request logging** — the streaming routes are
declared `disableRequestLogging: 'only-errors'`. Client IP and user agent appear
only in live session state via `GET /api/sessions`, never in the log file.
