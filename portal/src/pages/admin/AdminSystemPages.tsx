import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, Database, Radio, RefreshCw, Server, Wifi } from 'lucide-react';
import { api, queryString, type PageEnvelope } from '../../lib/api';
import { formatDate, sentenceCase, shortId } from '../../lib/format';
import { ListFilters, type ListFilterValues } from '../../components/ListFilters';
import { Button, EmptyState, ErrorState, PageHeader, Pagination, PaperCard, SkeletonGrid, Stamp } from '../../components/ui';
import type { SystemHealth } from './AdminOverviewPage';

interface AuditLog {
  id: string;
  adminUserId: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string | null;
  metadata: unknown;
  createdAt: string;
}

export function AdminSystemPage() {
  const query = useQuery({
    queryKey: ['system-health'],
    queryFn: () => api<SystemHealth>('/api/admin/system-health'),
    refetchInterval: 30_000,
  });
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · System note" title="System Health" description="Live capability signals and version compatibility. This page refreshes every 30 seconds." actions={<Button variant="secondary" onClick={() => void query.refetch()}><RefreshCw /> Refresh now</Button>} />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (
        <div className="system-grid">
          <HealthCard icon={Server} label="API" value={query.data.api} />
          <HealthCard icon={Database} label="PostgreSQL" value={query.data.database} note={`Migration ${query.data.migrationVersion || 'unknown'}`} />
          <HealthCard icon={Database} label="R2 Storage" value={objectStatus(query.data.r2)} note={JSON.stringify(query.data.r2)} />
          <HealthCard icon={Wifi} label="WebSocket" value={String(query.data.websocket.status ?? 'unavailable')} note={`${query.data.websocket.connectionCount ?? 0} current connections`} />
          <PaperCard><p className="eyebrow">Version postcard</p><h2>Compatibility</h2><dl className="stacked-details"><div><dt>Server</dt><dd>{query.data.serverVersion}</dd></div><div><dt>Protocol</dt><dd>{query.data.protocolVersion}</dd></div><div><dt>Minimum client</dt><dd>{query.data.compatibleClientVersion}</dd></div></dl></PaperCard>
          <PaperCard><p className="eyebrow">Realtime snapshot</p><h2>Operational counters</h2><div className="count-grid">{Object.entries(query.data.websocket).map(([label, value]) => <div key={label}><strong>{String(value)}</strong><span>{sentenceCase(label)}</span></div>)}</div></PaperCard>
          {query.data.realtime && <PaperCard><p className="eyebrow">Presence health</p><h2>Bounded signals</h2><div className="count-grid">{Object.entries(query.data.realtime.presence).map(([label, value]) => <div key={label}><strong>{value ?? '—'}</strong><span>{sentenceCase(label)}</span></div>)}</div></PaperCard>}
        </div>
      )}
    </>
  );
}

export function AdminRealtimePage() {
  const query = useQuery({
    queryKey: ['realtime-health'],
    queryFn: () => api<SystemHealth>('/api/admin/system-health'),
    refetchInterval: 15_000,
  });
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Presence & realtime" title="Realtime Observatory" description="A bounded operational snapshot of live WebSocket connections, reconnect behavior, and stale presence signals." actions={<Stamp tone="purple">15s live refresh</Stamp>} />
      {query.isLoading && <SkeletonGrid cards={5} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data && (
        <>
          <div className="metric-grid">
            {realtimeMetrics(query.data).map(([label, value, note], index) => <PaperCard className="metric-card" key={label}><div className="metric-icon">{index % 2 ? <Activity /> : <Radio />}</div><span>{label}</span><strong>{value}</strong><small>{note}</small></PaperCard>)}
          </div>
          <PaperCard>
            <div className="section-heading"><div><p className="eyebrow">Bounded recent presence</p><h2>Last seen rows</h2></div><Radio /></div>
            <div className="compact-list">
              {query.data.realtime?.lastSeen.map((row) => (
                <div key={row.userId}>
                  <span><strong>{row.displayName || row.username}</strong><small>{row.uid} · Last seen {formatDate(row.lastSeenAt)}</small></span>
                  <Stamp tone={row.status === 'online' ? 'good' : row.status === 'idle' ? 'warn' : 'neutral'}>{sentenceCase(row.status)}</Stamp>
                </div>
              ))}
              {!query.data.realtime?.lastSeen.length && <p>No recent presence rows are available.</p>}
            </div>
            <small>Shows at most 50 recent rows. A stale signal is online or idle without an update for {query.data.realtime?.staleAfterMinutes ?? 15} minutes.</small>
          </PaperCard>
          <PaperCard className="privacy-note"><Radio /><div><h2>Presence is ephemeral by design</h2><p>These counters are operational snapshots, not an unlimited history of a person’s activity.</p></div></PaperCard>
        </>
      )}
    </>
  );
}

export function AdminAuditPage() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ListFilterValues>({ search: '', status: '', dateFrom: '', dateTo: '' });
  const query = useQuery({
    queryKey: ['audit-logs', page, filters],
    queryFn: () => api<PageEnvelope<AuditLog>>(`/api/admin/audit-logs${queryString({ ...filters, page, limit: 25 })}`),
  });
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Immutable ledger" title="Admin Audit Log" description="Privileged views and state changes are recorded here. This ledger cannot be edited or deleted from the Portal." />
      <ListFilters value={filters} searchPlaceholder="Action, target, admin ID, or reason" onChange={(value) => { setFilters(value); setPage(1); }} />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState title="No audit notes match">Try a broader date range or search.</EmptyState>}
      <div className="audit-list">
        {query.data?.items.map((entry) => (
          <PaperCard className="audit-entry" key={entry.id}>
            <span className="audit-pin" />
            <div>
              <div className="section-heading"><div><strong>{sentenceCase(entry.action)}</strong><small>{formatDate(entry.createdAt)}</small></div><Stamp tone="purple">{entry.targetType}</Stamp></div>
              <p>{entry.reason || 'System-recorded event; no operator reason required.'}</p>
              <small>Admin {shortId(entry.adminUserId)} · Target {shortId(entry.targetId)}</small>
            </div>
          </PaperCard>
        ))}
      </div>
      {query.data && <Pagination {...query.data.pagination} onPage={setPage} />}
    </>
  );
}

function HealthCard({ icon: Icon, label, value, note }: { icon: typeof Server; label: string; value: string; note?: string }) {
  const okay = ['ok', 'ready', 'enabled'].includes(value.toLowerCase());
  return <PaperCard className="health-card"><Icon /><div><p className="eyebrow">{label}</p><h2>{sentenceCase(value)}</h2>{note && <small>{note}</small>}</div><Stamp tone={okay ? 'good' : 'warn'}>{okay ? 'Healthy' : 'Check'}</Stamp></PaperCard>;
}

function objectStatus(value: SystemHealth['r2']) {
  if (typeof value === 'string') return value;
  return value.uploadsEnabled ? 'ready' : 'unavailable';
}

function realtimeMetrics(health: SystemHealth): Array<[string, string, string]> {
  const realtime = health.realtime;
  const reconnectWindow = health.websocket.reconnectWindowMinutes ?? 15;
  return [
    ['Connections', String(health.websocket.connectionCount ?? 0), 'Current authenticated WebSocket connections'],
    ['Connected users', String(health.websocket.connectedUsers ?? 0), 'Unique users with a live socket'],
    ['Reconnects', String(health.websocket.reconnectCount ?? 0), `Reconnects in the last ${reconnectWindow} minutes`],
    ['Online', String(realtime?.presence.online ?? '—'), 'Current persisted online rows'],
    ['Idle', String(realtime?.presence.idle ?? '—'), 'Current persisted idle rows'],
    ['Offline', String(realtime?.presence.offline ?? '—'), 'Current persisted offline rows'],
    ['Stale presence', String(realtime?.presence.stale ?? '—'), `Online or idle beyond ${realtime?.staleAfterMinutes ?? 15} minutes`],
    ['Active devices', String(realtime?.activeDeviceCount ?? '—'), 'Unrevoked, unexpired device sessions'],
    ['Visit participants', String(realtime?.activeVisitParticipants ?? '—'), realtime?.activeVisitParticipantsCapped ? `Lower bound; ${realtime.activeVisitParticipantSampleLimit} active sessions inspected` : 'Unique participants in live visit states'],
  ];
}
