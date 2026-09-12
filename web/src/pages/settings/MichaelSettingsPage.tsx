import { NumericFormControllerText } from '@/components/util/TypedController.tsx';
import {
  useSystemSettings,
  useUpdateSystemSettings,
} from '@/hooks/useSystemSettings.ts';
import { Trans, useLingui } from '@lingui/react/macro';
import { Alert, Box, Divider, Typography } from '@mui/material';
import Button from '@mui/material/Button';
import Grid from '@mui/material/Grid';
import Stack from '@mui/material/Stack';
import type { StreamingTuningSettings } from '@tunarr/types';
import { useSnackbar } from 'notistack';
import { useCallback } from 'react';
import { useForm } from 'react-hook-form';

/**
 * Local additions that are not part of upstream Tunarr. Everything here maps to
 * a value upstream hardcodes; see StreamingTuningSettingsSchema.
 */
export default function MichaelSettingsPage() {
  const { t } = useLingui();
  const snackbar = useSnackbar();
  const systemSettings = useSystemSettings();
  const updateSystemSettings = useUpdateSystemSettings();

  const streaming = systemSettings.data?.streaming;

  const {
    control,
    handleSubmit,
    reset,
    formState: { isDirty, isValid },
  } = useForm<StreamingTuningSettings>({
    mode: 'onChange',
    values: streaming,
  });

  const onSubmit = useCallback(
    (data: StreamingTuningSettings) => {
      updateSystemSettings.mutate(
        { body: { streaming: data } },
        {
          onSuccess(response) {
            reset(response.streaming, { keepDirty: false });
            snackbar.enqueueSnackbar(t`Settings Saved!`, {
              variant: 'success',
            });
          },
          onError(err) {
            console.error(err);
            snackbar.enqueueSnackbar(
              t`Error while saving settings. Check the console for details.`,
              { variant: 'error' },
            );
          },
        },
      );
    },
    [updateSystemSettings, reset, snackbar, t],
  );

  if (!streaming) {
    return null;
  }

  return (
    <Box component="form" onSubmit={handleSubmit(onSubmit)}>
      <Typography variant="h6" sx={{ mb: 1 }}>
        <Trans>Stream Startup &amp; Concurrency</Trans>
      </Typography>
      <Alert severity="info" sx={{ mb: 2 }}>
        <Trans>
          These are local additions. Upstream Tunarr hardcodes every value on
          this page. Changes apply to the next stream that starts &mdash; no
          restart needed.
        </Trans>
      </Alert>

      <Grid container spacing={2} columns={{ xs: 1, sm: 2 }}>
        <Grid size={1}>
          <NumericFormControllerText
            control={control}
            name="maxConcurrentSessions"
            rules={{ min: 0, max: 64 }}
            TextFieldProps={{
              fullWidth: true,
              label: t`Max concurrent transcodes`,
              helperText: t`Channel surfing leaves one ffmpeg per channel visited, and they compete for the hardware encoder. When this limit is hit, the least-recently-watched channel is stopped. 0 disables the limit.`,
            }}
          />
        </Grid>

        <Grid size={1}>
          <NumericFormControllerText
            control={control}
            name="sessionStalenessMs"
            rules={{ min: 1000, max: 3_600_000 }}
            TextFieldProps={{
              fullWidth: true,
              label: t`Viewer timeout (ms)`,
              helperText: t`How long a viewer may go without asking for the playlist before it is dropped. Must stay comfortably above the segment duration, or an active viewer gets disconnected. Upstream: 120000.`,
            }}
          />
        </Grid>

        <Grid size={1}>
          <NumericFormControllerText
            control={control}
            name="sessionCleanupDelaySeconds"
            rules={{ min: 0, max: 3600 }}
            TextFieldProps={{
              fullWidth: true,
              label: t`Teardown delay (seconds)`,
              helperText: t`Grace period after the last viewer leaves before the transcode is stopped. Longer keeps a re-tune instant; shorter frees a slot sooner. Upstream: 15.`,
            }}
          />
        </Grid>

        <Grid size={1}>
          <NumericFormControllerText
            control={control}
            name="initialSegmentCount"
            rules={{ min: 1, max: 10 }}
            TextFieldProps={{
              fullWidth: true,
              label: t`Segments before playback`,
              helperText: t`Segments that must exist before the playlist is served. This is the single biggest lever on channel start time. Upstream: 2.`,
            }}
          />
        </Grid>

        <Grid size={1}>
          <NumericFormControllerText
            control={control}
            name="hlsSegmentSeconds"
            rules={{ min: 1, max: 10 }}
            TextFieldProps={{
              fullWidth: true,
              label: t`Segment duration (seconds)`,
              helperText: t`Length of each HLS segment. Shorter starts faster but makes more files and more keyframes, which costs bitrate. Upstream: 4.`,
            }}
          />
        </Grid>
      </Grid>

      <Divider sx={{ my: 2 }} />

      <Stack direction="row" justifyContent="flex-end" gap={1}>
        <Button
          variant="outlined"
          disabled={!isDirty}
          onClick={() => reset(streaming)}
        >
          <Trans>Reset</Trans>
        </Button>
        <Button
          variant="contained"
          type="submit"
          disabled={!isValid || !isDirty || updateSystemSettings.isPending}
        >
          <Trans>Save</Trans>
        </Button>
      </Stack>
    </Box>
  );
}
