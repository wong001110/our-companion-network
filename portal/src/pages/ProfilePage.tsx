import { useEffect } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { useForm } from 'react-hook-form';
import { CircleUserRound, Save, ShieldCheck } from 'lucide-react';
import { api, jsonBody, type PortalUser } from '../lib/api';
import { Button, ErrorState, PageHeader, PaperCard, SkeletonGrid, Stamp } from '../components/ui';
import { useAuth } from '../features/auth/AuthProvider';

interface ProfileValues {
  displayName: string;
  bio: string;
  avatarUrl: string;
  isPublic: boolean;
}

export function ProfilePage() {
  const { refreshUser } = useAuth();
  const query = useQuery({
    queryKey: ['profile'],
    queryFn: () => api<PortalUser>('/api/portal/profile'),
  });
  const form = useForm<ProfileValues>();
  const mutation = useMutation({
    mutationFn: (values: ProfileValues) => api('/api/portal/profile', {
      method: 'PATCH',
      ...jsonBody({
        displayName: values.displayName || undefined,
        bio: values.bio || undefined,
        avatarUrl: values.avatarUrl || undefined,
        isPublic: values.isPublic,
      }),
    }),
    onSuccess: () => void refreshUser(),
  });
  useEffect(() => {
    if (!query.data) return;
    form.reset({
      displayName: query.data.profile?.displayName ?? '',
      bio: query.data.profile?.bio ?? '',
      avatarUrl: query.data.profile?.avatarUrl ?? '',
      isPublic: query.data.profile?.isPublic ?? false,
    });
  }, [form, query.data]);
  return (
    <>
      <PageHeader eyebrow="My Network · Identity" title="Profile" description="The friendly public-facing details attached to your Network Account. Your email and UID stay fixed." />
      {query.isLoading && <SkeletonGrid cards={3} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (
        <div className="detail-layout">
          <PaperCard className="inspector-hero">
            <div className="section-heading"><div><p className="eyebrow">Network passport</p><h2>{query.data.username}</h2></div><CircleUserRound /></div>
            <dl className="detail-grid"><div><dt>UID</dt><dd>{query.data.uid}</dd></div><div><dt>Friend code</dt><dd>{query.data.friendCode}</dd></div><div><dt>Email</dt><dd>{query.data.email}</dd></div><div><dt>Role</dt><dd><Stamp tone="purple">{query.data.role}</Stamp></dd></div></dl>
            <div className="security-note"><ShieldCheck /><span>Profile changes are always applied to the signed-in account.</span></div>
          </PaperCard>
          <PaperCard>
            <p className="eyebrow">Public card</p><h2>Edit profile</h2>
            <form onSubmit={form.handleSubmit((values) => mutation.mutate(values))}>
              <label className="field"><span>Display name</span><input maxLength={80} {...form.register('displayName')} /></label>
              <label className="field"><span>Bio</span><textarea rows={5} maxLength={500} {...form.register('bio')} /></label>
              <label className="field"><span>Avatar image URL</span><input type="url" maxLength={500} {...form.register('avatarUrl')} /></label>
              <label className="checkbox-field"><input type="checkbox" {...form.register('isPublic')} /><span>Allow this profile to appear in public community views</span></label>
              <Button type="submit" disabled={mutation.isPending}><Save /> Save profile</Button>
            </form>
            {mutation.isSuccess && <p className="success-text" role="status">Profile saved.</p>}
            {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
          </PaperCard>
        </div>
      )}
    </>
  );
}
