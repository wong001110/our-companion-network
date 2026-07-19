import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  Boxes,
  Cat,
  ClockAlert,
  Database,
  FileStack,
  Gauge,
  Radio,
  Server,
  UserPlus,
  UsersRound,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { api } from '../../lib/api';
import { formatBytes, sentenceCase } from '../../lib/format';
import { ErrorState, PageHeader, PaperCard, SkeletonGrid, Stamp } from '../../components/ui';

interface Overview {
  totalAccounts: number;
  newAccounts: { today: number; sevenDays: number };
  presence: { online: number; idle: number };
  publishedCompanions: number;
  totalAssetPacks: number;
  totalAssetFiles: number;
  r2StoredBytes: number;
  activeVisitSessions: number;
  pendingInvitations: number;
  failedAssetPacks: number;
  stuckSessions: number;
}

export interface SystemHealth {
  api: string;
  database: string;
  r2: Record<string, unknown> | string;
  websocket: Record<string, unknown>;
  migrationVersion: string | null;
  protocolVersion: string;
  serverVersion: string;
  compatibleClientVersion: string;
}

export function AdminOverviewPage() {
  const overview = useQuery({ queryKey: ['admin-overview'], queryFn: () => api<Overview>('/api/admin/overview') });
  const health = useQuery({ queryKey: ['system-health'], queryFn: () => api<SystemHealth>('/api/admin/system-health') });
  return (
    <>
      <PageHeader
        eyebrow="Caretaker Desk · Network observatory"
        title="Good morning, Caretaker."
        description="A calm operational field note: who is connected, which visits need attention, and whether every system is healthy."
        actions={<Stamp tone={overview.data?.stuckSessions ? 'warn' : 'good'}>{overview.data?.stuckSessions ? `${overview.data.stuckSessions} needs attention` : 'Network settled'}</Stamp>}
      />
      {overview.isLoading && <SkeletonGrid cards={8} />}
      {overview.isError && <ErrorState error={overview.error} onRetry={() => void overview.refetch()} />}
      {overview.data && <OverviewMetrics data={overview.data} />}
      <div className="admin-overview-columns">
        <PaperCard>
          <div className="section-heading"><div><p className="eyebrow">Service map</p><h2>System health</h2></div><Gauge /></div>
          {health.isLoading && <SkeletonGrid cards={2} />}
          {health.isError && <ErrorState error={health.error} onRetry={() => void health.refetch()} />}
          {health.data && (
            <div className="health-list">
              <HealthRow icon={Server} label="API" value={health.data.api} />
              <HealthRow icon={Database} label="PostgreSQL" value={health.data.database} />
              <HealthRow icon={Boxes} label="R2 storage" value={healthStatus(health.data.r2)} />
              <HealthRow icon={Radio} label="WebSocket" value="ok" note={`${health.data.websocket.connectionCount ?? 0} connections`} />
            </div>
          )}
          <Link className="text-link" to="/caretaker/system">Open full system note →</Link>
        </PaperCard>
        <PaperCard className="attention-card">
          <div className="section-heading"><div><p className="eyebrow">Pinned notes</p><h2>Needs attention</h2></div><ClockAlert /></div>
          <div className="attention-row"><span>Stuck visit sessions</span><strong>{overview.data?.stuckSessions ?? '—'}</strong><Link to="/caretaker/visits?status=ending">Inspect</Link></div>
          <div className="attention-row"><span>Failed asset packs</span><strong>{overview.data?.failedAssetPacks ?? '—'}</strong><Link to="/caretaker/assets?status=failed">Inspect</Link></div>
          <div className="attention-row"><span>Pending invitations</span><strong>{overview.data?.pendingInvitations ?? '—'}</strong><Link to="/caretaker/visits?kind=invitations&status=pending">Inspect</Link></div>
        </PaperCard>
      </div>
    </>
  );
}

function OverviewMetrics({ data }: { data: Overview }) {
  const metrics = [
    [UsersRound, 'Total accounts', data.totalAccounts, `+${data.newAccounts.sevenDays} in 7 days`],
    [UserPlus, 'New today', data.newAccounts.today, 'Fresh Network passports'],
    [Radio, 'Online / idle', `${data.presence.online} / ${data.presence.idle}`, 'Presence signals'],
    [Cat, 'Published companions', data.publishedCompanions, 'Visible to friends'],
    [Boxes, 'Asset packs', data.totalAssetPacks, `${data.totalAssetFiles} files`],
    [FileStack, 'R2 stored', formatBytes(data.r2StoredBytes), 'Verified pack bytes'],
    [Activity, 'Active visits', data.activeVisitSessions, `${data.pendingInvitations} pending`],
    [ClockAlert, 'Stuck sessions', data.stuckSessions, `${data.failedAssetPacks} failed packs`],
  ] as const;
  return <div className="metric-grid metric-grid--admin">{metrics.map(([Icon, label, value, note]) => (
    <PaperCard className="metric-card" key={label}><div className="metric-icon"><Icon /></div><span>{label}</span><strong>{value}</strong><small>{note}</small></PaperCard>
  ))}</div>;
}

function HealthRow({ icon: Icon, label, value, note }: { icon: typeof Server; label: string; value: string; note?: string }) {
  const okay = ['ok', 'ready', 'enabled'].includes(value.toLowerCase());
  return <div><Icon /><span><strong>{label}</strong>{note && <small>{note}</small>}</span><Stamp tone={okay ? 'good' : 'warn'}>{sentenceCase(value)}</Stamp></div>;
}

function healthStatus(value: SystemHealth['r2']) {
  if (typeof value === 'string') return value;
  if ('uploadsEnabled' in value) return value.uploadsEnabled ? 'ready' : 'unavailable';
  return 'unknown';
}
