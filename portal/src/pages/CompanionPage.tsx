import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Archive, Boxes, Cat, CheckCircle2, Clock3, FileCheck2, Tag } from 'lucide-react';
import { api, type PageEnvelope } from '../lib/api';
import { formatBytes, formatDate, sentenceCase, shortId } from '../lib/format';
import {
  Button,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  PaperCard,
  SkeletonGrid,
  Stamp,
} from '../components/ui';

interface Companion {
  id: string;
  name: string;
  publicDescription: string | null;
  publicTags: string[];
  visibility: string;
  published: boolean;
  activeAssetPackId: string | null;
  publishedAt: string | null;
  createdAt: string;
  updatedAt: string;
  activeAssetPack?: {
    status: string;
    totalFiles: number;
    totalBytes: number;
    failureCode: string | null;
  } | null;
}

interface AssetPack {
  id: string;
  manifestHash: string;
  schemaVersion: number;
  status: string;
  totalFiles: number;
  totalBytes: number;
  failureCode: string | null;
  createdAt: string;
  activatedAt: string | null;
  supersededAt: string | null;
  _count: { files: number };
}

export function CompanionPage() {
  const [page, setPage] = useState(1);
  const [packPage, setPackPage] = useState(1);
  const queryClient = useQueryClient();
  const companions = useQuery({
    queryKey: ['companions', page],
    queryFn: () => api<PageEnvelope<Companion>>(`/api/portal/companions?page=${page}&limit=12`),
  });
  const companion = companions.data?.items[0];
  const packs = useQuery({
    queryKey: ['asset-packs', companion?.id, packPage],
    queryFn: () => api<PageEnvelope<AssetPack>>(
      `/api/portal/companions/${companion!.id}/asset-packs?page=${packPage}&limit=8`,
    ),
    enabled: Boolean(companion),
  });
  const publish = useMutation({
    mutationFn: (published: boolean) => api(
      `/api/portal/companions/${companion!.id}/${published ? 'unpublish' : 'publish'}`,
      { method: 'POST' },
    ),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['companions'] }),
  });

  return (
    <>
      <PageHeader
        eyebrow="My Network · Passport"
        title="My Companion"
        description="The public-facing identity, travel-ready animation pack, and publication history for your companion."
      />
      {companions.isLoading && <SkeletonGrid cards={3} />}
      {companions.isError && <ErrorState error={companions.error} onRetry={() => void companions.refetch()} />}
      {companions.data && !companion && (
        <EmptyState title="Your passport is waiting">
          Publish a Network Companion from the desktop app. Only your own companion can appear here.
        </EmptyState>
      )}
      {companion && (
        <>
          <PaperCard className="companion-passport">
            <div className="passport-photo">
              <Cat aria-hidden="true" />
              <span>OC NETWORK</span>
            </div>
            <div className="passport-details">
              <div className="section-heading">
                <div>
                  <p className="eyebrow">Companion passport</p>
                  <h2>{companion.name}</h2>
                </div>
                <Stamp tone={companion.published ? 'good' : 'neutral'}>
                  {companion.published ? 'Published' : 'Private'}
                </Stamp>
              </div>
              <p>{companion.publicDescription || 'No public description has been added yet.'}</p>
              <dl className="detail-grid">
                <div><dt>Visibility</dt><dd>{sentenceCase(companion.visibility)}</dd></div>
                <div><dt>Last published</dt><dd>{formatDate(companion.publishedAt)}</dd></div>
                <div><dt>Passport updated</dt><dd>{formatDate(companion.updatedAt)}</dd></div>
                <div><dt>Active pack</dt><dd>{shortId(companion.activeAssetPackId)}</dd></div>
              </dl>
              <div className="tag-row" aria-label="Public tags">
                <Tag aria-hidden="true" />
                {companion.publicTags.length
                  ? companion.publicTags.map((tag) => <span key={tag}>{tag}</span>)
                  : <span>No public tags</span>}
              </div>
              <Button
                variant={companion.published ? 'secondary' : 'primary'}
                onClick={() => publish.mutate(companion.published)}
                disabled={publish.isPending}
              >
                {companion.published ? 'Make private' : 'Publish companion'}
              </Button>
              {publish.isError && <p className="inline-error" role="alert">{publish.error.message}</p>}
            </div>
          </PaperCard>
          <div className="section-title">
            <div>
              <p className="eyebrow">Wardrobe archive</p>
              <h2>Asset Pack history</h2>
            </div>
            <Archive aria-hidden="true" />
          </div>
          {packs.isLoading && <SkeletonGrid cards={2} />}
          {packs.isError && <ErrorState error={packs.error} onRetry={() => void packs.refetch()} />}
          {packs.data?.items.length === 0 && (
            <EmptyState title="No animation packs yet">Upload and verify a pack from the desktop app.</EmptyState>
          )}
          <div className="pack-list">
            {packs.data?.items.map((pack) => (
              <PaperCard className="pack-card" key={pack.id}>
                <div className="pack-card__heading">
                  <Boxes aria-hidden="true" />
                  <div>
                    <strong>Pack {shortId(pack.id)}</strong>
                    <small>Manifest v{pack.schemaVersion} · {shortId(pack.manifestHash)}</small>
                  </div>
                  <Stamp tone={pack.status === 'active' ? 'good' : pack.status === 'failed' ? 'bad' : 'neutral'}>
                    {sentenceCase(pack.status)}
                  </Stamp>
                </div>
                <div className="pack-stats">
                  <span><FileCheck2 />{pack.totalFiles} files</span>
                  <span><Archive />{formatBytes(pack.totalBytes)}</span>
                  <span><Clock3 />{formatDate(pack.activatedAt || pack.createdAt)}</span>
                  <span><CheckCircle2 />{pack.failureCode || 'No verification failure'}</span>
                </div>
              </PaperCard>
            ))}
          </div>
          {packs.data && <Pagination {...packs.data.pagination} onPage={setPackPage} />}
          {companions.data && companions.data.pagination.totalPages > 1 && (
            <Pagination {...companions.data.pagination} onPage={setPage} />
          )}
        </>
      )}
    </>
  );
}
