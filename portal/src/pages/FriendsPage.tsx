import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Ban, Copy, Heart, MailQuestion, Search, Send, UserMinus, UserRoundPlus } from 'lucide-react';
import { useAuth } from '../features/auth/AuthProvider';
import { api, jsonBody, type PageEnvelope } from '../lib/api';
import { formatDate, sentenceCase } from '../lib/format';
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

type Tab = 'friends' | 'incoming' | 'outgoing' | 'blocked';

interface Friend {
  id: string;
  uid: string;
  username: string;
  friendCode?: string;
  createdAt?: string;
  profile?: { displayName?: string | null; avatarUrl?: string | null } | null;
  presence?: { status: string; lastSeenAt: string | null } | null;
  hasPublishedCompanion?: boolean;
}

interface FriendRequest {
  id: string;
  status: string;
  createdAt: string;
  sender?: Friend;
  receiver?: Friend;
}

interface BlockedRow {
  id: string;
  createdAt: string;
  user: Friend;
}

interface LookupResult extends Friend {
  relationship: string;
}

export function FriendsPage() {
  const { user } = useAuth();
  const [tab, setTab] = useState<Tab>('friends');
  const [page, setPage] = useState(1);
  const [listSearch, setListSearch] = useState('');
  const [friendCode, setFriendCode] = useState('');
  const [lookup, setLookup] = useState<LookupResult | null>(null);
  const [lookupError, setLookupError] = useState('');
  const queryClient = useQueryClient();
  const endpoint = tab === 'friends'
    ? `/api/portal/friends?search=${encodeURIComponent(listSearch)}`
    : tab === 'blocked'
      ? `/api/portal/blocks?search=${encodeURIComponent(listSearch)}`
      : `/api/portal/friend-requests?direction=${tab}&status=pending&search=${encodeURIComponent(listSearch)}`;
  const list = useQuery({
    queryKey: ['friends', tab, page, listSearch],
    queryFn: () => api<PageEnvelope<Friend | FriendRequest | BlockedRow>>(
      `${endpoint}${endpoint.includes('?') ? '&' : '?'}page=${page}&limit=12`,
    ),
  });
  const mutate = useMutation({
    mutationFn: ({ path, method = 'POST', body }: { path: string; method?: string; body?: unknown }) =>
      api(path, { method, ...(body ? jsonBody(body) : {}) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['friends'] });
      void queryClient.invalidateQueries({ queryKey: ['portal-summary'] });
      setLookup(null);
    },
  });

  async function findFriend() {
    setLookupError('');
    setLookup(null);
    try {
      setLookup(await api<LookupResult>(`/api/friends/lookup/${encodeURIComponent(friendCode.trim())}`));
    } catch (error) {
      setLookupError(error instanceof Error ? error.message : 'Friend code was not found.');
    }
  }

  return (
    <>
      <PageHeader
        eyebrow="My Network · Connections"
        title="Friends"
        description="A friendly address book for requests, companions available to visit, and the boundaries you have chosen."
        actions={
          <button
            className="friend-code"
            onClick={() => void navigator.clipboard.writeText(user?.friendCode ?? '')}
            aria-label="Copy friend code"
          >
            <span>Your friend code</span>
            <strong>{user?.friendCode}</strong>
            <Copy aria-hidden="true" />
          </button>
        }
      />
      <PaperCard className="find-friend">
        <div>
          <UserRoundPlus aria-hidden="true" />
          <div><h2>Invite a familiar face</h2><p>Enter their eight-character friend code.</p></div>
        </div>
        <div className="inline-form">
          <label className="sr-only" htmlFor="friend-code">Friend code</label>
          <input
            id="friend-code"
            value={friendCode}
            maxLength={8}
            placeholder="AB12CD34"
            onChange={(event) => setFriendCode(event.target.value.toUpperCase())}
          />
          <Button onClick={() => void findFriend()} disabled={friendCode.trim().length !== 8}>
            <Search aria-hidden="true" /> Find
          </Button>
        </div>
        {lookupError && <p className="inline-error" role="alert">{lookupError}</p>}
        {lookup && (
          <div className="lookup-result">
            <Avatar friend={lookup} />
            <div><strong>{lookup.profile?.displayName || lookup.username}</strong><small>{lookup.uid}</small></div>
            <Stamp tone="purple">{sentenceCase(lookup.relationship)}</Stamp>
            {lookup.relationship === 'none' && (
              <Button
                variant="secondary"
                onClick={() => mutate.mutate({
                  path: '/api/friends/requests',
                  body: { receiverId: lookup.id },
                })}
              >
                <Send aria-hidden="true" /> Send request
              </Button>
            )}
          </div>
        )}
      </PaperCard>
      <div className="tab-list" role="tablist" aria-label="Friend views">
        {([
          ['friends', Heart, 'Friends'],
          ['incoming', MailQuestion, 'Incoming'],
          ['outgoing', Send, 'Outgoing'],
          ['blocked', Ban, 'Blocked'],
        ] as const).map(([value, Icon, label]) => (
          <button
            role="tab"
            aria-selected={tab === value}
            key={value}
            onClick={() => { setTab(value); setPage(1); }}
          >
            <Icon aria-hidden="true" />{label}
          </button>
        ))}
      </div>
      <div className="inline-form">
        <label className="sr-only" htmlFor="friend-list-search">Search this friend list</label>
        <input
          id="friend-list-search"
          value={listSearch}
          maxLength={100}
          placeholder={`Search ${tab}`}
          onChange={(event) => {
            setListSearch(event.target.value);
            setPage(1);
          }}
        />
        <Search aria-hidden="true" />
      </div>
      {list.isLoading && <SkeletonGrid cards={4} />}
      {list.isError && <ErrorState error={list.error} onRetry={() => void list.refetch()} />}
      {list.data?.items.length === 0 && (
        <EmptyState title={tab === 'friends' ? 'A fresh address book' : `No ${tab} entries`}>
          {tab === 'friends' ? 'Share your friend code or look up someone you know.' : 'Nothing needs your attention here.'}
        </EmptyState>
      )}
      <div className="people-list">
        {list.data?.items.map((item) => (
          <FriendRow
            key={item.id}
            tab={tab}
            item={item}
            onAction={(path, method, body) => mutate.mutate({ path, method, body })}
          />
        ))}
      </div>
      {mutate.isError && <p className="inline-error" role="alert">{mutate.error.message}</p>}
      {list.data && <Pagination {...list.data.pagination} onPage={setPage} />}
    </>
  );
}

function FriendRow({
  tab,
  item,
  onAction,
}: {
  tab: Tab;
  item: Friend | FriendRequest | BlockedRow;
  onAction(path: string, method?: string, body?: unknown): void;
}) {
  const request = item as FriendRequest;
  const block = item as BlockedRow;
  const friend = tab === 'incoming'
    ? request.sender!
    : tab === 'outgoing'
      ? request.receiver!
      : tab === 'blocked'
        ? block.user
        : item as Friend;
  return (
    <PaperCard className="person-row">
      <Avatar friend={friend} />
      <div className="person-main">
        <strong>{friend.profile?.displayName || friend.username}</strong>
        <small>{friend.uid} {friend.presence && `· ${sentenceCase(friend.presence.status)}`}</small>
      </div>
      {friend.hasPublishedCompanion && <Stamp tone="good">Companion available</Stamp>}
      {tab === 'incoming' && (
        <div className="row-actions">
          <Button variant="secondary" onClick={() => onAction(`/api/friends/requests/${item.id}/reject`)}>Decline</Button>
          <Button onClick={() => onAction(`/api/friends/requests/${item.id}/accept`)}>Accept</Button>
        </div>
      )}
      {tab === 'outgoing' && (
        <Button variant="quiet" onClick={() => onAction(`/api/friends/requests/${item.id}/cancel`)}>Cancel request</Button>
      )}
      {tab === 'blocked' && (
        <Button variant="quiet" onClick={() => onAction(`/api/blocks/${friend.id}`, 'DELETE')}>Unblock</Button>
      )}
      {tab === 'friends' && (
        <>
          <small>Friends since {formatDate((item as Friend).createdAt, { dateStyle: 'medium' })}</small>
          <div className="row-actions">
            <Button variant="quiet" onClick={() => onAction(`/api/friends/${friend.id}`, 'DELETE')}>
              <UserMinus aria-hidden="true" /> Remove
            </Button>
            <Button variant="danger" onClick={() => onAction('/api/blocks', 'POST', { userId: friend.id })}>
              <Ban aria-hidden="true" /> Block
            </Button>
          </div>
        </>
      )}
    </PaperCard>
  );
}

function Avatar({ friend }: { friend: Friend }) {
  return friend.profile?.avatarUrl
    ? <img className="avatar" src={friend.profile.avatarUrl} alt="" />
    : <span className="avatar avatar--letter">{(friend.profile?.displayName || friend.username).slice(0, 1).toUpperCase()}</span>;
}
