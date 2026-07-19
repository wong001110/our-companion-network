import { useCallback, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Activity, CircleX, ClockAlert, Route, Sparkles, TriangleAlert, Wrench } from 'lucide-react';
import { api, jsonBody, queryString, type PageEnvelope } from '../../lib/api';
import { formatDate, sentenceCase, shortId } from '../../lib/format';
import { ListFilters, type ListFilterValues } from '../../components/ListFilters';
import { Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, PaperCard, SkeletonGrid, Stamp } from '../../components/ui';

interface VisitDiagnostic {
  code: string;
  label: string;
  active: boolean;
}

export interface AdminVisit {
  id: string;
  invitationId?: string;
  visitorOwnerUserId: string;
  hostUserId: string;
  networkCompanionId: string;
  assetPackSnapshotId: string;
  assetPackRefId?: string | null;
  companionName?: string;
  status?: string;
  state?: string;
  visitorOwnerReadyAt?: string | null;
  hostReadyAt?: string | null;
  visitorOwnerSeenAt?: string | null;
  hostSeenAt?: string | null;
  readyAt?: string | null;
  startedAt?: string | null;
  endingAt?: string | null;
  endedAt?: string | null;
  endReason?: string | null;
  failureCode?: string | null;
  expiresAt?: string | null;
  respondedAt?: string | null;
  cancelledAt?: string | null;
  invitationAcceptedAt?: string | null;
  diagnostics?: VisitDiagnostic[];
  reconciliation?: {
    eligible: boolean;
    code: string;
    staleAfterMinutes: number;
    lastActivityAt?: string;
  };
  createdAt: string;
  updatedAt: string;
}

const sessionStatuses = ['preparing', 'ready', 'active', 'ending', 'ended', 'cancelled', 'failed'];
const invitationStatuses = ['pending', 'accepted', 'declined', 'cancelled', 'expired'];
export const VISIT_DIAGNOSTIC_LABELS = [
  ['READY_TIMEOUT', 'Ready timeout'],
  ['STALE_HEARTBEAT', 'Stale heartbeat'],
  ['HOST_AWAY_CONFLICT', 'Host away conflict'],
  ['ASSET_AUTHORIZATION_FAILURE', 'Asset authorization failure'],
  ['MISSING_ASSET_PACK', 'Missing Asset Pack'],
  ['STUCK_ENDING', 'Session stuck in ending'],
  ['ENDED_WITH_LIVE_REF', 'Session ended but asset still referenced'],
  ['RENDERER_FAILURE', 'Renderer failure'],
] as const;

export function AdminVisitsPage() {
  const { id } = useParams();
  return id ? <VisitDetail id={id} /> : <VisitList />;
}

function VisitList() {
  const [params] = useSearchParams();
  const [kind, setKind] = useState<'sessions' | 'invitations'>(params.get('kind') === 'invitations' ? 'invitations' : 'sessions');
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState<ListFilterValues>({
    search: '',
    status: params.get('status') ?? '',
    dateFrom: '',
    dateTo: '',
  });
  const [selected, setSelected] = useState<AdminVisit | null>(null);
  const [reason, setReason] = useState('');
  const client = useQueryClient();
  const endpoint = kind === 'sessions' ? 'visit-sessions' : 'visit-invitations';
  const query = useQuery({
    queryKey: ['admin-visits', kind, page, filters],
    queryFn: () => api<PageEnvelope<AdminVisit>>(`/api/admin/${endpoint}${queryString({ ...filters, page, limit: 20 })}`),
  });
  const mutation = useMutation({
    mutationFn: () => api(`/api/admin/${endpoint}/${selected!.id}/${kind === 'sessions' ? 'end' : 'cancel'}`, { method: 'POST', ...jsonBody({ reason }) }),
    onSuccess: () => { setSelected(null); setReason(''); void client.invalidateQueries({ queryKey: ['admin-visits'] }); },
  });
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Visit debugger" title="Visit Debugger" description="Follow invitations and sessions across readiness, asset authorization, heartbeats, ending, and cleanup." />
      <div className="tab-list" role="tablist" aria-label="Visit debugger views">
        <button role="tab" aria-selected={kind === 'sessions'} onClick={() => { setKind('sessions'); setPage(1); setFilters({ ...filters, status: '' }); }}><Route /> Sessions</button>
        <button role="tab" aria-selected={kind === 'invitations'} onClick={() => { setKind('invitations'); setPage(1); setFilters({ ...filters, status: '' }); }}><Sparkles /> Invitations</button>
      </div>
      <ListFilters value={filters} statusOptions={kind === 'sessions' ? sessionStatuses : invitationStatuses} searchPlaceholder="Visit ID, owner ID, host ID, or companion name" onChange={(value) => { setFilters(value); setPage(1); }} />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState title="No visits match">Nothing in this operational view.</EmptyState>}
      <div className="admin-card-list">
        {query.data?.items.map((visit) => {
          const state = visit.state || visit.status || 'unknown';
          const terminal = ['ended', 'cancelled', 'failed', 'declined', 'expired', 'accepted'].includes(state);
          return (
            <PaperCard className="admin-list-row" key={visit.id}>
              <span className="device-icon"><Activity /></span>
              <div className="admin-list-main"><strong>{visit.companionName || `Visit ${shortId(visit.id)}`}</strong><small>Visitor {shortId(visit.visitorOwnerUserId)} · Host {shortId(visit.hostUserId)}</small></div>
              <Stamp tone={toneFor(state)}>{sentenceCase(state)}</Stamp>
              {isPossiblyStuck(visit) && <Stamp tone="warn">Possible stale state</Stamp>}
              <small>Updated {formatDate(visit.updatedAt)}</small>
              {kind === 'sessions' && <Link className="button button--quiet" to={`/caretaker/visits/${visit.id}`}>Timeline</Link>}
              {!terminal && <Button variant="danger" onClick={() => setSelected(visit)}>{kind === 'sessions' ? 'End session' : 'Cancel'}</Button>}
            </PaperCard>
          );
        })}
      </div>
      {query.data && <Pagination {...query.data.pagination} onPage={setPage} />}
      <ConfirmDialog open={Boolean(selected)} title={kind === 'sessions' ? 'End this visit session?' : 'Cancel this invitation?'} description="This privileged action changes live Network state and is permanently audited. Add a clear reason." confirmLabel={kind === 'sessions' ? 'End session' : 'Cancel invitation'} destructive reason={reason} reasonRequired onReasonChange={setReason} busy={mutation.isPending} onCancel={() => { setSelected(null); setReason(''); }} onConfirm={() => mutation.mutate()} />
      {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
    </>
  );
}

function VisitDetail({ id }: { id: string }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState<'end' | 'reconcile' | null>(null);
  const closeConfirm = useCallback(() => {
    setConfirm(null);
    setReason('');
  }, []);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['admin-visit', id], queryFn: () => api<AdminVisit>(`/api/admin/visit-sessions/${id}`) });
  const mutation = useMutation({
    mutationFn: (action: 'end' | 'reconcile') => api(`/api/admin/visit-sessions/${id}/${action}`, { method: 'POST', ...jsonBody({ reason }) }),
    onSuccess: () => { setConfirm(null); setReason(''); void client.invalidateQueries({ queryKey: ['admin-visit', id] }); },
  });
  const visit = query.data;
  const state = visit?.state || 'unknown';
  const timeline = visit ? visitTimeline(visit) : [];
  const diagnostics = visit ? visitDiagnostics(visit) : [];
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Visit debugger" title="Session timeline" description="Readiness, heartbeats, asset references, and terminal cleanup signals for this visit." actions={<Link className="button button--quiet" to="/caretaker/visits">← Visit Debugger</Link>} />
      {query.isLoading && <SkeletonGrid cards={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {visit && (
        <div className="detail-layout">
          <PaperCard className="inspector-hero">
            <div className="section-heading"><div><p className="eyebrow">Session {shortId(visit.id)}</p><h2>{sentenceCase(state)}</h2></div><Stamp tone={toneFor(state)}>{visit.failureCode || 'No failure code'}</Stamp></div>
            <dl className="detail-grid">
              <div><dt>Visitor owner</dt><dd>{shortId(visit.visitorOwnerUserId)}</dd></div><div><dt>Host</dt><dd>{shortId(visit.hostUserId)}</dd></div>
              <div><dt>Companion</dt><dd>{shortId(visit.networkCompanionId)}</dd></div><div><dt>Pack snapshot</dt><dd>{shortId(visit.assetPackSnapshotId)}</dd></div>
              <div><dt>Visitor heartbeat</dt><dd>{formatDate(visit.visitorOwnerSeenAt)}</dd></div><div><dt>Host heartbeat</dt><dd>{formatDate(visit.hostSeenAt)}</dd></div>
              <div><dt>End reason</dt><dd>{sentenceCase(visit.endReason)}</dd></div><div><dt>Live pack ref</dt><dd>{shortId(visit.assetPackRefId)}</dd></div>
            </dl>
            <div className="row-actions">
              {!['ended', 'cancelled', 'failed'].includes(state) && <Button variant="danger" onClick={() => setConfirm('end')}><CircleX /> End stuck session</Button>}
              <Button
                variant="secondary"
                disabled={!visit.reconciliation?.eligible}
                title={visit.reconciliation?.eligible
                  ? 'End this conservatively stale live session and clear its live Pack reference.'
                  : `Unavailable: ${sentenceCase(visit.reconciliation?.code)}`}
                onClick={() => setConfirm('reconcile')}
              >
                <Wrench /> Trigger safe reconciliation
              </Button>
            </div>
            {!visit.reconciliation?.eligible && (
              <small className="muted">
                Safe reconciliation refuses healthy and terminal sessions. A live session must have no activity for at least {visit.reconciliation?.staleAfterMinutes ?? 15} minutes.
              </small>
            )}
          </PaperCard>
          <PaperCard>
            <div className="section-heading"><div><p className="eyebrow">Lifecycle</p><h2>Diagnostic timeline</h2></div><ClockAlert /></div>
            <ol className="milestone-list">{timeline.map(([label, date]) => <li className={date ? 'is-reached' : ''} key={label}><span /><div><strong>{label}</strong><small>{date ? formatDate(date) : 'Not reached'}</small></div></li>)}</ol>
          </PaperCard>
          <PaperCard>
            <div className="section-heading"><div><p className="eyebrow">Named checks</p><h2>Visit diagnostics</h2></div><TriangleAlert /></div>
            <div className="count-grid">
              {diagnostics.map((diagnostic) => (
                <div key={diagnostic.code}>
                  <strong>{diagnostic.active ? 'Detected' : 'Clear'}</strong>
                  <span>{diagnostic.label}</span>
                </div>
              ))}
            </div>
          </PaperCard>
        </div>
      )}
      <ConfirmDialog
        open={Boolean(confirm)}
        title={confirm === 'reconcile' ? 'Trigger safe reconciliation?' : 'End this session?'}
        description={confirm === 'reconcile'
          ? 'The server will re-check staleness under a row lock, close the live session, clear its live Asset Pack reference, notify both participants, and write the reason to the immutable audit log.'
          : 'Use only for a genuinely invalid or stuck session. The reason becomes part of the immutable audit history.'}
        confirmLabel={confirm === 'reconcile' ? 'Trigger safe reconciliation' : 'End session'}
        destructive
        reason={reason}
        reasonRequired
        onReasonChange={setReason}
        busy={mutation.isPending}
        onCancel={closeConfirm}
        onConfirm={() => confirm && mutation.mutate(confirm)}
      />
      {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
    </>
  );
}

export function visitTimeline(visit: AdminVisit): Array<[string, string | null | undefined]> {
  return [
    ['Invitation created', visit.createdAt],
    ['Invitation accepted', visit.invitationAcceptedAt],
    ['Asset authorized', visit.assetPackRefId ? visit.createdAt : null],
    ['Visitor owner ready', visit.visitorOwnerReadyAt],
    ['Host ready', visit.hostReadyAt],
    ['Session ready', visit.readyAt],
    ['Session active', visit.startedAt],
    ['Session ending', visit.endingAt],
    ['Session ended', visit.endedAt],
    ['Cleanup completed', visit.endedAt && !visit.assetPackRefId ? visit.endedAt : null],
  ];
}

export function visitDiagnostics(visit: AdminVisit): VisitDiagnostic[] {
  return VISIT_DIAGNOSTIC_LABELS.map(([code, label]) => (
    visit.diagnostics?.find((diagnostic) => diagnostic.code === code)
    ?? { code, label, active: false }
  ));
}

function isPossiblyStuck(visit: AdminVisit) {
  if (!['preparing', 'ready', 'active', 'ending'].includes(visit.state ?? '')) return false;
  return Date.now() - new Date(visit.updatedAt).getTime() > 15 * 60_000;
}

function toneFor(value: string): 'good' | 'warn' | 'bad' | 'neutral' {
  if (['active', 'ended', 'accepted'].includes(value)) return 'good';
  if (['preparing', 'ready', 'ending', 'pending'].includes(value)) return 'warn';
  if (['failed', 'cancelled', 'declined', 'expired'].includes(value)) return 'bad';
  return 'neutral';
}
