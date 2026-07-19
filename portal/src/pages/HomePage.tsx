import { useQuery } from '@tanstack/react-query';
import {
  Bell,
  Cat,
  HeartHandshake,
  Laptop,
  MapPin,
  Radio,
  Sparkles,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, sentenceCase } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, PaperCard, SkeletonGrid, Stamp } from '../components/ui';
import { useAuth } from '../features/auth/AuthProvider';

interface Summary {
  presence: { status: string; lastSeenAt: string | null };
  friends: number;
  pendingRequests: number;
  publishedCompanion: {
    id: string;
    name: string;
    published: boolean;
    activeAssetPack?: { id: string; status: string; failureCode?: string | null } | null;
  } | null;
  recentVisits: Array<{
    id: string;
    state: string;
    networkCompanion?: { name: string } | null;
    startedAt: string | null;
    endedAt: string | null;
    updatedAt: string;
  }>;
  unreadNotifications: number;
  activeDevices: number;
}

export function HomePage() {
  const { user } = useAuth();
  const query = useQuery({
    queryKey: ['portal-summary'],
    queryFn: () => api<Summary>('/api/portal/summary'),
  });

  return (
    <>
      <PageHeader
        eyebrow="My Network"
        title={`Welcome back, ${user?.profile?.displayName || user?.username}.`}
        description="A small field note of where your companion has been, who is nearby, and what is safely connected."
        actions={<span className="paper-date">{new Intl.DateTimeFormat(undefined, { dateStyle: 'full' }).format(new Date())}</span>}
      />
      {query.isLoading && <SkeletonGrid cards={8} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && <HomeContent data={query.data} />}
    </>
  );
}

function HomeContent({ data }: { data: Summary }) {
  const metrics = [
    { icon: Radio, label: 'Presence', value: sentenceCase(data.presence.status), note: data.presence.lastSeenAt ? `Seen ${formatDate(data.presence.lastSeenAt)}` : 'No recent signal', tone: data.presence.status === 'online' ? 'good' as const : 'neutral' as const },
    { icon: HeartHandshake, label: 'Friends', value: data.friends, note: `${data.pendingRequests} waiting request${data.pendingRequests === 1 ? '' : 's'}`, tone: data.pendingRequests ? 'warn' as const : 'purple' as const },
    { icon: Bell, label: 'Unread notes', value: data.unreadNotifications, note: data.unreadNotifications ? 'A little news is waiting' : 'All caught up', tone: data.unreadNotifications ? 'warn' as const : 'good' as const },
    { icon: Laptop, label: 'Active devices', value: data.activeDevices, note: 'Secure Network sessions', tone: 'neutral' as const },
  ];
  return (
    <div className="home-layout">
      <div className="metric-grid">
        {metrics.map(({ icon: Icon, label, value, note, tone }) => (
          <PaperCard className="metric-card" key={label}>
            <div className="metric-icon"><Icon aria-hidden="true" /></div>
            <span>{label}</span>
            <strong>{value}</strong>
            <Stamp tone={tone}>{note}</Stamp>
          </PaperCard>
        ))}
      </div>
      <div className="home-columns">
        <PaperCard className="passport-preview">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Companion passport</p>
              <h2>{data.publishedCompanion?.name ?? 'No companion published yet'}</h2>
            </div>
            <Cat aria-hidden="true" />
          </div>
          {data.publishedCompanion ? (
            <>
              <div className="passport-stamps">
                <Stamp tone={data.publishedCompanion.published ? 'good' : 'neutral'}>
                  {data.publishedCompanion.published ? 'Published' : 'Private'}
                </Stamp>
                <Stamp tone={data.publishedCompanion.activeAssetPack?.status === 'active' ? 'purple' : 'warn'}>
                  Pack {sentenceCase(data.publishedCompanion.activeAssetPack?.status)}
                </Stamp>
              </div>
              <p>Your current public companion and its active travel wardrobe are ready to inspect.</p>
              <Link className="text-link" to="/my-network/companion">Open passport →</Link>
            </>
          ) : (
            <p>Publish a companion from the desktop app and its passport will appear here.</p>
          )}
        </PaperCard>
        <PaperCard className="visit-note">
          <div className="section-heading">
            <div>
              <p className="eyebrow">Recent travels</p>
              <h2>Visit journal</h2>
            </div>
            <MapPin aria-hidden="true" />
          </div>
          {data.recentVisits.length ? (
            <ol className="mini-timeline">
              {data.recentVisits.map((visit) => (
                <li key={visit.id}>
                  <span><Sparkles aria-hidden="true" /></span>
                  <div>
                    <strong>{visit.networkCompanion?.name ?? 'Companion visit'}</strong>
                    <small>{sentenceCase(visit.state)} · {formatDate(visit.updatedAt)}</small>
                  </div>
                </li>
              ))}
            </ol>
          ) : (
            <EmptyState title="No postcards yet">Completed and active visits will leave a note here.</EmptyState>
          )}
          <Link className="text-link" to="/my-network/visits">Read the full journal →</Link>
        </PaperCard>
      </div>
    </div>
  );
}
