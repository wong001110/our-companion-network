import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Boxes, Cat, EyeOff, Hash, Tags } from 'lucide-react';
import { api, jsonBody, queryString, type PageEnvelope } from '../../lib/api';
import { formatBytes, formatDate, sentenceCase, shortId } from '../../lib/format';
import { ListFilters, type ListFilterValues } from '../../components/ListFilters';
import { Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, PaperCard, SkeletonGrid, Stamp } from '../../components/ui';

interface AdminCompanion {
  id: string;
  ownerUserId: string;
  name: string;
  publicDescription: string | null;
  publicTags: string[];
  visibility: string;
  published: boolean;
  activeAssetPackId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  owner?: { id: string; uid: string; username: string };
  activeAssetPack?: { id: string; manifestHash: string; status: string; totalFiles: number; totalBytes: number } | null;
  _count?: { assetPacks: number; visitInvitations: number; visitSessions: number };
}

const empty: ListFilterValues = { search: '', status: '', dateFrom: '', dateTo: '' };

export function AdminCompanionsPage() {
  const { id } = useParams();
  return id ? <CompanionDetail id={id} /> : <CompanionList />;
}

function CompanionList() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(empty);
  const query = useQuery({
    queryKey: ['admin-companions', page, filters],
    queryFn: () => api<PageEnvelope<AdminCompanion>>(`/api/admin/companions${queryString({ ...filters, page, limit: 20 })}`),
  });
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Companion observatory" title="Network Companions" description="Inspect public identity, owners, publication state, manifest references, and live visit dependencies." />
      <ListFilters value={filters} statusOptions={['published', 'unpublished']} searchPlaceholder="Companion name, owner UID, or companion ID" onChange={(value) => { setFilters(value); setPage(1); }} />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState title="No companions match">Try clearing the current filters.</EmptyState>}
      <div className="admin-card-list">
        {query.data?.items.map((companion) => (
          <PaperCard className="admin-list-row" key={companion.id}>
            <span className="device-icon"><Cat /></span>
            <div className="admin-list-main"><strong>{companion.name}</strong><small>{companion.owner?.uid} · {shortId(companion.id)}</small></div>
            <Stamp tone={companion.published ? 'good' : 'neutral'}>{companion.published ? 'Published' : 'Private'}</Stamp>
            <span>{sentenceCase(companion.visibility)}</span>
            <small>Updated {formatDate(companion.updatedAt)}</small>
            <Link className="button button--quiet" to={`/caretaker/companions/${companion.id}`}>Observe</Link>
          </PaperCard>
        ))}
      </div>
      {query.data && <Pagination {...query.data.pagination} onPage={setPage} />}
    </>
  );
}

function CompanionDetail({ id }: { id: string }) {
  const [reason, setReason] = useState('');
  const [confirm, setConfirm] = useState(false);
  const client = useQueryClient();
  const query = useQuery({ queryKey: ['admin-companion', id], queryFn: () => api<AdminCompanion>(`/api/admin/companions/${id}`) });
  const mutation = useMutation({
    mutationFn: () => api(`/api/admin/companions/${id}/unpublish`, { method: 'POST', ...jsonBody({ reason }) }),
    onSuccess: () => { setConfirm(false); setReason(''); void client.invalidateQueries({ queryKey: ['admin-companion', id] }); },
  });
  const companion = query.data;
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Companion observatory" title={companion?.name || 'Companion details'} description="A read-only view of the public passport and its active pack. Privileged unpublishing requires a reason." actions={<Link className="button button--quiet" to="/caretaker/companions">← Observatory</Link>} />
      {query.isLoading && <SkeletonGrid cards={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {companion && (
        <div className="detail-layout">
          <PaperCard className="inspector-hero">
            <div className="section-heading"><div><p className="eyebrow">Public passport</p><h2>{companion.name}</h2></div><Stamp tone={companion.published ? 'good' : 'neutral'}>{companion.published ? 'Published' : 'Private'}</Stamp></div>
            <p>{companion.publicDescription || 'No public description.'}</p>
            <div className="tag-row"><Tags />{companion.publicTags?.length ? companion.publicTags.map((tag) => <span key={tag}>{tag}</span>) : <span>No tags</span>}</div>
            <dl className="detail-grid">
              <div><dt>Owner</dt><dd>{companion.owner?.username} · {companion.owner?.uid}</dd></div><div><dt>Visibility</dt><dd>{sentenceCase(companion.visibility)}</dd></div>
              <div><dt>Created</dt><dd>{formatDate(companion.createdAt)}</dd></div><div><dt>Published</dt><dd>{formatDate(companion.publishedAt)}</dd></div>
            </dl>
            {companion.published && <Button variant="danger" onClick={() => setConfirm(true)}><EyeOff /> Unpublish companion</Button>}
          </PaperCard>
          <PaperCard>
            <div className="section-heading"><div><p className="eyebrow">Active wardrobe</p><h2>Asset Pack</h2></div><Boxes /></div>
            {companion.activeAssetPack ? (
              <>
                <dl className="detail-grid">
                  <div><dt>Status</dt><dd>{sentenceCase(companion.activeAssetPack.status)}</dd></div>
                  <div><dt>Pack ID</dt><dd>{shortId(companion.activeAssetPack.id)}</dd></div>
                  <div><dt>Files</dt><dd>{companion.activeAssetPack.totalFiles}</dd></div>
                  <div><dt>Size</dt><dd>{formatBytes(companion.activeAssetPack.totalBytes)}</dd></div>
                </dl>
                <p className="hash-line"><Hash /> {companion.activeAssetPack.manifestHash}</p>
                <Link className="text-link" to={`/caretaker/assets/${companion.activeAssetPack.id}`}>Inspect files and manifest →</Link>
              </>
            ) : <p>No active Asset Pack.</p>}
          </PaperCard>
          <PaperCard><p className="eyebrow">Active references</p><h2>Network footprint</h2><div className="count-grid">{Object.entries(companion._count ?? {}).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{sentenceCase(label)}</span></div>)}</div></PaperCard>
        </div>
      )}
      <ConfirmDialog open={confirm} title="Unpublish this companion?" description="Active visit access will be revoked. Add a specific reason for the audit log." confirmLabel="Unpublish companion" destructive reason={reason} reasonRequired onReasonChange={setReason} busy={mutation.isPending} onCancel={() => { setConfirm(false); setReason(''); }} onConfirm={() => mutation.mutate()} />
      {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
    </>
  );
}
