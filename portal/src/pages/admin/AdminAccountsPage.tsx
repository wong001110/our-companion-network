import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'react-router-dom';
import {
  Bell,
  CalendarClock,
  Laptop,
  PackageOpen,
  ScrollText,
  ShieldAlert,
  UserRoundCheck,
  UsersRound,
} from 'lucide-react';
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
  assetPacks?: {
    total: number;
    truncated: boolean;
    items: AccountAssetPack[];
  };
  friends?: AccountRelationship[];
  blockedRelationships?: {
    outgoing: AccountRelationship[];
    incoming: AccountRelationship[];
  };
  visitInvitations?: {
    asVisitorOwner: AccountInvitation[];
    asHost: AccountInvitation[];
  };
  visitSessions?: {
    asVisitorOwner: AccountSession[];
    asHost: AccountSession[];
  };
  notifications?: {
    summary: { total: number; unread: number };
    recent: Array<{
      id: string;
      type: string;
      title: string;
      message: string;
      read: boolean;
      createdAt: string;
    }>;
  };
  auditRelatedEvents?: Array<{
    id: string;
    adminUserId: string;
    action: string;
    targetType: string;
    targetId: string | null;
    reason: string | null;
    createdAt: string;
  }>;
  detailLimit?: number;
  _count?: Record<string, number>;
}

interface RelatedAccount {
  id: string;
  uid: string;
  username: string;
  friendCode: string;
  profile: { displayName: string | null; avatarUrl: string | null } | null;
  presence: { status: string; lastSeenAt: string | null } | null;
}

interface AccountRelationship {
  id: string;
  createdAt: string;
  user: RelatedAccount;
}

interface AccountInvitation {
  id: string;
  visitorOwnerUserId: string;
  hostUserId: string;
  companionName: string;
  status: string;
  expiresAt: string;
  updatedAt: string;
}

interface AccountSession {
  id: string;
  visitorOwnerUserId: string;
  hostUserId: string;
  state: string;
  startedAt: string | null;
  endedAt: string | null;
  updatedAt: string;
}

interface AccountAssetPack {
  id: string;
  companionId: string;
  manifestHash: string;
  schemaVersion: number;
  status: string;
  totalFiles: number;
  totalBytes: number;
  failureCode: string | null;
  createdAt: string;
  updatedAt: string;
  companion: {
    id: string;
    name: string;
    published: boolean;
  };
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
  const invitations = account ? [
    ...(account.visitInvitations?.asVisitorOwner ?? []).map((item) => ({ ...item, role: 'Visitor owner' })),
    ...(account.visitInvitations?.asHost ?? []).map((item) => ({ ...item, role: 'Host' })),
  ] : [];
  const sessions = account ? [
    ...(account.visitSessions?.asVisitorOwner ?? []).map((item) => ({ ...item, role: 'Visitor owner' })),
    ...(account.visitSessions?.asHost ?? []).map((item) => ({ ...item, role: 'Host' })),
  ] : [];
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
          <PaperCard>
            <div className="section-heading">
              <div>
                <p className="eyebrow">Bounded safe metadata</p>
                <h2>Asset Packs</h2>
              </div>
              <PackageOpen />
            </div>
            <p>
              Showing {account.assetPacks?.items.length ?? 0} of {account.assetPacks?.total ?? 0} packs.
              {account.assetPacks?.truncated ? ` Only the latest ${account.detailLimit ?? 50} are shown.` : ''}
            </p>
            <div className="compact-list">
              {account.assetPacks?.items.map((pack) => (
                <div key={pack.id}>
                  <span>
                    <strong>{pack.companion.name}</strong>
                    <small>
                      {shortId(pack.id)} · Schema {pack.schemaVersion} · {pack.totalFiles} files · {pack.totalBytes.toLocaleString()} bytes
                      {pack.failureCode ? ` · ${sentenceCase(pack.failureCode)}` : ''}
                    </small>
                  </span>
                  <Stamp tone={pack.status === 'active' ? 'good' : pack.status === 'failed' ? 'bad' : 'neutral'}>
                    {sentenceCase(pack.status)}
                  </Stamp>
                </div>
              ))}
              {!account.assetPacks?.items.length && <p className="muted">No Asset Pack rows.</p>}
            </div>
          </PaperCard>
          <div className="inspector-columns">
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Actual relationships</p><h2>Friends</h2></div><UsersRound /></div>
              <div className="compact-list">
                {account.friends?.map((relationship) => <RelatedAccountRow key={relationship.id} relationship={relationship} />)}
                {!account.friends?.length && <p className="muted">No friendship rows.</p>}
              </div>
            </PaperCard>
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Safety boundaries</p><h2>Blocked relationships</h2></div><ShieldAlert /></div>
              <div className="compact-list">
                {account.blockedRelationships?.outgoing.map((relationship) => <RelatedAccountRow key={`out-${relationship.id}`} relationship={relationship} label="Blocked by this account" />)}
                {account.blockedRelationships?.incoming.map((relationship) => <RelatedAccountRow key={`in-${relationship.id}`} relationship={relationship} label="Blocked this account" />)}
                {!account.blockedRelationships?.outgoing.length && !account.blockedRelationships?.incoming.length && <p className="muted">No blocked relationships.</p>}
              </div>
            </PaperCard>
          </div>
          <div className="inspector-columns">
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Recent invitations</p><h2>Visit invitations</h2></div><CalendarClock /></div>
              <div className="compact-list">
                {invitations.map((invitation) => (
                  <div key={`${invitation.role}-${invitation.id}`}>
                    <span><strong>{invitation.companionName}</strong><small>{invitation.role} · Updated {formatDate(invitation.updatedAt)}</small></span>
                    <Stamp tone={invitation.status === 'pending' ? 'warn' : 'neutral'}>{sentenceCase(invitation.status)}</Stamp>
                  </div>
                ))}
                {!invitations.length && <p className="muted">No invitation rows.</p>}
              </div>
            </PaperCard>
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Recent sessions</p><h2>Visit sessions</h2></div><CalendarClock /></div>
              <div className="compact-list">
                {sessions.map((session) => (
                  <div key={`${session.role}-${session.id}`}>
                    <span><strong>{shortId(session.id)}</strong><small>{session.role} · Updated {formatDate(session.updatedAt)}</small></span>
                    <Stamp tone={session.state === 'active' ? 'good' : 'neutral'}>{sentenceCase(session.state)}</Stamp>
                  </div>
                ))}
                {!sessions.length && <p className="muted">No session rows.</p>}
              </div>
            </PaperCard>
          </div>
          <div className="inspector-columns">
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Safe recent rows</p><h2>Notifications</h2></div><Bell /></div>
              <p>{account.notifications?.summary.unread ?? 0} unread of {account.notifications?.summary.total ?? 0} total</p>
              <div className="compact-list">
                {account.notifications?.recent.map((notification) => (
                  <div key={notification.id}>
                    <span><strong>{notification.title}</strong><small>{notification.message} · {formatDate(notification.createdAt)}</small></span>
                    <Stamp tone={notification.read ? 'neutral' : 'purple'}>{notification.read ? 'Read' : 'Unread'}</Stamp>
                  </div>
                ))}
                {!account.notifications?.recent.length && <p className="muted">No notification rows.</p>}
              </div>
            </PaperCard>
            <PaperCard>
              <div className="section-heading"><div><p className="eyebrow">Privileged history</p><h2>Audit-related events</h2></div><ScrollText /></div>
              <div className="compact-list">
                {account.auditRelatedEvents?.map((event) => (
                  <div key={event.id}>
                    <span><strong>{sentenceCase(event.action)}</strong><small>{event.targetType} · {formatDate(event.createdAt)}{event.reason ? ` · ${event.reason}` : ''}</small></span>
                    <Stamp tone="purple">{shortId(event.adminUserId)}</Stamp>
                  </div>
                ))}
                {!account.auditRelatedEvents?.length && <p className="muted">No related audit rows.</p>}
              </div>
            </PaperCard>
          </div>
          <PaperCard><p className="eyebrow">Relationship counts</p><h2>Network footprint</h2><div className="count-grid">{Object.entries(account._count ?? {}).map(([label, value]) => <div key={label}><strong>{value}</strong><span>{sentenceCase(label)}</span></div>)}</div></PaperCard>
          <p className="muted">Detailed collections show at most {account.detailLimit ?? 50} recent rows per role.</p>
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

function RelatedAccountRow({ relationship, label }: { relationship: AccountRelationship; label?: string }) {
  const person = relationship.user;
  return (
    <div>
      <span>
        <strong>{person.profile?.displayName || person.username}</strong>
        <small>{person.uid} · {label || `Friends since ${formatDate(relationship.createdAt, { dateStyle: 'medium' })}`}</small>
      </span>
      <Stamp tone={person.presence?.status === 'online' ? 'good' : 'neutral'}>{sentenceCase(person.presence?.status || 'offline')}</Stamp>
    </div>
  );
}
