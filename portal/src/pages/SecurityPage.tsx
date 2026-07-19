import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Laptop, LogOut, ShieldCheck } from 'lucide-react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { z } from 'zod';
import { api, jsonBody, type PageEnvelope } from '../lib/api';
import { formatDate, shortId } from '../lib/format';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  PaperCard,
  SkeletonGrid,
  Stamp,
} from '../components/ui';

interface Device {
  id: string;
  deviceId: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt: string | null;
}

const passwordSchema = z.object({
  currentPassword: z.string().min(8).max(128),
  newPassword: z.string().min(8, 'Use at least 8 characters.').max(128),
  confirmPassword: z.string(),
}).refine((values) => values.newPassword === values.confirmPassword, {
  path: ['confirmPassword'],
  message: 'Passwords do not match.',
}).refine((values) => values.currentPassword !== values.newPassword, {
  path: ['newPassword'],
  message: 'Choose a different password.',
});

type PasswordValues = z.infer<typeof passwordSchema>;

export function SecurityPage() {
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState<Device | null>(null);
  const [revokeOthers, setRevokeOthers] = useState(false);
  const [notice, setNotice] = useState('');
  const client = useQueryClient();
  const devices = useQuery({
    queryKey: ['devices', page],
    queryFn: () => api<PageEnvelope<Device>>(`/api/portal/devices?page=${page}&limit=12`),
  });
  const mutation = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      api<Record<string, unknown>>(path, { method, ...(body ? jsonBody(body) : {}) }),
    onSuccess: (_, variables) => {
      setSelected(null);
      setRevokeOthers(false);
      setNotice(variables.path.includes('revoke-others')
        ? 'Other device sessions were revoked.'
        : 'The device session was revoked.');
      void client.invalidateQueries({ queryKey: ['devices'] });
    },
  });
  const form = useForm<PasswordValues>({ resolver: zodResolver(passwordSchema) });

  const changePassword = form.handleSubmit(async ({ currentPassword, newPassword }) => {
    setNotice('');
    try {
      await mutation.mutateAsync({
        path: '/api/portal/password',
        body: { currentPassword, newPassword },
      });
      form.reset();
      setNotice('Password changed. Other devices have been signed out.');
    } catch {
      // Mutation state renders the secure API error below.
    }
  });

  return (
    <>
      <PageHeader
        eyebrow="My Network · Safety"
        title="Devices & Security"
        description="Review every Network session, close devices you no longer use, or change the password shared with your desktop account."
        actions={<Button variant="secondary" onClick={() => setRevokeOthers(true)}><LogOut /> Revoke other devices</Button>}
      />
      {notice && <div className="success-banner" role="status"><ShieldCheck />{notice}</div>}
      <div className="security-layout">
        <section>
          <div className="section-title">
            <div><p className="eyebrow">Session scrapbook</p><h2>Device sessions</h2></div>
            <Laptop aria-hidden="true" />
          </div>
          {devices.isLoading && <SkeletonGrid cards={3} />}
          {devices.isError && <ErrorState error={devices.error} onRetry={() => void devices.refetch()} />}
          {devices.data?.items.length === 0 && (
            <EmptyState title="No device sessions">Active and past Network sessions will appear here.</EmptyState>
          )}
          <div className="device-list">
            {devices.data?.items.map((device) => (
              <PaperCard className="device-row" key={device.id}>
                <span className="device-icon"><Laptop /></span>
                <div>
                  <strong>Device {shortId(device.deviceId)}</strong>
                  <small>Last used {formatDate(device.lastUsedAt)}</small>
                  <small>Created {formatDate(device.createdAt)} · Expires {formatDate(device.expiresAt)}</small>
                </div>
                <Stamp tone={device.revokedAt ? 'bad' : 'good'}>{device.revokedAt ? 'Revoked' : 'Active'}</Stamp>
                {!device.revokedAt && <Button variant="quiet" onClick={() => setSelected(device)}>Revoke</Button>}
              </PaperCard>
            ))}
          </div>
          {devices.data && <Pagination {...devices.data.pagination} onPage={setPage} />}
        </section>
        <PaperCard className="password-card">
          <KeyRound aria-hidden="true" />
          <p className="eyebrow">Account key</p>
          <h2>Change password</h2>
          <p>This signs out every other device while keeping this notebook open.</p>
          <form onSubmit={changePassword} noValidate>
            <PasswordField label="Current password" name="currentPassword" form={form} autoComplete="current-password" />
            <PasswordField label="New password" name="newPassword" form={form} autoComplete="new-password" />
            <PasswordField label="Confirm new password" name="confirmPassword" form={form} autoComplete="new-password" />
            <Button type="submit" disabled={form.formState.isSubmitting || mutation.isPending}>Update password</Button>
          </form>
          {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
        </PaperCard>
      </div>
      <ConfirmDialog
        open={Boolean(selected)}
        title="Revoke this device?"
        description="This session will lose access immediately. If it is your current device, you will return to sign in."
        confirmLabel="Revoke device"
        destructive
        busy={mutation.isPending}
        onCancel={() => setSelected(null)}
        onConfirm={() => selected && mutation.mutate({
          path: `/api/portal/devices/${selected.id}`,
          method: 'DELETE',
        })}
      />
      <ConfirmDialog
        open={revokeOthers}
        title="Revoke all other devices?"
        description="Every Network session except this browser will be signed out. This cannot be undone."
        confirmLabel="Revoke other devices"
        destructive
        busy={mutation.isPending}
        onCancel={() => setRevokeOthers(false)}
        onConfirm={() => mutation.mutate({ path: '/api/portal/devices/revoke-others' })}
      />
    </>
  );
}

function PasswordField({
  label,
  name,
  form,
  autoComplete,
}: {
  label: string;
  name: keyof PasswordValues;
  form: ReturnType<typeof useForm<PasswordValues>>;
  autoComplete: string;
}) {
  const error = form.formState.errors[name];
  return (
    <label className="field">
      <span>{label}</span>
      <input type="password" autoComplete={autoComplete} {...form.register(name)} aria-invalid={Boolean(error)} />
      {error && <small role="alert">{error.message}</small>}
    </label>
  );
}
