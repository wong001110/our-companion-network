import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Clock3, MapPin, Plane, Route, Sparkles, UsersRound } from 'lucide-react';
import { api, type PageEnvelope } from '../lib/api';
import { formatDate, formatDuration, sentenceCase, shortId } from '../lib/format';
import {
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  PaperCard,
  SkeletonGrid,
  Stamp,
} from '../components/ui';

interface Visit {
  id: string;
  kind?: 'session' | 'invitation';
  invitationId?: string;
  visitorOwnerUserId: string;
  hostUserId: string;
  networkCompanionId: string;
  assetPackSnapshotId: string;
  companionName?: string;
  networkCompanion?: { name: string } | null;
  status?: string;
  state?: string;
  readyAt?: string | null;
  startedAt?: string | null;
  endedAt?: string | null;
  expiresAt?: string | null;
  respondedAt?: string | null;
  endReason?: string | null;
  failureCode?: string | null;
  durationSeconds?: number | null;
  createdAt: string;
  updatedAt: string;
}

export function VisitsPage() {
  const { id } = useParams();
  const [kind, setKind] = useState<'sessions' | 'invitations'>('sessions');
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['visits', kind, page],
    queryFn: () => api<PageEnvelope<Visit>>(`/api/portal/visits?kind=${kind}&page=${page}&limit=12`),
    enabled: !id,
  });
  const detail = useQuery({
    queryKey: ['visit', id],
    queryFn: () => api<Visit>(`/api/portal/visits/${id}`),
    enabled: Boolean(id),
  });

  if (id) {
    return (
      <>
        <PageHeader
          eyebrow="My Network · Travel journal"
          title="Visit details"
          description="A private timeline of this visit and the exact companion pack reserved for it."
          actions={<Link className="button button--quiet" to="/my-network/visits">← Back to journal</Link>}
        />
        {detail.isLoading && <SkeletonGrid cards={3} />}
        {detail.isError && <ErrorState error={detail.error} onRetry={() => void detail.refetch()} />}
        {detail.data && <VisitDetail visit={detail.data} />}
      </>
    );
  }

  return (
    <>
      <PageHeader
        eyebrow="My Network · Travel journal"
        title="Visits"
        description="Pending invitations, active sessions, and the postcards left behind by completed companion visits."
      />
      <div className="tab-list" role="tablist" aria-label="Visit views">
        <button role="tab" aria-selected={kind === 'sessions'} onClick={() => { setKind('sessions'); setPage(1); }}>
          <Route aria-hidden="true" /> Sessions
        </button>
        <button role="tab" aria-selected={kind === 'invitations'} onClick={() => { setKind('invitations'); setPage(1); }}>
          <Plane aria-hidden="true" /> Invitations
        </button>
      </div>
      {list.isLoading && <SkeletonGrid cards={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && (
        <EmptyState title={kind === 'sessions' ? 'No travel stories yet' : 'No invitations waiting'}>
          {kind === 'sessions'
            ? 'When companions visit, their journey will unfold here.'
            : 'Your invitation inbox is quiet.'}
        </EmptyState>
      )}
      <div className="travel-timeline">
        {list.data?.items.map((visit) => (
          <article className="travel-entry" key={visit.id}>
            <span className="timeline-pin"><MapPin aria-hidden="true" /></span>
            <PaperCard>
              <div className="section-heading">
                <div>
                  <p className="eyebrow">{kind === 'sessions' ? 'Journey' : 'Invitation'}</p>
                  <h2>{visit.networkCompanion?.name || visit.companionName || 'Companion visit'}</h2>
                </div>
                <Stamp tone={toneFor(visit.state || visit.status)}>
                  {sentenceCase(visit.state || visit.status)}
                </Stamp>
              </div>
              <div className="travel-meta">
                <span><Clock3 />{formatDate(visit.startedAt || visit.createdAt)}</span>
                <span><UsersRound />Host {shortId(visit.hostUserId)}</span>
                {kind === 'sessions' && <span><Sparkles />{formatDuration(visit.durationSeconds)}</span>}
              </div>
              {(visit.failureCode || visit.endReason) && (
                <p className="failure-note">{visit.failureCode || sentenceCase(visit.endReason)}</p>
              )}
              <Link className="text-link" to={`/my-network/visits/${visit.id}`}>Read this entry →</Link>
            </PaperCard>
          </article>
        ))}
      </div>
      {list.data && <Pagination {...list.data.pagination} onPage={setPage} />}
    </>
  );
}

function VisitDetail({ visit }: { visit: Visit }) {
  const status = visit.state || visit.status;
  const milestones = [
    { label: visit.kind === 'invitation' ? 'Invitation created' : 'Session prepared', date: visit.createdAt, reached: true },
    { label: 'Both companions ready', date: visit.readyAt, reached: Boolean(visit.readyAt) },
    { label: 'Visit started', date: visit.startedAt, reached: Boolean(visit.startedAt) },
    { label: 'Visit ended', date: visit.endedAt, reached: Boolean(visit.endedAt) },
  ];
  return (
    <div className="detail-layout">
      <PaperCard className="detail-hero">
        <div className="section-heading">
          <div><p className="eyebrow">Travel stamp</p><h2>{visit.networkCompanion?.name || visit.companionName || 'Companion visit'}</h2></div>
          <Stamp tone={toneFor(status)}>{sentenceCase(status)}</Stamp>
        </div>
        <dl className="detail-grid">
          <div><dt>Visitor owner</dt><dd>{shortId(visit.visitorOwnerUserId)}</dd></div>
          <div><dt>Host</dt><dd>{shortId(visit.hostUserId)}</dd></div>
          <div><dt>Companion</dt><dd>{shortId(visit.networkCompanionId)}</dd></div>
          <div><dt>Pack snapshot</dt><dd>{shortId(visit.assetPackSnapshotId)}</dd></div>
          <div><dt>Duration</dt><dd>{formatDuration(visit.durationSeconds)}</dd></div>
          <div><dt>Failure code</dt><dd>{visit.failureCode || 'None'}</dd></div>
          <div><dt>End reason</dt><dd>{sentenceCase(visit.endReason || 'Not ended')}</dd></div>
        </dl>
      </PaperCard>
      <PaperCard>
        <p className="eyebrow">Timeline</p>
        <h2>Journey milestones</h2>
        <ol className="milestone-list">
          {milestones.map((milestone) => (
            <li className={milestone.reached ? 'is-reached' : ''} key={milestone.label}>
              <span />
              <div><strong>{milestone.label}</strong><small>{milestone.reached ? formatDate(milestone.date) : 'Not reached'}</small></div>
            </li>
          ))}
        </ol>
      </PaperCard>
    </div>
  );
}

function toneFor(value?: string | null): 'good' | 'warn' | 'bad' | 'neutral' | 'purple' {
  if (['active', 'accepted', 'ended'].includes(value ?? '')) return 'good';
  if (['pending', 'preparing', 'ready', 'ending'].includes(value ?? '')) return 'warn';
  if (['failed', 'cancelled', 'declined', 'expired'].includes(value ?? '')) return 'bad';
  return 'neutral';
}
