import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import { Laptop, ShieldAlert, UserRoundCheck, UsersRound } from 'lucide-react';
import { api, jsonBody, queryString, type PageEnvelope } from '../../lib/api';
import { formatDate, sentenceCase, shortId } from '../../lib/format';
import { ListFilters, type ListFilterValues } from '../../components/ListFilters';
import {
  Button,
  ConfirmDialog,
  EmptyState,
  ErrorState,
  PageHeader,
  Pagination,
  PaperCard,
  SkeletonGrid,
  Stamp,
} from '../../components/ui';

interface Account {
  id: string;
  uid: string;
  email: string;
  username: string;
  friendCode: string;
  role: string;
  accountStatus: string;
  suspendedAt: string | null;
  createdAt: string;
  updatedAt: string;
  profile?: Record<string, unknown> | null;
  presence?: { status: string; lastSeenAt: string | null } | null;
  deviceSessions?: Array<{ id: string; deviceId: string; lastUsedAt: string; expiresAt: string; revokedAt: string | null }>;
  networkCompanions?: Array<{ id: string; name: string; published: boolean }>;
  _count?: Record<string, number>;
}

const emptyFilters: ListFilterValues = { search: '', status: '', dateFrom: '', dateTo: '' };

export function AdminAccountsPage() {
  const { id } = useParams();
  return id ? <AccountDetail id={id} /> : <AccountList />;
}

function AccountList() {
  const [page, setPage] = useState(1);
  const [filters, setFilters] = useState(emptyFilters);
  const query = useQuery({
    queryKey: ['admin-accounts', page, filters],
    queryFn: () => api<PageEnvelope<Account>>(`/api/admin/users${queryString({ ...filters, page, limit: 20 })}`),
  });
  return (
    <>
      <PageHeader eyebrow="Caretaker Desk · Account inspector" title="Accounts" description="Search by UID, username, email, friend code, or account ID. Details are read-only until you choose a reasoned action." />
      <ListFilters
        value={filters}
        statusOptions={['ACTIVE', 'SUSPENDED']}
        searchPlaceholder="UID, email, username, friend code, account ID"
        onChange={(value) => { setFilters(value); setPage(1); }}
      />
      {query.isLoading && <SkeletonGrid cards={6} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {query.data?.items.length === 0 && <EmptyState title="No accounts match">Try a wider search or clear the filters.</EmptyState>}
      <div className="admin-card-list">
        {query.data?.items.map((account) => (
          <PaperCard className="admin-list-row" key={account.id}>
            <span className="avatar avatar--letter">{account.username.slice(0, 1).toUpperCase()}</span>
            <div className="admin-list-main"><strong>{account.username}</strong><small>{account.uid} · {account.email}</small></div>
            <Stamp tone={account.accountStatus === 'ACTIVE' ? 'good' : 'bad'}>{sentenceCase(account.accountStatus)}</Stamp>
            {account.role === 'SUPERADMIN' && <Stamp tone="purple">Superadmin</Stamp>}
            <small>Joined {formatDate(account.createdAt, { dateStyle: 'medium' })}</small>
            <Link className="button button--quiet" to={`/caretaker/accounts/${account.id}`}>Inspect</Link>
          </PaperCard>
        ))}
      </div>
      {query.data && <Pagination {...query.data.pagination} onPage={setPage} />}
    </>
  );
}

function AccountDetail({ id }: { id: string }) {
  const client = useQueryClient();
  const [dialog, setDialog] = useState<'suspend' | 'restore' | { deviceId: string } | null>(null);
  const [reason, setReason] = useState('');
  const query = useQuery({ queryKey: ['admin-account', id], queryFn: () => api<Account>(`/api/admin/users/${id}`) });
  const mutation = useMutation({
    mutationFn: ({ path }: { path: string }) => api(path, { method: dialog && typeof dialog === 'object' ? 'POST' : 'PATCH', ...jsonBody({ reason }) }),
    onSuccess: () => {
      setDialog(null);
      setReason('');
      void client.invalidateQueries({ queryKey: ['admin-account', id] });
      void client.invalidateQueries({ queryKey: ['admin-accounts'] });
    },
  });
  const account = query.data;
  const actionPath = dialog && typeof dialog === 'object'
    ? `/api/admin/users/${id}/devices/${dialog.deviceId}/revoke`
    : `/api/admin/users/${id}/${dialog}`;
  return (
    <>
      <PageHeader
        eyebrow="Caretaker Desk · Sensitive account view"
        title={account?.username || 'Account inspector'}
        description="Opening this page writes a sensitive-view audit event. Secret hashes and credentials are never returned."
        actions={<Link className="button button--quiet" to="/caretaker/accounts">← All accounts</Link>}
      />
      {query.isLoading && <SkeletonGrid cards={4} />}
      {query.isError && <ErrorState error={query.error} onRetry={() => void query.refetch()} />}
      {account && (
        <>
          <PaperCard className="inspector-hero">
            <div><p className="eyebrow">Network identity</p><h2>{account.username}</h2><p>{account.email}</p></div>
            <div className="passport-stamps"><Stamp tone="purple">{account.role}</Stamp><Stamp tone={account.accountStatus === 'ACTIVE' ? 'good' : 'bad'}>{account.accountStatus}</Stamp></div>
            <dl className="detail-grid">
              <div><dt>UID</dt><dd>{account.uid}</dd></div><div><dt>Friend code</dt><dd>{account.friendCode}</dd></div>
              <div><dt>Account ID</dt><dd>{shortId(account.id)}</dd></div><div><dt>Created</dt><dd>{formatDate(account.createdAt)}</dd></div>
              <div><dt>Presence</dt><dd>{sentenceCase(account.presence?.status)}</dd></div><div><dt>Last seen</dt><dd>{formatDate(account.presence?.lastSeenAt)}</dd></div>
            </dl>
            <Button variant={account.accountStatus === 'ACTIVE' ? 'danger' : 'secondary'} onClick={() => setDialog(account.accountStatus === 'ACTIVE' ? 'suspend' : 'restore')}>
              {account.accountStatus === 'ACTIVE' ? <ShieldAlert /> : <UserRoundCheck />}
              {account.accountStatus === 'ACTIVE' ? 'Suspend account' : 'Restore account'}
            </Button>
          </PaperCard>
          <div className="inspector-columns">
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Connected hardware</p><h2>Devices</h2></div><Laptop /></div>
              <div className="compact-list">
                {account.deviceSessions?.map((device) => (
                  <div key={device.id}><span><strong>{shortId(device.deviceId)}</strong><small>Used {formatDate(device.lastUsedAt)}</small></span><Stamp tone={device.revokedAt ? 'bad' : 'good'}>{device.revokedAt ? 'Revoked' : 'Active'}</Stamp>{!device.revokedAt && <Button variant="quiet" onClick={() => setDialog({ deviceId: device.id })}>Revoke</Button>}</div>
                ))}
              </div>
            </PaperCard>
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Published identities</p><h2>Companions</h2></div><UsersRound /></div>
              <div className="compact-list">
                {account.networkCompanions?.map((companion) => <div key={companion.id}><span><strong>{companion.name}</strong><small>{shortId(companion.id)}</small></span><Stamp tone={companion.published ? 'good' : 'neutral'}>{companion.published ? 'Published' : 'Private'}</Stamp></div>)}
              </div>
            </PaperCard>
          </div>
          <PaperCard><p className="eyebrow">Relationship counts</p><h2>Network footprint</h2><div className="count-grid">{Object.entries(account._count ?? {}).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{sentenceCase(label)}</span></div>)}</div></PaperCard>
        </>
      )}
      <ConfirmDialog
        open={Boolean(dialog)}
        title={typeof dialog === 'object' ? 'Revoke this device session?' : `${sentenceCase(dialog)} this account?`}
        description="This privileged action is written to the immutable audit log. Add a specific operational reason."
        confirmLabel={typeof dialog === 'object' ? 'Revoke device' : `${sentenceCase(dialog)} account`}
        destructive={dialog === 'suspend' || typeof dialog === 'object'}
        reason={reason}
        reasonRequired
        busy={mutation.isPending}
        onReasonChange={setReason}
        onCancel={() => { setDialog(null); setReason(''); }}
        onConfirm={() => mutation.mutate({ path: actionPath })}
      />
      {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
    </>
  );
}
