import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import {
  Archive,
  Cloud,
  Download,
  HardDrive,
  KeyRound,
  MessageCircle,
  ShieldOff,
  Trash2,
} from 'lucide-react';
import { api, jsonBody } from '../lib/api';
import {
  Button,
  ConfirmDialog,
  PageHeader,
  PaperCard,
  Stamp,
} from '../components/ui';

const stored = [
  'Account', 'Profile', 'Friends', 'Presence', 'Network Companion',
  'Asset Packs', 'Visit Invitations', 'Visit Sessions', 'Notifications',
  'Shared Discoveries', 'Device Sessions',
];

const neverStored = [
  'Local Chat', 'Local Memory', 'Local API Keys', 'Local private Discovery',
  'Desktop activity history',
];

type DataAction = 'notifications' | 'discoveries' | 'packs' | 'account';

export function DataPage() {
  const [action, setAction] = useState<DataAction | null>(null);
  const [confirmation, setConfirmation] = useState('');
  const [notice, setNotice] = useState('');
  const mutation = useMutation({
    mutationFn: async (value: DataAction) => {
      if (value === 'account') {
        return api('/api/portal/account', {
          method: 'DELETE',
          ...jsonBody({ confirmation }),
        });
      }
      return api(`/api/portal/data/${value}`, {
        method: 'DELETE',
        ...jsonBody({ confirmation }),
      });
    },
    onSuccess: (_, value) => {
      setAction(null);
      setConfirmation('');
      setNotice(value === 'account'
        ? 'Account deletion has been accepted.'
        : `${labels[value]} were deleted.`);
    },
  });

  async function downloadExport() {
    setNotice('');
    try {
      const data = await api<Record<string, unknown>>('/api/portal/data-export');
      const url = URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }));
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = `our-companion-network-export-${new Date().toISOString().slice(0, 10)}.json`;
      anchor.click();
      URL.revokeObjectURL(url);
      setNotice('Your private Network export was downloaded.');
    } catch (error) {
      setNotice(error instanceof Error ? error.message : 'The export could not be prepared.');
    }
  }

  const expected = action === 'account' ? 'DELETE MY ACCOUNT' : 'DELETE';
  return (
    <>
      <PageHeader
        eyebrow="My Network · Privacy"
        title="My Data"
        description="A plain-language map of what the Network keeps, what always stays on your device, and the controls to take your data with you."
        actions={<Button onClick={() => void downloadExport()}><Download /> Download My Network Data</Button>}
      />
      {notice && <div className="success-banner" role="status"><Cloud />{notice}</div>}
      <div className="data-boundary">
        <PaperCard className="data-card data-card--stored">
          <Cloud aria-hidden="true" />
          <p className="eyebrow">In the Network</p>
          <h2>Saved for social features</h2>
          <p>These categories make friendships, visits, security, and publishing work.</p>
          <ul>{stored.map((item) => <li key={item}>{item}<Stamp tone="purple">Network</Stamp></li>)}</ul>
        </PaperCard>
        <PaperCard className="data-card data-card--local">
          <HardDrive aria-hidden="true" />
          <p className="eyebrow">Only on your devices</p>
          <h2>Never saved by Network</h2>
          <p>Your most personal companion life does not cross this boundary.</p>
          <ul>{neverStored.map((item) => <li key={item}>{item}<Stamp tone="good">Local only</Stamp></li>)}</ul>
        </PaperCard>
      </div>
      <div className="section-title">
        <div><p className="eyebrow">Tidy up</p><h2>Data controls</h2></div>
        <Archive aria-hidden="true" />
      </div>
      <div className="data-actions">
        <DataAction icon={MessageCircle} title="Notifications" description="Delete Network notification records after you have read them." onClick={() => setAction('notifications')} />
        <DataAction icon={Cloud} title="Shared Discoveries" description="Delete discoveries you intentionally shared to the Network." onClick={() => setAction('discoveries')} />
        <DataAction icon={Archive} title="Superseded Asset Packs" description="Remove eligible older packs after active visit references are checked." onClick={() => setAction('packs')} />
      </div>
      <PaperCard className="danger-zone">
        <ShieldOff aria-hidden="true" />
        <div>
          <p className="eyebrow">Permanent departure</p>
          <h2>Delete Network Account</h2>
          <p>Removes your Network identity and social data. Your local companion data is not erased from your devices.</p>
        </div>
        <Button variant="danger" onClick={() => setAction('account')}><Trash2 /> Delete account</Button>
      </PaperCard>
      <ConfirmDialog
        open={Boolean(action)}
        title={action === 'account' ? 'Delete your Network Account?' : `Delete ${action ? labels[action] : 'data'}?`}
        description={`This is a destructive action. Type “${expected}” below to confirm exactly what will be removed.`}
        confirmLabel={action === 'account' ? 'Delete my account' : 'Delete selected data'}
        destructive
        reason={confirmation}
        reasonLabel={`Type ${expected}`}
        reasonRequired
        reasonValidator={(value) => value === expected}
        reasonError={`Type ${expected} exactly to continue.`}
        busy={mutation.isPending}
        onReasonChange={setConfirmation}
        onCancel={() => { setAction(null); setConfirmation(''); }}
        onConfirm={() => {
          if (action && confirmation === expected) mutation.mutate(action);
        }}
      />
      {mutation.isError && <p className="inline-error" role="alert">{mutation.error.message}</p>}
      <p className="privacy-footnote"><KeyRound />Exports and deletions are always scoped to the signed-in Network Account.</p>
    </>
  );
}

const labels: Record<DataAction, string> = {
  notifications: 'notifications',
  discoveries: 'shared discoveries',
  packs: 'superseded asset packs',
  account: 'account data',
};

function DataAction({
  icon: Icon,
  title,
  description,
  onClick,
}: {
  icon: typeof Archive;
  title: string;
  description: string;
  onClick(): void;
}) {
  return (
    <PaperCard>
      <Icon aria-hidden="true" />
      <h3>{title}</h3>
      <p>{description}</p>
      <Button variant="quiet" onClick={onClick}>Review deletion</Button>
    </PaperCard>
  );
}
