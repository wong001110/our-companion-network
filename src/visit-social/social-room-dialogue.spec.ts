import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('Social Room dialogue and settlement contract', () => {
  const source = readFileSync(join(__dirname, 'visit-social.service.ts'), 'utf8');
  const schema = readFileSync(join(__dirname, '../../prisma/schema.prisma'), 'utf8');

  it('uses round-robin active Room participants and a 15-turn room cap', () => {
    expect(source).toContain('const ROOM_MAX_TURNS = 15');
    expect(source).toContain('participants[(index < 0 ? 0 : index + 1) % participants.length]');
    expect(source).toContain("state: 'active'");
  });

  it('completes the current topic before activating the queued Guest topic', () => {
    expect(source).toContain("state: 'completed'");
    expect(source).toContain("state: 'queued'");
    expect(source).toContain("state: 'active', startedAt");
    expect(source).toContain('currentTopicSequence: activated.sequence');
    expect(source).toContain('topicSwitched: true');
  });

  it('settles each Companion pair once only when the Room Shared Moment wins insertion', () => {
    expect(schema).toContain('model VisitRelationshipSettlement');
    expect(schema).toContain('@@unique([sessionId, companionLowId, companionHighId], map: "VisitRelSettlement_session_low_high_key")');
    expect(source).toContain('ON CONFLICT ("sessionId", "companionLowId", "companionHighId") DO NOTHING');
    expect(source).toContain('if (inserted[0])');
    expect(source).toContain('await this.updateRelationshipPair');
  });
});
