from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:120]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


# Correct the Portal projections: invitations do not own host Companion snapshots;
# sessions do. User-facing relationship payloads expose stages and trends, while
# exact aggregate scores remain available only in the user's data export.
replace_once(
    'src/portal/portal.service.ts',
    '''const PORTAL_INVITATION_SELECT = {
  id: true,
  visitorOwnerUserId: true,
  hostUserId: true,
  hostNetworkCompanionId: true,
  networkCompanionId: true,''',
    '''const PORTAL_INVITATION_SELECT = {
  id: true,
  visitorOwnerUserId: true,
  hostUserId: true,
  networkCompanionId: true,''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''  visitorOwnerUserId: true,
  hostUserId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,
  state: true,''',
    '''  visitorOwnerUserId: true,
  hostUserId: true,
  hostNetworkCompanionId: true,
  networkCompanionId: true,
  assetPackSnapshotId: true,
  state: true,''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''  totalTurnCount: true,
  rapportScore: true,
  topicAffinityScore: true,
  sharedTopicTags: true,''',
    '''  totalTurnCount: true,
  sharedTopicTags: true,''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''} as const;

function relationshipPerspective<T extends {''',
    '''} as const;

const EXPORT_RELATIONSHIP_SELECT = {
  ...PORTAL_RELATIONSHIP_SELECT,
  rapportScore: true,
  topicAffinityScore: true,
} as const;

function relationshipPerspective<T extends {''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''        ...exportCursorPage(cursor),
        select: PORTAL_RELATIONSHIP_SELECT,
      }));
    yield ',"notifications":';''',
    '''        ...exportCursorPage(cursor),
        select: EXPORT_RELATIONSHIP_SELECT,
      }));
    yield ',"notifications":';''',
)

# Make Shared Moment creation idempotent under two devices finalizing at the same
# time. Only the transaction that actually inserts the moment updates the shared
# relationship aggregate.
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''  private async ensureMoment(tx: Prisma.TransactionClient, sessionId: string, turnCount: number, share: ShareRow): Promise<MomentRow> {
    const existing = await tx.$queryRaw<MomentRow[]>`
      SELECT "id", "sessionId", "title", "summary", "turnCount", "createdAt"
      FROM "VisitSharedMoment" WHERE "sessionId" = ${sessionId}
    `;
    if (existing[0]) return existing[0];
    const id = randomUUID();
    const title = `Shared: ${share.title}`.slice(0, 160);
    const summary = `The Companions shared “${share.title}” and exchanged ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}.`.slice(0, 600);
    const rows = await tx.$queryRaw<MomentRow[]>`
      INSERT INTO "VisitSharedMoment" ("id", "sessionId", "title", "summary", "turnCount", "createdAt")
      VALUES (${id}, ${sessionId}, ${title}, ${summary}, ${turnCount}, NOW())
      RETURNING "id", "sessionId", "title", "summary", "turnCount", "createdAt"
    `;
    await this.updateRelationship(tx, sessionId, turnCount, share);
    return rows[0];
  }''',
    '''  private async ensureMoment(tx: Prisma.TransactionClient, sessionId: string, turnCount: number, share: ShareRow): Promise<MomentRow> {
    const id = randomUUID();
    const title = `Shared: ${share.title}`.slice(0, 160);
    const summary = `The Companions shared “${share.title}” and exchanged ${turnCount} ${turnCount === 1 ? 'turn' : 'turns'}.`.slice(0, 600);
    const inserted = await tx.$queryRaw<MomentRow[]>`
      INSERT INTO "VisitSharedMoment" ("id", "sessionId", "title", "summary", "turnCount", "createdAt")
      VALUES (${id}, ${sessionId}, ${title}, ${summary}, ${turnCount}, NOW())
      ON CONFLICT ("sessionId") DO NOTHING
      RETURNING "id", "sessionId", "title", "summary", "turnCount", "createdAt"
    `;
    if (inserted[0]) {
      await this.updateRelationship(tx, sessionId, turnCount, share);
      return inserted[0];
    }
    const existing = await tx.$queryRaw<MomentRow[]>`
      SELECT "id", "sessionId", "title", "summary", "turnCount", "createdAt"
      FROM "VisitSharedMoment" WHERE "sessionId" = ${sessionId}
    `;
    if (!existing[0]) throw new ConflictException({ code: 'VISIT_SHARED_MOMENT_RACE', message: 'The Shared Moment could not be reconciled' });
    return existing[0];
  }''',
)
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''    const relationshipId = randomUUID();
    await tx.$executeRaw`''',
    '''    const relationshipId = randomUUID();
    const tagArray = tags.length
      ? Prisma.sql`ARRAY[${Prisma.join(tags)}]::text[]`
      : Prisma.sql`ARRAY[]::text[]`;
    await tx.$executeRaw`''',
)
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''        ${turnCount}, 0.08, 0.05, ${tags}::text[], NOW(), NOW(), NOW(), NOW()''',
    '''        ${turnCount}, 0.08, 0.05, ${tagArray}, NOW(), NOW(), NOW(), NOW()''',
)

# Regression contracts for the two review findings.
replace_once(
    'src/portal/portal.service.spec.ts',
    "import { Readable } from 'node:stream';",
    "import { Readable } from 'node:stream';\nimport { readFileSync } from 'node:fs';\nimport { join } from 'node:path';",
)
portal_test = Path('src/portal/portal.service.spec.ts')
portal_source = portal_test.read_text(encoding='utf-8')
marker = "describe('PortalService security projections', () => {"
addition = '''
  it('keeps host Companion snapshots on sessions and hides raw relationship scores from Portal projections', () => {
    const source = readFileSync(join(__dirname, 'portal.service.ts'), 'utf8');
    const invitation = source.slice(source.indexOf('const PORTAL_INVITATION_SELECT'), source.indexOf('const PORTAL_SESSION_SELECT'));
    const relationship = source.slice(source.indexOf('const PORTAL_RELATIONSHIP_SELECT'), source.indexOf('const EXPORT_RELATIONSHIP_SELECT'));
    expect(invitation).not.toContain('hostNetworkCompanionId');
    expect(source.slice(source.indexOf('const PORTAL_SESSION_SELECT'), source.indexOf('const PORTAL_SESSION_DETAIL_SELECT'))).toContain('hostNetworkCompanionId');
    expect(relationship).not.toContain('rapportScore');
    expect(relationship).not.toContain('topicAffinityScore');
  });
'''
if addition.strip() not in portal_source:
    if marker not in portal_source:
        raise SystemExit('PortalService test suite anchor not found')
    portal_test.write_text(portal_source.replace(marker, marker + addition, 1), encoding='utf-8')

replace_once(
    'src/visit-social/visit-social.service.spec.ts',
    "import { VisitSocialService } from './visit-social.service';",
    "import { VisitSocialService } from './visit-social.service';\nimport { readFileSync } from 'node:fs';\nimport { join } from 'node:path';",
)
social_test = Path('src/visit-social/visit-social.service.spec.ts')
social_source = social_test.read_text(encoding='utf-8')
social_marker = "describe('VisitSocialService security boundaries', () => {"
social_addition = '''
  it('uses an insert-winner Shared Moment contract before updating relationships', () => {
    const source = readFileSync(join(__dirname, 'visit-social.service.ts'), 'utf8');
    expect(source).toContain('ON CONFLICT ("sessionId") DO NOTHING');
    expect(source).toContain('if (inserted[0])');
    expect(source.indexOf('if (inserted[0])')).toBeLessThan(source.indexOf('await this.updateRelationship'));
    expect(source).toContain('Prisma.join(tags)');
  });
'''
if social_addition.strip() not in social_source:
    if social_marker not in social_source:
        raise SystemExit('VisitSocialService test suite anchor not found')
    social_test.write_text(social_source.replace(social_marker, social_marker + social_addition, 1), encoding='utf-8')
