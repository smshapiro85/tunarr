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
  /** Max transcodes running at once. 0 disables the limit. */
  maxConcurrentSessions: z.number().int().min(0).max(64).default(4),
  /** How long a connection may go without a heartbeat before it is dropped. */
  sessionStalenessMs: z.number().int().min(1000).max(3_600_000).default(30_000),
  /** Grace period between a session losing its last viewer and teardown. */
  sessionCleanupDelaySeconds: z.number().int().min(0).max(3600).default(10),
  /** Segments that must exist before the playlist is served. Upstream: 2. */
  initialSegmentCount: z.number().int().min(1).max(10).default(1),
  /** HLS segment duration in seconds. Upstream: 4. */
  hlsSegmentSeconds: z.number().int().min(1).max(10).default(2),
});

export type StreamingTuningSettings = z.infer<
  typeof StreamingTuningSettingsSchema
>;

export const DefaultStreamingTuningSettings = {
  maxConcurrentSessions: 4,
  sessionStalenessMs: 30_000,
  sessionCleanupDelaySeconds: 10,
  initialSegmentCount: 1,
  hlsSegmentSeconds: 2,
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
