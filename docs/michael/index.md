# Local Fork Notes

This directory documents a private fork of Tunarr v1.3.14 running on a single
Mac. It is not upstream documentation — everything here describes changes and
operational choices specific to this deployment.

## Why the fork exists

Channels took **10–12 seconds** to start on an Apple TV. The investigation found
the cause was not Tunarr's configuration, the NAS, or the transcode profile — it
was an FFmpeg 8.x regression that silently disabled Tunarr's startup buffering
strategy. Fixing that took startup to ~2 seconds with no code changes at all.

The fork exists for the problems that remained after that: channel surfing piled
up unbounded concurrent transcodes, and every knob governing startup latency was
hardcoded.

Result on the same hardware:

| | Before | After |
|---|---|---|
| Cold channel start | ~11 s | **1.0–2.0 s** |
| While surfing channels | degraded to ~9 s | **1.0–3.0 s, flat** |
| Concurrent transcodes | unbounded | capped, LRU eviction |

## Contents

- **[Performance Investigation](performance-investigation.md)** — how the 10–12s
  was diagnosed, what was measured, and what turned out not to matter. Read this
  before changing any streaming setting.
- **[Local Changes](local-changes.md)** — what this fork changes relative to
  upstream v1.3.14 and why each change exists.
- **[Operations](operations.md)** — how the service runs, how to restart it, how
  to benchmark it correctly, and how to roll back to the packaged app.

## The environment this applies to

- Mac (Apple silicon, 12-core), wired Ethernet to a switch
- Synology NAS on the same switch, shares mounted over SMB under `/Volumes`
- Media source is Plex with `plexStream.streamPath: "direct"`, so FFmpeg reads
  files from the SMB mounts rather than streaming from Plex
- Client is an Apple TV running iPlayTV, which reports itself as
  `VLC/3.0.4 LibVLC/3.0.4`
- Hardware transcoding via VideoToolbox

Numbers in these documents come from this setup. The conclusions about FFmpeg
versions are general; the timings are not.
