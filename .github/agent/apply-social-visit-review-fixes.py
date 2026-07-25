from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    target = Path(path)
    text = target.read_text(encoding='utf-8')
    if new in text:
        return
    if old not in text:
        raise SystemExit(f'Patch anchor not found in {path}: {old[:120]!r}')
    target.write_text(text.replace(old, new, 1), encoding='utf-8')


replace_once(
    'src/visit-social/visit-social.service.ts',
    '''  assertNextVisitTurn,
  sanitizeVisitShareEnvelope,''',
    '''  assertNextVisitTurn,
  assertSharedMomentEligible,
  sanitizeVisitShareEnvelope,''',
)
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''      if (!['ended', 'cancelled', 'failed'].includes(session.state)) {
        throw new ConflictException({ code: 'VISIT_SESSION_NOT_TERMINAL', message: 'The Visit must end before creating a Shared Moment' });
      }''',
    '''      if (session.state !== 'ended') {
        throw new ConflictException({ code: 'VISIT_SESSION_NOT_COMPLETED', message: 'Only a completed Visit can create a Shared Moment' });
      }''',
)
replace_once(
    'src/visit-social/visit-social.service.ts',
    '''      return this.ensureMoment(tx, sessionId, Number(countRows[0]?.count ?? 0n), shareRows[0]);''',
    '''      const turnCount = Number(countRows[0]?.count ?? 0n);
      try {
        assertSharedMomentEligible(session.state, turnCount);
      } catch (error) {
        const code = error instanceof Error ? error.message : 'VISIT_SHARED_MOMENT_INVALID';
        throw new ConflictException({ code, message: 'The Shared Moment was rejected' });
      }
      return this.ensureMoment(tx, sessionId, turnCount, shareRows[0]);''',
)

replace_once(
    'prisma/schema.prisma',
    '''  visitSessionsHosted VisitSession[] @relation("VisitSessionHost")
  debugEvents       DeveloperDebugEvent[]''',
    '''  visitSessionsHosted VisitSession[] @relation("VisitSessionHost")
  visitShareEnvelopesCreated VisitShareEnvelope[] @relation("VisitShareEnvelopeCreator")
  visitTurnsSent VisitTurn[] @relation("VisitTurnSender")
  debugEvents       DeveloperDebugEvent[]''',
)
replace_once(
    'prisma/schema.prisma',
    '''  updatedAt            DateTime @updatedAt

  @@index([visitorOwnerUserId, state])''',
    '''  updatedAt            DateTime @updatedAt
  socialShare          VisitShareEnvelope?
  socialTurns          VisitTurn[]
  sharedMoment         VisitSharedMoment?

  @@index([visitorOwnerUserId, state])''',
)
replace_once(
    'prisma/schema.prisma',
    '''model AdminAuditLog {''',
    '''model VisitShareEnvelope {
  id              String   @id @default(uuid())
  sessionId       String   @unique
  session         VisitSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  title           String   @db.VarChar(120)
  summary         String   @db.VarChar(600)
  tags            Json     @default("[]")
  sourceUrl       String?  @db.VarChar(2000)
  createdByUserId String
  createdBy       User     @relation("VisitShareEnvelopeCreator", fields: [createdByUserId], references: [id], onDelete: Restrict)
  createdAt       DateTime @default(now())

  @@index([createdByUserId])
}

model VisitTurn {
  id           String   @id @default(uuid())
  sessionId    String
  session      VisitSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  sequence     Int
  clientTurnId String
  senderUserId String
  sender       User     @relation("VisitTurnSender", fields: [senderUserId], references: [id], onDelete: Restrict)
  intent       String   @db.VarChar(40)
  message      String   @db.VarChar(800)
  emotion      String?  @db.VarChar(40)
  topic        String?  @db.VarChar(80)
  createdAt    DateTime @default(now())

  @@unique([sessionId, sequence])
  @@unique([sessionId, clientTurnId])
  @@index([sessionId, createdAt])
}

model VisitSharedMoment {
  id        String   @id @default(uuid())
  sessionId String   @unique
  session   VisitSession @relation(fields: [sessionId], references: [id], onDelete: Cascade)
  title     String   @db.VarChar(160)
  summary   String   @db.VarChar(600)
  turnCount Int
  createdAt DateTime @default(now())
}

model AdminAuditLog {''',
)

Path('.github/agent/apply-social-visit-review-fixes.py').unlink(missing_ok=True)
Path('.github/workflows/apply-social-visit-review-fixes.yml').unlink(missing_ok=True)
