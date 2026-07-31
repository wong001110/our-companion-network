import { readFileSync } from 'node:fs';
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
    expect(source).toContain("audience: 'friends'");
    expect(source).toContain('A visitor/host/Companion route can reserve only one pending invitation');
    expect(source).toContain('VISIT_HOST_COMPANION_CHANGED');
    expect(source).toContain('topicOwnerCompanionId,');
    expect(source).toContain('topicTitle,');
  });
});
