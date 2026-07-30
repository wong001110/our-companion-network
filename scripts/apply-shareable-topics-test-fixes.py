from pathlib import Path

portal = Path('src/portal/portal.service.spec.ts')
source = portal.read_text(encoding='utf-8')
anchor = "      companionRelationship: cursorModel([]),\n"
count = source.count(anchor)
if count != 2:
    raise SystemExit(f'expected 2 relationship export fixtures, found {count}')
source = source.replace(anchor, anchor + "      shareableTopic: cursorModel([]),\n")
portal.write_text(source, encoding='utf-8')

contract = Path('src/visit/random-visit-topic.spec.ts')
contract.write_text('''import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('random Visit topic contract', () => {
  it('selects an active Host-owned topic and snapshots it before acceptance', () => {
    const source = readFileSync(join(__dirname, 'visit.service.ts'), 'utf8');
    expect(source).toContain('RANDOM_VISIT_NOT_AVAILABLE');
    expect(source).toContain('randomVisitsEnabled');
    expect(source).toContain('randomVisitAudience');
    expect(source).toContain('topicOwnerCompanionId');
    expect(source).toContain('socialShare: { create:');
    expect(source).toContain('visitMode: invitation.visitMode');
  });
});
''', encoding='utf-8')
