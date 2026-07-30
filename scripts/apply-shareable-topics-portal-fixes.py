from pathlib import Path

panel = Path('portal/src/features/companion/ShareableTopicsPanel.tsx')
source = panel.read_text(encoding='utf-8')
old = "const emptyDraft = { title: '', summary: '', tags: '', sourceUrl: '', eligibleForRandomVisit: false, allowRecipientSave: false, shareScope: 'summary_only' as const };"
new = """type TopicDraft = {
  title: string;
  summary: string;
  tags: string;
  sourceUrl: string;
  eligibleForRandomVisit: boolean;
  allowRecipientSave: boolean;
  shareScope: 'summary_only' | 'summary_and_source';
};

const emptyDraft: TopicDraft = { title: '', summary: '', tags: '', sourceUrl: '', eligibleForRandomVisit: false, allowRecipientSave: false, shareScope: 'summary_only' };"""
if old not in source:
    raise SystemExit('Shareable Topics draft type anchor not found')
source = source.replace(old, new, 1)
source = source.replace("event.target.value as typeof draft.shareScope", "event.target.value as TopicDraft['shareScope']")
panel.write_text(source, encoding='utf-8')

regression = Path('portal/src/pages/portal-regressions.test.tsx')
source = regression.read_text(encoding='utf-8')
old = """    published: options.published ?? false,
    isActive: options.active ?? false,"""
new = """    published: options.published ?? false,
    randomVisitsEnabled: false,
    randomVisitAudience: 'friends',
    allowJoinRequests: true,
    isActive: options.active ?? false,"""
if old not in source:
    raise SystemExit('Portal Companion regression fixture anchor not found')
regression.write_text(source.replace(old, new, 1), encoding='utf-8')
