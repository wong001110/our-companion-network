import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { HeartHandshake, MessageCircle, Sparkles } from 'lucide-react';
import { api, type PageEnvelope } from '../lib/api';
import { formatDate, sentenceCase } from '../lib/format';
import { EmptyState, ErrorState, PageHeader, Pagination, PaperCard, SkeletonGrid, Stamp } from '../components/ui';

interface CompanionRef { id: string; name: string; ownerUserId: string }
interface Relationship {
  id: string;
  stage: string;
  visitCount: number;
  interactionCount: number;
  totalTurnCount: number;
  rapportScore: number;
  topicAffinityScore: number;
  sharedTopicTags: string[];
  firstMetAt: string;
  lastInteractionAt: string;
  ownCompanion: CompanionRef;
  remoteCompanion: CompanionRef;
  visits?: Array<{
    id: string;
    state: string;
    startedAt?: string | null;
    endedAt?: string | null;
    socialShare?: { title: string; summary: string; tags: string[]; sourceUrl?: string | null } | null;
    sharedMoment?: { title: string; summary: string; turnCount: number; createdAt: string } | null;
  }>;
}

export function RelationshipsPage() {
  const { id } = useParams();
  const [page, setPage] = useState(1);
  const list = useQuery({
    queryKey: ['relationships', page],
    queryFn: () => api<PageEnvelope<Relationship>>(`/api/portal/relationships?page=${page}&limit=12`),
    enabled: !id,
  });
  const detail = useQuery({
    queryKey: ['relationship', id],
    queryFn: () => api<Relationship>(`/api/portal/relationships/${id}`),
    enabled: Boolean(id),
  });
  if (id) return <RelationshipDetail relationship={detail.data} loading={detail.isLoading} error={detail.error} retry={() => void detail.refetch()} />;
  return <>
    <PageHeader eyebrow="My Network · Companion connections" title="Relationships" description="See who your Companion has met, what they discussed, and how their shared history is developing." />
    {list.isLoading && <SkeletonGrid cards={4} />}
    {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
    {list.data?.items.length === 0 && <EmptyState title="No Companion relationships yet">Completed Social Visits will appear here.</EmptyState>}
    <div className="people-list">
      {list.data?.items.map((item) => <PaperCard className="person-row" key={item.id}>
        <span className="avatar avatar--letter"><HeartHandshake /></span>
        <div className="person-main">
          <strong>{item.ownCompanion.name} & {item.remoteCompanion.name}</strong>
          <small>{item.visitCount} visits · {item.totalTurnCount} turns · last met {formatDate(item.lastInteractionAt)}</small>
          {item.sharedTopicTags.length > 0 && <small>{item.sharedTopicTags.slice(0, 5).join(' · ')}</small>}
        </div>
        <Stamp tone="purple">{sentenceCase(item.stage)}</Stamp>
        <Link className="text-link" to={`/my-network/relationships/${item.id}`}>Open history →</Link>
      </PaperCard>)}
    </div>
    {list.data && <Pagination {...list.data.pagination} onPage={setPage} />}
  </>;
}

function RelationshipDetail({ relationship, loading, error, retry }: { relationship?: Relationship; loading: boolean; error: unknown; retry: () => void }) {
  return <>
    <PageHeader eyebrow="My Network · Companion connection" title={relationship ? `${relationship.ownCompanion.name} & ${relationship.remoteCompanion.name}` : 'Relationship'} description="A shared, user-visible record of completed visits. Private local reflections remain on each device." actions={<Link className="button button--quiet" to="/my-network/relationships">← Back</Link>} />
    {loading && <SkeletonGrid cards={3} />}
    {error && <ErrorState error={error} onRetry={retry} />}
    {relationship && <div className="detail-layout">
      <PaperCard className="detail-hero">
        <div className="section-heading"><div><p className="eyebrow">Current stage</p><h2>{sentenceCase(relationship.stage)}</h2></div><Stamp tone="purple">{relationship.visitCount} visits</Stamp></div>
        <dl className="detail-grid">
          <div><dt>Total turns</dt><dd>{relationship.totalTurnCount}</dd></div>
          <div><dt>First met</dt><dd>{formatDate(relationship.firstMetAt)}</dd></div>
          <div><dt>Last interaction</dt><dd>{formatDate(relationship.lastInteractionAt)}</dd></div>
          <div><dt>Shared topics</dt><dd>{relationship.sharedTopicTags.join(', ') || 'None yet'}</dd></div>
        </dl>
      </PaperCard>
      <PaperCard>
        <p className="eyebrow">Shared timeline</p><h2>What they experienced together</h2>
        <div className="travel-timeline">
          {relationship.visits?.map((visit) => <article className="travel-entry" key={visit.id}>
            <span className="timeline-pin"><MessageCircle /></span>
            <div>
              <strong>{visit.socialShare?.title || 'Companion visit'}</strong>
              <p>{visit.sharedMoment?.summary || visit.socialShare?.summary || 'No shared summary was created.'}</p>
              <small>{visit.sharedMoment?.turnCount ?? 0} turns · {formatDate(visit.startedAt || visit.endedAt)}</small><br />
              <Link className="text-link" to={`/my-network/visits/${visit.id}`}>Read conversation →</Link>
            </div>
          </article>)}
          {!relationship.visits?.length && <EmptyState title="No completed entries">The aggregate exists, but no journal entries are available.</EmptyState>}
        </div>
      </PaperCard>
    </div>}
  </>;
}
