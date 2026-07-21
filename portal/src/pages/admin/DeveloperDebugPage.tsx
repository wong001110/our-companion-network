import { useCallback, useMemo, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle,
  Bot,
  ChevronLeft,
  ChevronRight,
  Copy,
  Download,
  FileSearch,
  Filter,
  GitBranch,
  GitCommitHorizontal,
  SearchX,
  Sparkles,
  Trash2,
  Webhook,
  Zap,
} from 'lucide-react';
import { api, queryString } from '../../lib/api';
import { formatDate, sentenceCase, shortId } from '../../lib/format';
import {
  Button,
  EmptyState,
  ErrorState,
  InlineSpinner,
  PageHeader,
  PaperCard,
  SkeletonGrid,
  Stamp,
} from '../../components/ui';

type DebugEventKind =
  | 'ai_call'
  | 'research_search'
  | 'research_page_fetch'
  | 'research_evidence'
  | 'evidence_synthesis'
  | 'pipeline_failure';

const KIND_OPTIONS: Array<{ value: DebugEventKind | ''; label: string }> = [
  { value: '', label: 'All kinds' },
  { value: 'ai_call', label: 'AI Calls' },
  { value: 'research_search', label: 'Research Search' },
  { value: 'research_page_fetch', label: 'Research Page Fetch' },
  { value: 'research_evidence', label: 'Research Evidence' },
  { value: 'evidence_synthesis', label: 'Evidence Synthesis' },
  { value: 'pipeline_failure', label: 'Pipeline Failure' },
];

const STATUS_OPTIONS = ['', 'success', 'error', 'completed', 'failed', 'fallback', 'empty', 'skipped', 'pending'];

interface DebugEvent {
  id: string;
  kind: DebugEventKind;
  operation: string;
  status: string;
  userId: string;
  username?: string;
  deviceId: string;
  provider?: string;
  model?: string;
  correlationId?: string;
  cycleId?: string;
  turnId?: string;
  summary?: string;
  errorMessage?: string;
  createdAt: string;
  receivedAt?: string;
  expiresAt?: string;
}

interface DebugEventDetail extends DebugEvent {
  payload?: Record<string, unknown>;
  relatedEvents?: DebugEvent[];
}

interface DebugEventsPage {
  items: DebugEvent[];
  nextCursor: string | null;
  hasMore: boolean;
}

const kindIcons: Record<string, typeof Zap> = {
  ai_call: Bot,
  research_search: SearchX,
  research_page_fetch: FileSearch,
  research_evidence: Sparkles,
  evidence_synthesis: GitBranch,
  pipeline_failure: AlertTriangle,
};

const kindTones: Record<string, 'good' | 'warn' | 'bad' | 'purple' | 'neutral'> = {
  ai_call: 'purple',
  research_search: 'neutral',
  research_page_fetch: 'neutral',
  research_evidence: 'neutral',
  evidence_synthesis: 'good',
  pipeline_failure: 'bad',
};

interface Filters {
  search: string;
  userId: string;
  deviceId: string;
  kind: DebugEventKind | '';
  operation: string;
  status: string;
  provider: string;
  correlationId: string;
  cycleId: string;
  turnId: string;
  from: string;
  to: string;
}

const emptyFilters: Filters = {
  search: '',
  userId: '',
  deviceId: '',
  kind: '',
  operation: '',
  status: '',
  provider: '',
  correlationId: '',
  cycleId: '',
  turnId: '',
  from: '',
  to: '',
};

export function DeveloperDebugPage() {
  const { id } = useParams();
  return id ? <EventDetail id={id} /> : <EventList />;
}

function EventList() {
  const [filters, setFilters] = useState<Filters>(emptyFilters);
  const [cursor, setCursor] = useState<string | undefined>(undefined);
  const [history, setHistory] = useState<string[]>([]);

  const query = useQuery({
    queryKey: ['debug-events', filters, cursor],
    queryFn: () =>
      api<DebugEventsPage>(
        `/api/admin/developer/debug-events${queryString({
          search: filters.search || undefined,
          userId: filters.userId || undefined,
          deviceId: filters.deviceId || undefined,
          kind: filters.kind || undefined,
          operation: filters.operation || undefined,
          status: filters.status || undefined,
          provider: filters.provider || undefined,
          correlationId: filters.correlationId || undefined,
          cycleId: filters.cycleId || undefined,
          turnId: filters.turnId || undefined,
          from: filters.from || undefined,
          to: filters.to || undefined,
          cursor: cursor || undefined,
          limit: 30,
        })}`,
      ),
  });

  const cleanupMutation = useMutation({
    mutationFn: () => api('/api/admin/developer/debug-events/expired', { method: 'DELETE' }),
  });

  function handleFilterChange(value: Filters) {
    setFilters(value);
    setCursor(undefined);
    setHistory([]);
  }

  function handleNext() {
    if (query.data?.nextCursor) {
      setHistory((prev) => [...prev, cursor ?? '']);
      setCursor(query.data!.nextCursor);
    }
  }

  function handlePrev() {
    if (history.length > 0) {
      const prev = history[history.length - 1];
      setHistory((h) => h.slice(0, -1));
      setCursor(prev || undefined);
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="Caretaker Desk · Developer Debug"
        title="Debug Events"
        description="Inspect AI calls, research execution traces, and pipeline failures. Events are cursor-paginated and grouped by correlation."
        actions={
          <Button
            variant="secondary"
            onClick={() => void cleanupMutation.mutateAsync()}
            disabled={cleanupMutation.isPending}
          >
            {cleanupMutation.isPending ? <InlineSpinner label="Cleaning" /> : <><Trash2 /> Clean expired</>}
          </Button>
        }
      />
      <DebugFilters value={filters} onChange={handleFilterChange} />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && (
        <EmptyState title="No debug events match">Try a wider search, different kind, or adjust date range.</EmptyState>
      )}
      <div className="admin-card-list">
        {query.data?.items.map((event) => (
          <EventRow key={event.id} event={event} />
        ))}
      </div>
      {query.data && (
        <nav className="pagination" aria-label="Cursor pagination">
          <Button variant="quiet" disabled={history.length === 0} onClick={handlePrev}>
            <ChevronLeft /> Previous
          </Button>
          <span>cursor page {history.length + 1}</span>
          <Button variant="quiet" disabled={!query.data.nextCursor} onClick={handleNext}>
            Next <ChevronRight />
          </Button>
        </nav>
      )}
      {cleanupMutation.isSuccess && <p className="muted">Expired events cleaned.</p>}
      {cleanupMutation.isError && <p className="inline-error" role="alert">{cleanupMutation.error.message}</p>}
    </>
  );
}

function EventRow({ event }: { event: DebugEvent }) {
  const Icon = kindIcons[event.kind] ?? Webhook;
  return (
    <PaperCard className="admin-list-row debug-event-row">
      <span className="avatar avatar--letter debug-event-icon">
        <Icon aria-hidden="true" />
      </span>
      <div className="admin-list-main">
        <strong>{event.operation || event.kind}</strong>
        <small>
          {formatDate(event.createdAt, { dateStyle: 'medium', timeStyle: 'short' })}
          {' · '}
          {event.username || shortId(event.userId)}
          {event.deviceId ? ` · Device ${shortId(event.deviceId)}` : ''}
        </small>
      </div>
      <Stamp tone={kindTones[event.kind] ?? 'neutral'}>{sentenceCase(event.kind)}</Stamp>
      <Stamp tone={event.status === 'success' ? 'good' : event.status === 'error' ? 'bad' : 'warn'}>
        {sentenceCase(event.status)}
      </Stamp>
      {event.provider && <small>{event.provider}/{event.model}</small>}
      {event.correlationId && <small title={event.correlationId}>CID {shortId(event.correlationId)}</small>}
      {event.errorMessage && <small className="debug-event-error">{event.errorMessage.slice(0, 80)}</small>}
      <Link className="button button--quiet" to={`/caretaker/debug/${event.id}`}>Inspect</Link>
    </PaperCard>
  );
}

function EventDetail({ id }: { id: string }) {
  const query = useQuery({
    queryKey: ['debug-event', id],
    queryFn: () => api<DebugEventDetail>(`/api/admin/developer/debug-events/${id}`),
  });

  const event = query.data;
  const relatedIds = useMemo(() => {
    if (!event?.relatedEvents?.length) return [];
    return event.relatedEvents.map((e) => e.id);
  }, [event?.relatedEvents]);

  const relatedIndex = useMemo(() => {
    return relatedIds.indexOf(id);
  }, [relatedIds, id]);

  const prevId = relatedIndex > 0 ? relatedIds[relatedIndex - 1] : null;
  const nextId = relatedIndex >= 0 && relatedIndex < relatedIds.length - 1 ? relatedIds[relatedIndex + 1] : null;

  const copyJson = useCallback(() => {
    if (!event) return;
    const text = JSON.stringify(event, null, 2);
    void navigator.clipboard.writeText(text);
  }, [event]);

  const downloadRedacted = useCallback(() => {
    if (!event) return;
    const text = JSON.stringify(event, null, 2);
    const blob = new Blob([text], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `debug-event-${shortId(id)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  }, [event, id]);

  return (
    <>
      <PageHeader
        eyebrow="Caretaker Desk · Debug Event Detail"
        title={event?.operation || event?.kind || 'Debug event'}
        description={`Event ${shortId(id)} · ${event ? formatDate(event.createdAt) : 'Loading…'}`}
        actions={
          <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
            <Button variant="secondary" onClick={copyJson}><Copy /> Copy JSON</Button>
            <Button variant="secondary" onClick={downloadRedacted}><Download /> Download redacted</Button>
            <Link className="button button--quiet" to="/caretaker/debug">← All events</Link>
          </div>
        }
      />
      {query.isLoading && <SkeletonGrid cards={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {event && (
        <>
          <PaperCard className="inspector-hero">
            <div className="section-heading">
              <div>
                <p className="eyebrow">Event summary</p>
                <h2>{event.operation || event.kind}</h2>
              </div>
              <Stamp tone={kindTones[event.kind] ?? 'neutral'}>{sentenceCase(event.kind)}</Stamp>
            </div>
            <dl className="detail-grid">
              <div><dt>Time</dt><dd>{formatDate(event.createdAt)}</dd></div>
              <div><dt>User</dt><dd>{event.username || shortId(event.userId)}</dd></div>
              <div><dt>Device</dt><dd>{shortId(event.deviceId)}</dd></div>
              <div><dt>Status</dt><dd><Stamp tone={event.status === 'success' ? 'good' : event.status === 'error' ? 'bad' : 'warn'}>{sentenceCase(event.status)}</Stamp></dd></div>
              {event.provider && <div><dt>Provider/Model</dt><dd>{event.provider}/{event.model}</dd></div>}
              {event.correlationId && <div><dt>Correlation ID</dt><dd><code>{event.correlationId}</code></dd></div>}
              {event.cycleId && <div><dt>Cycle ID</dt><dd><code>{event.cycleId}</code></dd></div>}
              {event.turnId && <div><dt>Turn ID</dt><dd><code>{event.turnId}</code></dd></div>}
              {event.errorMessage && <div><dt>Error</dt><dd className="debug-error-text">{event.errorMessage}</dd></div>}
              {event.receivedAt && <div><dt>Received at</dt><dd>{formatDate(event.receivedAt)}</dd></div>}
              {event.expiresAt && <div><dt>Expires at</dt><dd>{formatDate(event.expiresAt)}</dd></div>}
            </dl>
          </PaperCard>

          <div className="inspector-columns">
            {event.payload && (
              <PaperCard>
                <div className="section-heading"><div><p className="eyebrow">Payload</p><h2>Payload</h2></div><Zap /></div>
                <div className="debug-content-container">
                  <pre className="debug-content">{JSON.stringify(event.payload, null, 2)}</pre>
                </div>
              </PaperCard>
            )}
          </div>

          {event.relatedEvents && event.relatedEvents.length > 0 && (
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Related</p><h2>Related event timeline</h2></div><GitCommitHorizontal /></div>
              <div className="compact-list">
                {event.relatedEvents
                  .slice()
                  .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime())
                  .map((related) => (
                  <div key={related.id} className={related.id === id ? 'highlight-current' : undefined}>
                    <span>
                      <strong>{related.operation || related.kind}</strong>
                      <small>
                        {formatDate(related.createdAt)} · {sentenceCase(related.kind)} · {sentenceCase(related.status)}
                        {related.summary && ` · ${related.summary}`}
                        {related.errorMessage && ` · ${related.errorMessage.slice(0, 80)}`}
                      </small>
                    </span>
                    <Link
                      className="button button--quiet"
                      to={`/caretaker/debug/${related.id}`}
                      aria-current={related.id === id ? 'page' : undefined}
                    >
                      {related.id === id ? 'Current' : 'View'}
                    </Link>
                  </div>
                ))}
              </div>
              <nav className="debug-related-nav" aria-label="Related event navigation">
                <Button variant="quiet" disabled={!prevId} onClick={() => { if (prevId) window.location.href = `/caretaker/debug/${prevId}`; }}>
                  <ChevronLeft /> Previous related
                </Button>
                <span>{relatedIndex >= 0 ? `${relatedIndex + 1} of ${relatedIds.length}` : ''}</span>
                <Button variant="quiet" disabled={!nextId} onClick={() => { if (nextId) window.location.href = `/caretaker/debug/${nextId}`; }}>
                  Next related <ChevronRight />
                </Button>
              </nav>
            </PaperCard>
          )}
        </>
      )}
    </>
  );
}

function DebugFilters({ value, onChange }: { value: Filters; onChange: (f: Filters) => void }) {
  const [draft, setDraft] = useState(value);
  return (
    <form className="list-filters debug-filters" onSubmit={(e) => { e.preventDefault(); onChange(draft); }}>
      <label>
        <span className="sr-only">Search</span>
        <Filter aria-hidden="true" />
        <input
          value={draft.search}
          placeholder="Search summary, operation, correlation, cycle, error..."
          onChange={(e) => setDraft({ ...draft, search: e.target.value })}
        />
      </label>
      <label>
        <span className="sr-only">Kind</span>
        <select value={draft.kind} onChange={(e) => setDraft({ ...draft, kind: e.target.value as DebugEventKind | '' })}>
          {KIND_OPTIONS.map((opt) => (
            <option value={opt.value} key={opt.value}>{opt.label}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">Status</span>
        <select value={draft.status} onChange={(e) => setDraft({ ...draft, status: e.target.value })}>
          <option value="">All statuses</option>
          {STATUS_OPTIONS.filter(Boolean).map((s) => (
            <option value={s} key={s}>{sentenceCase(s)}</option>
          ))}
        </select>
      </label>
      <label>
        <span className="sr-only">User ID</span>
        <input value={draft.userId} placeholder="User ID" onChange={(e) => setDraft({ ...draft, userId: e.target.value })} />
      </label>
      <label>
        <span className="sr-only">Device ID</span>
        <input value={draft.deviceId} placeholder="Device ID" onChange={(e) => setDraft({ ...draft, deviceId: e.target.value })} />
      </label>
      <label>
        <span className="sr-only">Operation</span>
        <input value={draft.operation} placeholder="Operation" onChange={(e) => setDraft({ ...draft, operation: e.target.value })} />
      </label>
      <label>
        <span className="sr-only">Provider</span>
        <input value={draft.provider} placeholder="Provider" onChange={(e) => setDraft({ ...draft, provider: e.target.value })} />
      </label>
      <label>
        <span className="sr-only">Correlation ID</span>
        <input value={draft.correlationId} placeholder="Correlation ID" onChange={(e) => setDraft({ ...draft, correlationId: e.target.value })} />
      </label>
      <label>
        <span className="sr-only">Cycle ID</span>
        <input value={draft.cycleId} placeholder="Cycle ID" onChange={(e) => setDraft({ ...draft, cycleId: e.target.value })} />
      </label>
      <label>
        <span className="sr-only">Turn ID</span>
        <input value={draft.turnId} placeholder="Turn ID" onChange={(e) => setDraft({ ...draft, turnId: e.target.value })} />
      </label>
      <label><span>From</span><input type="date" value={draft.from} onChange={(e) => setDraft({ ...draft, from: e.target.value })} /></label>
      <label><span>To</span><input type="date" value={draft.to} onChange={(e) => setDraft({ ...draft, to: e.target.value })} /></label>
      <Button type="submit" variant="secondary"><Filter /> Apply</Button>
      {(value.search || value.kind || value.status || value.from || value.to || value.userId || value.deviceId || value.operation || value.provider || value.correlationId || value.cycleId || value.turnId) && (
        <Button type="button" variant="quiet" onClick={() => { const empty = emptyFilters; setDraft(empty); onChange(empty); }}>Clear</Button>
      )}
    </form>
  );
}


