import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, jsonBody } from '../../lib/api';
import { Button, EmptyState, ErrorState, PaperCard, Stamp } from '../../components/ui';

export interface ShareableTopic {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  sourceUrl?: string;
  audience: 'friends' | 'selected';
  shareScope: 'summary_only' | 'summary_and_source';
  allowRecipientSave: boolean;
  eligibleForRandomVisit: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
}

interface CompanionPolicy {
  id: string;
  published: boolean;
  randomVisitsEnabled: boolean;
  randomVisitAudience: string;
  allowJoinRequests: boolean;
}

type TopicDraft = {
  title: string;
  summary: string;
  tags: string;
  sourceUrl: string;
  eligibleForRandomVisit: boolean;
  allowRecipientSave: boolean;
  shareScope: 'summary_only' | 'summary_and_source';
};

const emptyDraft: TopicDraft = { title: '', summary: '', tags: '', sourceUrl: '', eligibleForRandomVisit: false, allowRecipientSave: false, shareScope: 'summary_only' };

export function ShareableTopicsPanel({ companion }: { companion: CompanionPolicy }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft);
  const topics = useQuery({
    queryKey: ['shareable-topics', companion.id],
    queryFn: () => api<ShareableTopic[]>(`/api/portal/companions/${companion.id}/shareable-topics`),
  });
  const createTopic = useMutation({
    mutationFn: () => api(`/api/portal/companions/${companion.id}/shareable-topics`, {
      method: 'POST',
      ...jsonBody({
        title: draft.title,
        summary: draft.summary,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        sourceUrl: draft.shareScope === 'summary_and_source' && draft.sourceUrl ? draft.sourceUrl : undefined,
        audience: 'friends',
        shareScope: draft.shareScope,
        allowRecipientSave: draft.allowRecipientSave,
        eligibleForRandomVisit: draft.eligibleForRandomVisit,
      }),
    }),
    onSuccess: () => {
      setDraft(emptyDraft);
      void queryClient.invalidateQueries({ queryKey: ['shareable-topics', companion.id] });
    },
  });
  const revoke = useMutation({
    mutationFn: (topicId: string) => api(`/api/portal/companions/${companion.id}/shareable-topics/${topicId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shareable-topics', companion.id] }),
  });
  const policy = useMutation({
    mutationFn: (next: Partial<CompanionPolicy>) => api(`/api/portal/companions/${companion.id}/social-policy`, { method: 'PATCH', ...jsonBody(next) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['companions'] });
      void queryClient.invalidateQueries({ queryKey: ['shareable-topics', companion.id] });
    },
  });
  const hasRandomTopic = topics.data?.some((topic) => topic.eligibleForRandomVisit) ?? false;

  useEffect(() => setDraft(emptyDraft), [companion.id]);

  return <section aria-labelledby="shareable-topics-heading">
    <div className="section-title"><div><p className="eyebrow">Social permissions</p><h2 id="shareable-topics-heading">Shareable Topics</h2></div><Globe2 /></div>
    <PaperCard>
      <div className="section-heading"><div><h3>Random Visit policy</h3><p>Random visitors discuss one active topic owned by this Host Companion.</p></div><ShieldCheck /></div>
      <label className="inline-form"><input type="checkbox" checked={companion.randomVisitsEnabled} disabled={!companion.published || !hasRandomTopic || policy.isPending} onChange={(event) => policy.mutate({ randomVisitsEnabled: event.target.checked })} /> Accept random visits from friends</label>
      <label className="inline-form"><input type="checkbox" checked={companion.allowJoinRequests} disabled={policy.isPending} onChange={(event) => policy.mutate({ allowJoinRequests: event.target.checked })} /> Allow another Companion to request joining a future Social Room</label>
      {!companion.published && <p className="inline-error">Publish this Companion before enabling random visits.</p>}
      {!hasRandomTopic && <p>Create at least one topic marked for random visits.</p>}
      {policy.isError && <p className="inline-error">{policy.error.message}</p>}
    </PaperCard>
    <PaperCard>
      <h3>Add an approved topic</h3>
      <div className="form-grid">
        <label><span>Title</span><input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label><span>Tags, separated by commas</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
        <label className="form-span"><span>Public summary</span><textarea maxLength={600} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        <label><span>Sharing scope</span><select value={draft.shareScope} onChange={(event) => setDraft({ ...draft, shareScope: event.target.value as TopicDraft['shareScope'] })}><option value="summary_only">Summary only</option><option value="summary_and_source">Summary and source</option></select></label>
        {draft.shareScope === 'summary_and_source' && <label><span>HTTPS source URL</span><input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></label>}
        <label><input type="checkbox" checked={draft.eligibleForRandomVisit} onChange={(event) => setDraft({ ...draft, eligibleForRandomVisit: event.target.checked })} /> Available for random visits</label>
        <label><input type="checkbox" checked={draft.allowRecipientSave} onChange={(event) => setDraft({ ...draft, allowRecipientSave: event.target.checked })} /> Allow recipient to save the topic later</label>
      </div>
      <Button disabled={!draft.title.trim() || !draft.summary.trim() || createTopic.isPending} onClick={() => createTopic.mutate()}><Plus /> Add topic</Button>
      {createTopic.isError && <p className="inline-error">{createTopic.error.message}</p>}
    </PaperCard>
    {topics.isError && <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />}
    {topics.data?.length === 0 && <EmptyState title="No approved topics">Add a sanitized summary before allowing Social Visits to use it.</EmptyState>}
    <div className="pack-list">
      {topics.data?.map((topic) => <PaperCard className="pack-card" key={topic.id}>
        <div className="section-heading"><div><h3>{topic.title}</h3><p>{topic.summary}</p></div><Stamp tone={topic.eligibleForRandomVisit ? 'good' : 'neutral'}>{topic.eligibleForRandomVisit ? 'Random Visit' : 'Manual only'}</Stamp></div>
        {topic.tags.length > 0 && <p>{topic.tags.join(' · ')}</p>}
        {topic.sourceUrl && <a className="text-link" href={topic.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
        <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(topic.id)}><Trash2 /> Revoke</Button>
      </PaperCard>)}
    </div>
  </section>;
}
