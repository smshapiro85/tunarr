import MichaelSettingsPage from '@/pages/settings/MichaelSettingsPage';
import { createFileRoute } from '@tanstack/react-router';
import { getApiSystemSettingsOptions } from '../../generated/@tanstack/react-query.gen.ts';

export const Route = createFileRoute('/settings/michael')({
  loader: async ({ context }) => {
    await context.queryClient.ensureQueryData(getApiSystemSettingsOptions());
  },
  component: MichaelSettingsPage,
});
