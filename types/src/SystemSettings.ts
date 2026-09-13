import { z } from 'zod/v4';
import { BackupSettingsSchema } from './schemas/settingsSchemas.js';
import { ScheduleSchema } from './schemas/utilSchemas.js';
import { type TupleToUnion } from './util.js';

export const LogCategories = ['scheduling', 'streaming'] as const;

export const LogCategoriesSchema = z.enum([...LogCategories]);

export const LogLevels = [
  'silent',
  'fatal',
  'error',
  'warn',
  'info',
  'http',
  'debug',
  'http_out',
  'trace',
] as const;

export const LogLevelsSchema = z.enum([...LogLevels]);

export type LogLevel = TupleToUnion<typeof LogLevels>;

export const LogRollConfigSchema = z.object({
  enabled: z.boolean().default(false),
  maxFileSizeBytes: z.number().positive().optional(),
  rolledFileLimit: z.number().positive(),
  schedule: ScheduleSchema.optional(),
});

export const LoggingSettingsSchema = z.object({
  logLevel: LogLevelsSchema,
  categoryLogLevel: z
    .partialRecord(LogCategoriesSchema, LogLevelsSchema.optional())
    .optional(),
  logsDirectory: z.string(),
  useEnvVarLevel: z.boolean().default(true),
  logRollConfig: LogRollConfigSchema.optional().default({
    enabled: false,
    maxFileSizeBytes: Math.pow(2, 20), // 1MB => 1,048,576 bytes
    rolledFileLimit: 3,
  }),
});

export type LoggingSettings = z.infer<typeof LoggingSettingsSchema>;

export const CacheSettingsSchema = z.object({
  // Preserve previous behavior
  enablePlexRequestCache: z.boolean().optional().default(false).catch(false),
});

export type CacheSettings = z.infer<typeof CacheSettingsSchema>;

export const SearchServerSettingsSchema = z.object({
  maxIndexingMemory: z.number().optional(),
  snapshotIntervalHours: z.number().default(4),
});

export const ServerSettingsSchema = z.object({
  port: z.number().min(1).max(65535).optional().default(8000),
  searchSettings: SearchServerSettingsSchema,
});

export type ServerSettings = z.infer<typeof ServerSettingsSchema>;

export const DefaultServerSettings = {
  port: 8000,
  searchSettings: {
    snapshotIntervalHours: 4,
  },
} satisfies ServerSettings;

/**
 * Streaming tuning knobs. Upstream hardcodes all of these; they are surfaced
 * here so they can be changed without a rebuild. Defaults are chosen for fast
 * channel start rather than upstream's conservative values.
 */
export const StreamingTuningSettingsSchema = z.object({
  /**
   * Max transcodes running at once. 0 disables the limit.
   *
   * A low cap was needed when the readiness gate required ~8s of media, which
   * made concurrent transcodes contend badly (2s alone vs 9s with eight). With
   * a ~2s gate that contention is largely gone, and aggressive eviction instead
   * churns sessions — each eviction is a chance for a stopped session's delayed
   * directory cleanup to race its own replacement. Keep this high enough that
   * ordinary channel surfing never evicts.
   */
  maxConcurrentSessions: z.number().int().min(0).max(64).default(10),
  /** How long a connection may go without a heartbeat before it is dropped. */
  sessionStalenessMs: z.number().int().min(1000).max(3_600_000).default(30_000),
  /** Grace period between a session losing its last viewer and teardown. */
  sessionCleanupDelaySeconds: z.number().int().min(0).max(3600).default(10),
  /**
   * Segments that must exist before the playlist is served. Upstream: 2.
   *
   * Counter-intuitively, 1 is not fastest end to end. libVLC 3.0.4 schedules
   * its playlist refresh on whole-second arithmetic, so a playlist listing only
   * a couple of segments is exhausted before the client learns about more, and
   * it stalls until the next refresh tick. 3 (6s of media) bridges that gap;
   * 2 still produced a visible buffering blip a few seconds into playback.
   */
  initialSegmentCount: z.number().int().min(1).max(10).default(3),
  /**
   * HLS segment duration in seconds. Upstream: 4.
   *
   * Trades startup against buffer depth: a player holding N segments holds
   * N x this many seconds. 1 gives the fastest start but leaves a typical
   * 3-segment client with only 3s of cushion, which rebuffers on any hiccup.
   */
  hlsSegmentSeconds: z.number().int().min(1).max(10).default(2),
  /**
   * How often to re-check whether the stream is ready to serve. Upstream polls
   * on a fixed 1s tick, which quantizes response time to whole seconds.
   */
  readinessPollMs: z.number().int().min(25).max(5_000).default(100),
  /** Total time to wait for readiness before failing the request. */
  readinessTimeoutMs: z.number().int().min(1_000).max(120_000).default(15_000),
  /**
   * Briefly show "Season N - Episode N" and the episode title in the
   * lower-right corner when a channel starts, then fade out.
   */
  episodeOverlayEnabled: z.boolean().default(true),
  /** How long the overlay stays up, including its fade-out. */
  episodeOverlaySeconds: z.number().min(1).max(60).default(5),
  /**
   * Input read rate for the steady-state transcode, as a multiple of real time.
   *
   * ffmpeg's `-readrate 1` does not actually sustain 1x here -- measured at
   * ~0.78x, so the stream falls behind a client playing at 1x and the player
   * rebuffers. Anything above 1 restores real-time parity with margin; Tunarr
   * stops building buffer on its own once it is far enough ahead, so this does
   * not run away from the wall clock.
   */
  transcodeReadRate: z.number().min(1).max(8).default(2),
  /**
   * Prefix EPG descriptions for episodes with season, episode number and
   * episode title, e.g. `Season 3 Episode 6 "Mystery of Panama" - <description>`.
   *
   * Applied when the guide is rendered, never written back to the stored
   * description, so regenerating the EPG cannot double-apply it.
   */
  epgEpisodePrefix: z.boolean().default(true),
});

export type StreamingTuningSettings = z.infer<
  typeof StreamingTuningSettingsSchema
>;

export const DefaultStreamingTuningSettings = {
  maxConcurrentSessions: 10,
  sessionStalenessMs: 30_000,
  sessionCleanupDelaySeconds: 10,
  initialSegmentCount: 3,
  hlsSegmentSeconds: 2,
  readinessPollMs: 100,
  readinessTimeoutMs: 15_000,
  episodeOverlayEnabled: true,
  episodeOverlaySeconds: 5,
  transcodeReadRate: 2,
  epgEpisodePrefix: true,
} satisfies StreamingTuningSettings;

export const SystemSettingsSchema = z.object({
  backup: BackupSettingsSchema,
  logging: LoggingSettingsSchema,
  cache: CacheSettingsSchema.optional(),
  server: ServerSettingsSchema.default(DefaultServerSettings),
  streaming: StreamingTuningSettingsSchema.default(
    DefaultStreamingTuningSettings,
  ),
});

export type SystemSettings = z.infer<typeof SystemSettingsSchema>;
