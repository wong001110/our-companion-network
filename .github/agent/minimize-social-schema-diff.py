from pathlib import Path
import subprocess


def replace_once(text: str, old: str, new: str) -> str:
    if old not in text:
        raise SystemExit(f'Schema anchor not found: {old[:100]!r}')
    return text.replace(old, new, 1)


schema = subprocess.check_output(
    ['git', 'show', 'origin/main:prisma/schema.prisma'],
    text=True,
    encoding='utf-8',
)
schema = replace_once(
    schema,
    '''  visitSessionsHosted VisitSession[] @relation("VisitSessionHost")
  debugEvents       DeveloperDebugEvent[]''',
    '''  visitSessionsHosted VisitSession[] @relation("VisitSessionHost")
  visitShareEnvelopesCreated VisitShareEnvelope[] @relation("VisitShareEnvelopeCreator")
  visitTurnsSent VisitTurn[] @relation("VisitTurnSender")
  debugEvents       DeveloperDebugEvent[]''',
)
schema = replace_once(
    schema,
    '''  updatedAt            DateTime @updatedAt

  @@index([visitorOwnerUserId, state])''',
    '''  updatedAt            DateTime @updatedAt
  socialShare          VisitShareEnvelope?
  socialTurns          VisitTurn[]
  sharedMoment         VisitSharedMoment?

  @@index([visitorOwnerUserId, state])''',
)
schema = replace_once(
    schema,
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
Path('prisma/schema.prisma').write_text(schema, encoding='utf-8')
Path('.github/agent/minimize-social-schema-diff.py').unlink(missing_ok=True)
Path('.github/workflows/minimize-social-schema-diff.yml').unlink(missing_ok=True)
