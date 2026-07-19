import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Boxes, FileCheck2, Hash, RefreshCw, TriangleAlert } from 'lucide-react';
import { api, jsonBody, queryString, type PageEnvelope } from '../../lib/api';
import { formatBytes, formatDate, sentenceCase, shortId } from '../../lib/format';
import { ListFilters, type ListFilterValues } from '../../components/ListFilters';
import { Button, ConfirmDialog, EmptyState, ErrorState, PageHeader, Pagination, PaperCard, SkeletonGrid, Stamp } from '../../components/ui';

interface Pack {
  id: string;
  companionId: string;
  manifestHash: string;
  schemaVersion?: number;
  manifest?: unknown;
  status: string;
  objectPrefix?: string;
  totalFiles: number;
  totalBytes: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  completedAt?: string | null;
  activatedAt?: string | null;
  supersededAt?: string | null;
  companion?: { name: string; owner: { id: string; uid: string } };
  files?: Array<{
    id: string;
    relativePath: string;
    objectKey: string;
    mimeType: string;
    sizeBytes: number;
    sha256: string;
    category: string;
    uploaded: boolean;
    verifiedAt: string | null;
    r2ObjectExists?: boolean | null;
    r2Integrity?: string | null;
  }>;
  _count?: { visitInvitationRefs: number; visitSessionRefs: number };
  storageInspection?: {
    available: boolean;
    manifestMismatch: boolean;
    manifestObjectExists: boolean | null;
    missingObjects: string[] | null;
    orphanObjects: string[] | null;
    shaMismatches: string[] | null;
    metadataMismatches: string[] | null;
    fileInspectionTruncated?: boolean;
  };
}

const empty: ListFilterValues = { search: '', status: '', dateFrom: '', dateTo: '' };
const packStatuses = ['uploading', 'verifying', 'active', 'superseded', 'failed', 'abandoning', 'abandoned', 'deleting'];

export function AdminAssetsPage() {
  const { id } = useParams();
  return id ? <AssetDetail id={id} /> : <AssetList />;
}

function AssetList() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(empty);
  const [cleanup, setCleanup] = useState(false);
  const [reason, setReason] = useState('');
  const client = useQueryClient();
  const query = useQuery({
    queryKey: ['admin-assets', page, filters],
    queryFn: () => api<PageEnvelope<Pack>>(`/api/admin/asset-packs${queryString({ ...filters, page, limit: 20 })}`),
  });
  const mutation = useMutation({
    mutationFn: () => api('/api/admin/storage/cleanup', { method: 'POST', ...jsonBody({ reason }) }),
    onSuccess: () => { setCleanup(false); setReason(''); void client.invalidateQueries({ queryKey: ['admin-assets'] }); },
  });
  return (
    <>
      <PageHeader
        eyebrow="Caretaker Desk · Storage inspector"
        title="Asset Storage"
        description="Inspect bounded pack records and verification signals. Cleanup follows reference checks and never accepts arbitrary object keys."
        actions={<Button variant="secondary" onClick={() => setCleanup(true)}><RefreshCw /> Run safe cleanup</Button>}
      />
      <ListFilters value={filters} statusOptions={packStatuses} searchPlaceholder="Pack ID, manifest hash, or companion name" onChange={(value) => { setFilters(value); setPage(1); }} />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState title="No packs match">No Asset Packs fit these filters.</EmptyState>}
      <div className="admin-card-list">
        {query.data?.items.map((pack) => (
          <PaperCard className="admin-list-row" key={pack.id}>
            <span className="device-icon"><Boxes /></span>
            <div className="admin-list-main"><strong>{pack.companion?.name || shortId(pack.companionId)}</strong><small>{shortId(pack.id)} · {pack.companion?.owner.uid}</small></div>
            <Stamp tone={pack.status === 'active' ? 'good' : pack.status === 'failed' ? 'bad' : 'neutral'}>{sentenceCase(pack.status)}</Stamp>
            <span>{pack.totalFiles} files · {formatBytes(pack.totalBytes)}</span>
            <small>{pack.failureCode || formatDate(pack.updatedAt)}</small>
            <Link className="button button--quiet" to={`/caretaker/assets/${pack.id}`}>Inspect</Link>
          </PaperCard>
        ))}
      </div>
      {query.data && <Pagination {...query.data.pagination} onPage={setPage} />}
      <ConfirmDialog open={cleanup} title="Run safe storage reconciliation?" description="Eligible expired uploads and superseded packs are checked for references before cleanup. Add the operational reason." confirmLabel="Run reconciliation" destructive reason={reason} reasonRequired onReasonChange={setReason} busy={mutation.isPending} onCancel={() => { setCleanup(false); setReason(''); }} onConfirm={() => mutation.mutate()} />
      {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
    </>
  );
}

function AssetDetail({ id }: { id: string }) {
  const query = useQuery({ queryKey: ['admin-asset', id], queryFn: () => api<Pack>(`/api/admin/asset-packs/${id}`) });
  const pack = query.data;
  const missing = pack?.files?.filter((file) => !file.uploaded).length ?? 0;
  const unverified = pack?.files?.filter((file) => !file.verifiedAt).length ?? 0;
  const inspection = pack?.storageInspection;
  const missingObjects = inspectionCount(inspection?.missingObjects);
  const orphanObjects = inspectionCount(inspection?.orphanObjects);
  const shaMismatches = inspectionCount(inspection?.shaMismatches);
  const metadataMismatches = inspectionCount(inspection?.metadataMismatches);
  const inspectionClean = Boolean(
    inspection?.available
    && !inspection.manifestMismatch
    && inspection.manifestObjectExists
    && missingObjects === 0
    && orphanObjects === 0
    && shaMismatches === 0
    && metadataMismatches === 0
    && !inspection.fileInspectionTruncated,
  );
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Storage inspector" title="Asset Pack details" description="Manifest, animation files, verification state, and active visit references for one bounded pack." actions={<Link className="button button--quiet" to="/caretaker/assets">← Asset Storage</Link>} />
      {query.isLoading && <SkeletonGrid cards={5} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {pack && (
        <>
          <PaperCard className="inspector-hero">
            <div className="section-heading"><div><p className="eyebrow">Pack {shortId(pack.id)}</p><h2>{sentenceCase(pack.status)}</h2></div><Stamp tone={pack.status === 'active' ? 'good' : pack.status === 'failed' ? 'bad' : 'warn'}>{pack.failureCode || 'No failure code'}</Stamp></div>
            <dl className="detail-grid">
              <div><dt>Companion ID</dt><dd>{shortId(pack.companionId)}</dd></div><div><dt>Schema</dt><dd>v{pack.schemaVersion}</dd></div>
              <div><dt>Total files</dt><dd>{pack.totalFiles}</dd></div><div><dt>Total bytes</dt><dd>{formatBytes(pack.totalBytes)}</dd></div>
              <div><dt>Missing uploads</dt><dd>{missing}</dd></div><div><dt>Unverified</dt><dd>{unverified}</dd></div>
              <div><dt>Invitation refs</dt><dd>{pack._count?.visitInvitationRefs ?? 0}</dd></div><div><dt>Session refs</dt><dd>{pack._count?.visitSessionRefs ?? 0}</dd></div>
            </dl>
            <p className="hash-line"><Hash />Manifest SHA-256 · {pack.manifestHash}</p>
            {pack.objectPrefix && <p className="sensitive-line">R2 prefix · {pack.objectPrefix}</p>}
          </PaperCard>
          {inspection && (
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">R2 reconciliation</p><h2>Object integrity</h2></div><Stamp tone={inspectionClean ? 'good' : 'warn'}>{inspection.available ? inspectionClean ? 'Verified' : 'Needs attention' : 'Unavailable'}</Stamp></div>
              <div className="count-grid">
                <div><strong>{inspection.manifestObjectExists == null ? '—' : inspection.manifestObjectExists ? 'Yes' : 'No'}</strong><span>Manifest object</span></div>
                <div><strong>{displayInspectionCount(inspection.missingObjects)}</strong><span>Missing objects</span></div>
                <div><strong>{displayInspectionCount(inspection.orphanObjects)}</strong><span>Orphan objects</span></div>
                <div><strong>{displayInspectionCount(inspection.shaMismatches)}</strong><span>SHA mismatches</span></div>
                <div><strong>{displayInspectionCount(inspection.metadataMismatches)}</strong><span>Metadata mismatch</span></div>
                <div><strong>{inspection.manifestMismatch ? 'Yes' : 'No'}</strong><span>Manifest mismatch</span></div>
              </div>
              {inspection.fileInspectionTruncated && <p className="failure-note">The database contains more than the 1,000-file Asset Pack contract permits. Object reconciliation is intentionally incomplete until the invalid pack is repaired.</p>}
            </PaperCard>
          )}
          {pack.failureCode === 'ASSET_CLEANUP_FAILED' && <div className="warning-banner"><TriangleAlert />Failed cleanup: R2 deletion or verification did not complete. The pack remains claimed for safe reconciliation and its database record was preserved.</div>}
          {(missing > 0 || unverified > 0 || missingObjects > 0 || orphanObjects > 0 || shaMismatches > 0 || metadataMismatches > 0 || Boolean(inspection?.manifestMismatch) || Boolean(inspection?.fileInspectionTruncated)) && <div className="warning-banner"><TriangleAlert />{missing} missing upload record(s), {unverified} unverified file(s), {missingObjects} absent R2 object(s), {orphanObjects} orphan object(s), {shaMismatches} SHA mismatch(es), {metadataMismatches} metadata mismatch(es).</div>}
          <PaperCard>
            <p className="eyebrow">Declared manifest</p>
            <h2>Manifest</h2>
            <pre className="json-view">{JSON.stringify(pack.manifest, null, 2)}</pre>
          </PaperCard>
          <PaperCard>
            <div className="section-heading"><div><p className="eyebrow">Animation archive</p><h2>Files</h2></div><FileCheck2 /></div>
            <div className="table-scroll" tabIndex={0} aria-label="Asset files table">
              <table>
                <thead><tr><th>Path</th><th>Category</th><th>MIME</th><th>Size</th><th>Uploaded</th><th>R2 object</th><th>Integrity</th><th>Verified</th><th>SHA-256</th></tr></thead>
                <tbody>{pack.files?.map((file) => <tr key={file.id}><td>{file.relativePath}</td><td>{sentenceCase(file.category)}</td><td>{file.mimeType}</td><td>{formatBytes(file.sizeBytes)}</td><td>{file.uploaded ? 'Yes' : 'No'}</td><td>{file.r2ObjectExists == null ? 'Not checked' : file.r2ObjectExists ? 'Exists' : 'Missing'}</td><td>{sentenceCase(file.r2Integrity)}</td><td>{formatDate(file.verifiedAt)}</td><td><code>{shortId(file.sha256)}</code></td></tr>)}</tbody>
              </table>
            </div>
          </PaperCard>
        </>
      )}
    </>
  );
}

export function inspectionCount(value: string[] | null | undefined): number {
  return value?.length ?? 0;
}

function displayInspectionCount(value: string[] | null | undefined): number | string {
  return value === null || value === undefined ? '—' : value.length;
}
