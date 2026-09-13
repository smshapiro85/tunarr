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

## Reaching sub-1-second starts

A second round targeted sub-1s channel start *including* four concurrent
streams. Two changes got there.

**Segment duration to 1 second.** Time to first segment, measured directly:

| `hls_time` | First segment |
|---|---|
| 2 | 1,197 ms |
| 1 | 728 / 700 ms |

**Decoupling the readiness poll from its timeout budget.** Upstream polls on a
fixed 1-second tick, so a segment ready at 740 ms still waited until 1,000 ms —
every channel start rounded up to a whole second. Instrumenting the gap
confirmed it: the first segment file appeared at ~976 ms and the HTTP response
came at 1,124 ms.

The poll interval is now configurable (default 100 ms) with `retries` derived
from a separate timeout budget, so shortening the interval cannot silently
shorten the 15-second ceiling and turn slow tunes into HTTP 500s.

### Concurrency stopped mattering

The key result. Time to first segment at `hls_time 1`, with background
transcodes running:

| Competing transcodes | First segment |
|---|---|
| 0 | 762 / 735 ms |
| 1 | 715 / 717 ms |
| 3 (four total) | **741 / 745 ms** |

Essentially flat. The earlier collapse to 9 seconds under load came from needing
*8 seconds of media* through a contended encoder. At 1 second of media, four
concurrent streams cost nothing measurable.

### Where it landed

Cold-start medians of 3 runs per channel, full reset between each:

| Channel | Runs (ms) | Median |
|---|---|---|
| 113 (4K HEVC source) | 1260 / 626 / 1052 | 1,052 ms |
| 116 | 1141 / 540 / 653 | 653 ms |
| 119 | 544 / 652 / 857 | 652 ms |
| 120 | 826 / 755 / 854 | 826 ms |
| 100 | 726 / 746 / 537 | 726 ms |

Four of five medians are sub-second, and surfing six channels against the
4-stream cap produced 729–958 ms on five of six.

Results are bimodal — the first run after a reset is consistently the slowest,
which points at file caching rather than anything in Tunarr. A genuinely cold
file read lands around 1.0–1.3 s; a warm one around 540–860 ms. Source
resolution is *not* the driver: the 4K HEVC channel was among the fastest.

The floor is roughly 700 ms: FFmpeg spawn, SMB open, seek, VideoToolbox init,
one second of encoding, plus ~50–150 ms of Tunarr overhead.

### Tried and rejected

Bounding FFmpeg's input analysis with `-probesize` / `-analyzeduration` (which
Tunarr never sets) looked promising and **did not help**. Against an unbounded
default that repeated at 718 ms, bounded runs measured 707–730 ms — inside the
noise. Not adopted.

## Rebuffering: `-readrate 1` does not sustain 1x

Reported as buffering on a wired Apple TV with a 3-second client buffer. The
first instinct — raising `videoBufferSize` — is the wrong lever: that is
`-bufsize:v`, the VBV rate-control buffer, which constrains how much the
*encoder's* bitrate may fluctuate. It has nothing to do with playback.

Measuring actual media produced (summing `EXTINF`, not counting files) against
wall clock showed the transcode running at **0.5–0.78x** after the initial
burst. At 48s of wall clock the client needed 48s of media and only 36s
existed — a 12-second starvation.

Reproduced outside Tunarr with the same arguments, 45s per run:

| `-readrate` | Achieved | Worst margin vs 1x playback |
|---|---|---|
| 1 | 0.78x | **-10s (starves)** |
| 1.5 | 1.02x | +1s |
| 2 | 1.11x | +5s |

ffmpeg's `-readrate 1` simply does not hold 1x in this pipeline. This was always
true, but `hls_time 4` with a 2-segment gate handed the client ~8s of cushion up
front, which masked the drift. Cutting the segment gate to ~1s for fast startup
removed the cushion and exposed it.

`transcodeReadRate` (default 2) makes the rate configurable. Verified live: the
margin holds at +5 to +7s for the whole run instead of going negative.

### Ruled out along the way

- **The episode overlay.** Suspected first, since drawtext runs per frame. It
  costs nothing measurable: 13.20x vs 13.25x realtime with and without.
- **Keyframe cadence.** Forcing a keyframe every second (`-g 24`) versus every
  four (`-g 96`) made no difference: 7.99x vs 8.08x.
- **Encoder capacity.** The ceiling is ~8–13x realtime for a 1080p source, far
  above what is needed.

!!! warning "Count media, not files"
    An early pass counted `.ts` files and assumed one file per second, which
    produced a bogus picture during session rollovers. Sum `EXTINF` from the
    playlist instead.

## Segment duration: startup vs buffer depth

`hlsSegmentSeconds` trades the two directly, because a player holding N
segments holds N x that many seconds of video. Measured on this deployment:

| Segment length | Cold start | Steady-state margin vs 1x playback | 3-segment client holds |
|---|---|---|---|
| 1s | ~0.75 s | +5 to +7 s | 3 s |
| 2s | ~1.0–1.25 s | **+14 to +22 s, growing** | 6 s |

1s was chosen first while chasing sub-second startup, and it does achieve that.
It also leaves almost no cushion, which is what surfaced the `-readrate`
shortfall above as audible rebuffering. 2s is the better operating point here:
roughly 350ms of startup buys several times the margin.

## Channels failing to load after surfing

Symptom: after tuning six or seven channels, nothing would load. The server log
showed `No master playlist found for channel ...`, which the playlist route
turns into an HTTP 500.

Two causes, both self-inflicted:

**The readiness gate did not wait for the master playlist.** It waited for
segments and `stream.m3u8`, but the route requires `playlist.m3u8`, which ffmpeg
writes separately. Normally both land within the same millisecond, so a 1s poll
never noticed. Dropping the poll to 100ms tightened the window, and an evicted
session's delayed directory cleanup can remove the master out from under its
replacement. `getAdditionalRequiredFiles()` now includes it, so that case
retries instead of failing.

**The concurrency cap was churning sessions.** Measured on the same eight-channel
surf:

| Cap | Evictions | Load times | Failures |
|---|---|---|---|
| 4 | 12 | 0.85–3.4 s | 0 (after the gate fix) |
| 10 | 0 | 0.84–1.76 s | 0 |

The cap existed because concurrency used to cost a great deal — 2s alone versus
9s with eight sessions — but that was a consequence of the gate requiring ~8s of
media. With a ~2s gate the contention is minor, so a tight cap buys nothing and
every eviction is another chance to hit the cleanup race. Default raised to 10.

## Second optimisation round (external review)

A second opinion from another model, given the measured history, produced one
adopted change and two rejected ones.

**Adopted — `initialSegmentCount` 1 → 2.** libVLC 3.0.4 schedules playlist
refreshes on whole-second arithmetic (roughly
`nextUpdate = floor(now) + TARGETDURATION - 1`), so a playlist listing a single
segment leaves the client idle until its next refresh tick. Serving two costs
about 100ms on the server and measured faster to first frame:

| `initialSegmentCount` | Server playlist | Time to first frame |
|---|---|---|
| 1 | 1.23 s | 1.58 s |
| **2** | **1.33 s** | **1.38 s** |
| 3 | 1.84 s | 1.59 s |

A slower playlist response producing an earlier picture is the whole point —
optimise time to first frame, not time to playlist.

**Rejected — true MPEG-TS transport.** Ranked first by the reviewer, on the
theory that plain TS avoids segment completion and playlist refresh entirely.
It is broken in this build: `?streamMode=mpegts` runs a concat-demuxer session
that exits with code 183 and serves zero bytes. Note `.ts` inherits the
channel's stream mode unless overridden, so a naive `.ts` test silently measures
HLS-over-concat instead.

**Rejected — VideoToolbox low-delay flags.** Measured worse, not better:

| Flags | Time to 2 segments |
|---|---|
| baseline | 1.436 s |
| `-bf:v 0` | 1.435 s |
| `+low_delay` | 2.411 s |
| `+ -realtime:v 1` | 2.057 s |

`-bf:v 0` changes nothing because VideoToolbox emits no B-frames here anyway.

**Also ruled out for this client**, from reading the 3.0.4 parser: `EXT-X-START`,
Apple LL-HLS part/preload tags, and `EXT-X-PLAYLIST-TYPE` are all unhandled and
offer no startup shortcut. `-hls_init_time` cannot produce a short first segment
while `append_list` is in use.

End-to-end time to first frame now measures 1.6–2.6 s (median ~2.0 s), against
~1.1–1.9 s to serve the playlist. Run-to-run variance is significant; treat
single measurements sceptically.

## Tonemapping was running at source resolution

A tonemapped 4K HDR channel measured 518% CPU and only 1.5x realtime, against
36% and 2.2x for a normal channel — surprising on a 12-core M2 Max.

The cause was filter order. `SoftwarePipelineBuilder` ran `setTonemap()` before
`setScale()`, so the tonemap chain — which converts to 32-bit float RGB and
works per pixel — processed the full 3840x2160 frame before it was downscaled to
1080p. Four times the necessary pixels through the most expensive filter in the
pipeline.

Reordering `setScale()` ahead of `setTonemap()`:

| | Before | After |
|---|---|---|
| ffmpeg CPU | 518% | **182%** |
| Throughput (offline, unthrottled) | 1.97x realtime | **4.95x** |
| Live production rate | 1.50x | 1.80x (now near the `readrate 2` ceiling, no longer CPU-bound) |

Quality cost is negligible: **VMAF 97.26** between the two orderings, where >95
is visually indistinguishable. Scaling PQ-encoded samples is theoretically less
correct than linearising first, but the measured difference does not justify
quadrupling the cost.

This also removed the practical one-tonemapped-channel-at-a-time limit — at 182%
rather than 518%, several can run concurrently.

## Playlist exhaustion at startup

Symptom: channel starts fast, buffering indicator appears a few seconds in, then
plays cleanly forever.

The client's first playlist fetch carried only `initialSegmentCount x
hlsSegmentSeconds` of media — 4s at 2x2. It plays that, then must refresh the
playlist to learn about more, and VLC 3.0.4's whole-second refresh scheduling
can be 1-2s late. The buffer empties in between. Once the refresh lands the
client receives the full playlist (100+ segments) and never stalls again.

Raising `initialSegmentCount` to 3 (6s of media) bridges the gap and resolved it
on the actual Apple TV. The cost is roughly 0.25-0.5s of startup.

## Client-side latency

Server-side is ~1–2 s, but the Apple TV shows 3–5 s. The remainder is iPlayTV,
which is built on libVLC 3.0.4 and reports `VLC/3.0.4 LibVLC/3.0.4`. libVLC
defaults to 1000 ms `network-caching` and prefetches segments before rendering.
That is a client setting and cannot be influenced from the server.

Note that Tunarr does **no HTTP request logging** — the streaming routes are
declared `disableRequestLogging: 'only-errors'`. Client IP and user agent appear
only in live session state via `GET /api/sessions`, never in the log file.
