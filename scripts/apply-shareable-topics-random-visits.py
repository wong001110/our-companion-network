from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found in {path}: {old[:140]!r}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


def insert_before(path: str, anchor: str, content: str) -> None:
    replace_once(path, anchor, content + anchor)


# ---------------------------------------------------------------------------
# Prisma schema and migration.
# ---------------------------------------------------------------------------
replace_once(
    'prisma/schema.prisma',
    '''  published           Boolean                 @default(false)
  activeAssetPackId   String?                 @unique''',
    '''  published           Boolean                 @default(false)
  randomVisitsEnabled Boolean                 @default(false)
  randomVisitAudience String                  @default("friends")
  allowJoinRequests   Boolean                 @default(true)
  activeAssetPackId   String?                 @unique''',
)
replace_once(
    'prisma/schema.prisma',
    '''  relationshipsAsLow  CompanionRelationship[] @relation("CompanionRelationshipLow")
  relationshipsAsHigh CompanionRelationship[] @relation("CompanionRelationshipHigh")

  @@index([ownerUserId])''',
    '''  relationshipsAsLow  CompanionRelationship[] @relation("CompanionRelationshipLow")
  relationshipsAsHigh CompanionRelationship[] @relation("CompanionRelationshipHigh")
  shareableTopics     ShareableTopic[]

  @@index([ownerUserId])''',
)
insert_before(
    'prisma/schema.prisma',
    'model CompanionAssetPack {',
    '''model ShareableTopic {
  id                     String             @id @default(uuid())
  companionId            String
  companion              NetworkCompanion   @relation(fields: [companionId], references: [id], onDelete: Cascade)
  title                   String             @db.VarChar(120)
  summary                 String             @db.VarChar(600)
  tags                    String[]           @default([])
  sourceUrl               String?            @db.VarChar(2000)
  audience                String             @default("friends")
  shareScope              String             @default("summary_only")
  allowRecipientSave      Boolean            @default(false)
  eligibleForRandomVisit  Boolean            @default(false)
  expiresAt               DateTime?
  revokedAt               DateTime?
  lastUsedAt              DateTime?
  createdAt               DateTime           @default(now())
  updatedAt               DateTime           @updatedAt
  visitInvitationRefs     VisitInvitation[]  @relation("VisitInvitationTopicRef")

  @@index([companionId, eligibleForRandomVisit, revokedAt])
  @@index([expiresAt])
  @@index([lastUsedAt])
}

''',
)
replace_once(
    'prisma/schema.prisma',
    '''  companionTags        String[]            @default([])
  status               String''',
    '''  companionTags        String[]            @default([])
  visitMode            String              @default("standard")
  topicRefId           String?
  topicRef             ShareableTopic?     @relation("VisitInvitationTopicRef", fields: [topicRefId], references: [id], onDelete: SetNull)
  topicOwnerCompanionId String?
  topicCreatedByUserId String?
  topicTitle           String?             @db.VarChar(120)
  topicSummary         String?             @db.VarChar(600)
  topicTags            String[]            @default([])
  topicSourceUrl       String?             @db.VarChar(2000)
  topicShareScope      String?
  topicAllowRecipientSave Boolean          @default(false)
  topicSelectedAt      DateTime?
  status               String''',
)
replace_once(
    'prisma/schema.prisma',
    '''  @@index([assetPackRefId, status])
}''',
    '''  @@index([assetPackRefId, status])
  @@index([topicRefId, status])
  @@index([visitMode, status])
}''',
)
replace_once(
    'prisma/schema.prisma',
    '''  assetPackRef           CompanionAssetPack? @relation("VisitSessionAssetPackRef", fields: [assetPackRefId], references: [id], onDelete: SetNull)
  state                  String''',
    '''  assetPackRef           CompanionAssetPack? @relation("VisitSessionAssetPackRef", fields: [assetPackRefId], references: [id], onDelete: SetNull)
  visitMode              String              @default("standard")
  state                  String''',
)

migration = Path('prisma/migrations/20260731030000_shareable_topics_random_visits/migration.sql')
migration.parent.mkdir(parents=True, exist_ok=True)
migration.write_text('''ALTER TABLE "NetworkCompanion"
  ADD COLUMN "randomVisitsEnabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "randomVisitAudience" TEXT NOT NULL DEFAULT 'friends',
  ADD COLUMN "allowJoinRequests" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "NetworkCompanion"
  ADD CONSTRAINT "NetworkCompanion_randomVisitAudience_check"
  CHECK ("randomVisitAudience" IN ('friends', 'selected'));

CREATE TABLE "ShareableTopic" (
  "id" TEXT NOT NULL,
  "companionId" TEXT NOT NULL,
  "title" VARCHAR(120) NOT NULL,
  "summary" VARCHAR(600) NOT NULL,
  "tags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "sourceUrl" VARCHAR(2000),
  "audience" TEXT NOT NULL DEFAULT 'friends',
  "shareScope" TEXT NOT NULL DEFAULT 'summary_only',
  "allowRecipientSave" BOOLEAN NOT NULL DEFAULT false,
  "eligibleForRandomVisit" BOOLEAN NOT NULL DEFAULT false,
  "expiresAt" TIMESTAMP(3),
  "revokedAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ShareableTopic_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "ShareableTopic_audience_check" CHECK ("audience" IN ('friends', 'selected')),
  CONSTRAINT "ShareableTopic_shareScope_check" CHECK ("shareScope" IN ('summary_only', 'summary_and_source'))
);

ALTER TABLE "ShareableTopic" ADD CONSTRAINT "ShareableTopic_companionId_fkey"
  FOREIGN KEY ("companionId") REFERENCES "NetworkCompanion"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
CREATE INDEX "ShareableTopic_companionId_eligibleForRandomVisit_revokedAt_idx"
  ON "ShareableTopic"("companionId", "eligibleForRandomVisit", "revokedAt");
CREATE INDEX "ShareableTopic_expiresAt_idx" ON "ShareableTopic"("expiresAt");
CREATE INDEX "ShareableTopic_lastUsedAt_idx" ON "ShareableTopic"("lastUsedAt");

ALTER TABLE "VisitInvitation"
  ADD COLUMN "visitMode" TEXT NOT NULL DEFAULT 'standard',
  ADD COLUMN "topicRefId" TEXT,
  ADD COLUMN "topicOwnerCompanionId" TEXT,
  ADD COLUMN "topicCreatedByUserId" TEXT,
  ADD COLUMN "topicTitle" VARCHAR(120),
  ADD COLUMN "topicSummary" VARCHAR(600),
  ADD COLUMN "topicTags" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "topicSourceUrl" VARCHAR(2000),
  ADD COLUMN "topicShareScope" TEXT,
  ADD COLUMN "topicAllowRecipientSave" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "topicSelectedAt" TIMESTAMP(3);

ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_topicRefId_fkey"
  FOREIGN KEY ("topicRefId") REFERENCES "ShareableTopic"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_visitMode_check"
  CHECK ("visitMode" IN ('standard', 'random_host_topic', 'visitor_topic'));
ALTER TABLE "VisitInvitation" ADD CONSTRAINT "VisitInvitation_topicShareScope_check"
  CHECK ("topicShareScope" IS NULL OR "topicShareScope" IN ('summary_only', 'summary_and_source'));
CREATE INDEX "VisitInvitation_topicRefId_status_idx" ON "VisitInvitation"("topicRefId", "status");
CREATE INDEX "VisitInvitation_visitMode_status_idx" ON "VisitInvitation"("visitMode", "status");

ALTER TABLE "VisitSession" ADD COLUMN "visitMode" TEXT NOT NULL DEFAULT 'standard';
ALTER TABLE "VisitSession" ADD CONSTRAINT "VisitSession_visitMode_check"
  CHECK ("visitMode" IN ('standard', 'random_host_topic', 'visitor_topic'));
''', encoding='utf-8')

# ---------------------------------------------------------------------------
# DTOs.
# ---------------------------------------------------------------------------
dto = Path('src/companion/dto/shareable-topic.dto.ts')
dto.write_text('''import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpsertShareableTopicDto {
  @IsString() @MaxLength(120) title: string;
  @IsString() @MaxLength(600) summary: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(30, { each: true }) tags?: string[];
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['https'] }) @MaxLength(2000) sourceUrl?: string;
  @IsOptional() @IsIn(['friends', 'selected']) audience?: 'friends' | 'selected';
  @IsOptional() @IsIn(['summary_only', 'summary_and_source']) shareScope?: 'summary_only' | 'summary_and_source';
  @IsOptional() @IsBoolean() allowRecipientSave?: boolean;
  @IsOptional() @IsBoolean() eligibleForRandomVisit?: boolean;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class UpdateCompanionSocialPolicyDto {
  @IsOptional() @IsBoolean() randomVisitsEnabled?: boolean;
  @IsOptional() @IsIn(['friends', 'selected']) randomVisitAudience?: 'friends' | 'selected';
  @IsOptional() @IsBoolean() allowJoinRequests?: boolean;
}
''', encoding='utf-8')

# ---------------------------------------------------------------------------
# Companion service/controller.
# ---------------------------------------------------------------------------
replace_once(
    'src/companion/companion.service.ts',
    '''import { UpsertCompanionDto } from './dto/upsert-companion.dto';
import { validateManifest }''',
    '''import { UpsertCompanionDto } from './dto/upsert-companion.dto';
import { UpdateCompanionSocialPolicyDto, UpsertShareableTopicDto } from './dto/shareable-topic.dto';
import { validateManifest }''',
)
replace_once(
    'src/companion/companion.service.ts',
    '''const PUBLIC_SELECT = { id: true, ownerUserId: true, name: true, publicDescription: true, publicTags: true, visibility: true, published: true, activeAssetPackId: true, createdAt: true, updatedAt: true, publishedAt: true } as const;''',
    '''const PUBLIC_SELECT = { id: true, ownerUserId: true, name: true, publicDescription: true, publicTags: true, visibility: true, published: true, randomVisitsEnabled: true, randomVisitAudience: true, allowJoinRequests: true, activeAssetPackId: true, createdAt: true, updatedAt: true, publishedAt: true } as const;
const TOPIC_SELECT = { id: true, companionId: true, title: true, summary: true, tags: true, sourceUrl: true, audience: true, shareScope: true, allowRecipientSave: true, eligibleForRandomVisit: true, expiresAt: true, revokedAt: true, lastUsedAt: true, createdAt: true, updatedAt: true } as const;''',
)
insert_before(
    'src/companion/companion.service.ts',
    '''  async initiateAssetPack(userId: string, companionId: string, dto: InitiateAssetPackDto) {''',
    '''  async listShareableTopics(userId: string, companionId: string) {
    await this.requireOwnedCompanion(userId, companionId);
    const topics = await this.prisma.shareableTopic.findMany({
      where: { companionId, revokedAt: null },
      select: TOPIC_SELECT,
      orderBy: [{ eligibleForRandomVisit: 'desc' }, { updatedAt: 'desc' }],
    });
    return topics.map(topic => this.shareableTopic(topic));
  }

  async createShareableTopic(userId: string, companionId: string, dto: UpsertShareableTopicDto) {
    await this.requireOwnedCompanion(userId, companionId);
    const topic = await this.prisma.shareableTopic.create({
      data: { companionId, ...this.normalizeShareableTopic(dto) },
      select: TOPIC_SELECT,
    });
    await this.publishInvalidation(userId, 'companion.topic.updated', { ownerUserId: userId, companionId, topicId: topic.id });
    return this.shareableTopic(topic);
  }

  async updateShareableTopic(userId: string, companionId: string, topicId: string, dto: UpsertShareableTopicDto) {
    await this.requireOwnedTopic(userId, companionId, topicId);
    const topic = await this.prisma.shareableTopic.update({
      where: { id: topicId },
      data: { ...this.normalizeShareableTopic(dto), revokedAt: null },
      select: TOPIC_SELECT,
    });
    await this.publishInvalidation(userId, 'companion.topic.updated', { ownerUserId: userId, companionId, topicId });
    return this.shareableTopic(topic);
  }

  async revokeShareableTopic(userId: string, companionId: string, topicId: string) {
    await this.requireOwnedTopic(userId, companionId, topicId);
    const topic = await this.prisma.shareableTopic.update({
      where: { id: topicId },
      data: { revokedAt: new Date(), eligibleForRandomVisit: false },
      select: TOPIC_SELECT,
    });
    await this.publishInvalidation(userId, 'companion.topic.revoked', { ownerUserId: userId, companionId, topicId });
    return this.shareableTopic(topic);
  }

  async updateSocialPolicy(userId: string, companionId: string, dto: UpdateCompanionSocialPolicyDto) {
    const companion = await this.requireOwnedCompanion(userId, companionId);
    const randomVisitsEnabled = dto.randomVisitsEnabled ?? companion.randomVisitsEnabled;
    if (randomVisitsEnabled) {
      if (!companion.published || !companion.activeAssetPackId) {
        throw new ConflictException({ code: 'RANDOM_VISIT_COMPANION_NOT_READY', message: 'Publish an active Companion before enabling random visits' });
      }
      const topicCount = await this.prisma.shareableTopic.count({
        where: {
          companionId,
          eligibleForRandomVisit: true,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }],
        },
      });
      if (!topicCount) throw new ConflictException({ code: 'RANDOM_VISIT_TOPIC_REQUIRED', message: 'Enable at least one active random-visit topic first' });
    }
    const updated = await this.prisma.networkCompanion.update({
      where: { id: companionId },
      data: {
        randomVisitsEnabled,
        randomVisitAudience: dto.randomVisitAudience ?? companion.randomVisitAudience,
        allowJoinRequests: dto.allowJoinRequests ?? companion.allowJoinRequests,
      },
      select: PUBLIC_SELECT,
    });
    await this.publishInvalidation(userId, 'companion.profile.updated', { ownerUserId: userId, companionId });
    return this.publicProfile(updated);
  }

''',
)
insert_before(
    'src/companion/companion.service.ts',
    '''  private async requireOwnedCompanion(userId: string, companionId: string) {''',
    '''  private async requireOwnedTopic(userId: string, companionId: string, topicId: string) {
    const topic = await this.prisma.shareableTopic.findUnique({
      where: { id: topicId },
      select: { id: true, companionId: true, companion: { select: { ownerUserId: true } } },
    });
    if (!topic) throw new NotFoundException({ code: 'SHAREABLE_TOPIC_NOT_FOUND', message: 'Shareable topic was not found' });
    if (topic.companionId !== companionId || topic.companion.ownerUserId !== userId) {
      throw new ForbiddenException({ code: 'SHAREABLE_TOPIC_NOT_OWNED', message: 'Shareable topic is not available' });
    }
    return topic;
  }

''',
)
insert_before(
    'src/companion/companion.service.ts',
    '''  private normalizeProfile(dto: UpsertCompanionDto) {''',
    '''  private normalizeShareableTopic(dto: UpsertShareableTopicDto) {
    const title = dto.title.trim().replace(/\\s+/g, ' ');
    const summary = dto.summary.trim().replace(/\\s+/g, ' ');
    const tags = [...new Set((dto.tags ?? []).map(tag => tag.trim().toLowerCase()).filter(Boolean))];
    const sourceUrl = dto.shareScope === 'summary_and_source' ? dto.sourceUrl?.trim() : undefined;
    const expiresAt = dto.expiresAt ? new Date(dto.expiresAt) : undefined;
    if (!title || !summary || title.length > 120 || summary.length > 600 || tags.length > 8 || tags.some(tag => tag.length > 30)) {
      throw new BadRequestException({ code: 'SHAREABLE_TOPIC_INVALID', message: 'Shareable topic is invalid' });
    }
    if (expiresAt && expiresAt.getTime() <= Date.now()) {
      throw new BadRequestException({ code: 'SHAREABLE_TOPIC_EXPIRED', message: 'Shareable topic expiry must be in the future' });
    }
    return {
      title,
      summary,
      tags,
      sourceUrl,
      audience: dto.audience ?? 'friends',
      shareScope: dto.shareScope ?? 'summary_only',
      allowRecipientSave: dto.allowRecipientSave ?? false,
      eligibleForRandomVisit: dto.eligibleForRandomVisit ?? false,
      expiresAt,
    };
  }

  private shareableTopic(topic: any) {
    return {
      ...topic,
      sourceUrl: topic.sourceUrl ?? undefined,
      expiresAt: topic.expiresAt?.toISOString(),
      revokedAt: topic.revokedAt?.toISOString(),
      lastUsedAt: topic.lastUsedAt?.toISOString(),
      createdAt: topic.createdAt.toISOString(),
      updatedAt: topic.updatedAt.toISOString(),
    };
  }

''',
)
replace_once(
    'src/companion/companion.controller.ts',
    '''import { FileIdsDto } from './dto/file-ids.dto';''',
    '''import { FileIdsDto } from './dto/file-ids.dto';
import { UpdateCompanionSocialPolicyDto, UpsertShareableTopicDto } from './dto/shareable-topic.dto';''',
)
replace_once(
    'src/companion/companion.controller.ts',
    '''  @Post(':id/unpublish') @SocialRateLimit('companion_profile') unpublish(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.unpublish(user.id, id); }
  @Get(':id/asset-packs')''',
    '''  @Post(':id/unpublish') @SocialRateLimit('companion_profile') unpublish(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.unpublish(user.id, id); }
  @Patch(':id/social-policy') @SocialRateLimit('companion_profile') policy(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanionSocialPolicyDto) { return this.companions.updateSocialPolicy(user.id, id, dto); }
  @Get(':id/shareable-topics') @SocialRateLimit('read') topics(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) { return this.companions.listShareableTopics(user.id, id); }
  @Post(':id/shareable-topics') @SocialRateLimit('companion_profile') createTopic(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertShareableTopicDto) { return this.companions.createShareableTopic(user.id, id, dto); }
  @Patch(':id/shareable-topics/:topicId') @SocialRateLimit('companion_profile') updateTopic(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('topicId', ParseUUIDPipe) topicId: string, @Body() dto: UpsertShareableTopicDto) { return this.companions.updateShareableTopic(user.id, id, topicId, dto); }
  @Delete(':id/shareable-topics/:topicId') @SocialRateLimit('companion_profile') revokeTopic(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('topicId', ParseUUIDPipe) topicId: string) { return this.companions.revokeShareableTopic(user.id, id, topicId); }
  @Get(':id/asset-packs')''',
)

# ---------------------------------------------------------------------------
# Visit modes and immutable topic snapshots.
# ---------------------------------------------------------------------------
replace_once(
    'src/visit/visit.controller.ts',
    '''import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';''',
    '''import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsOptional, IsUUID } from 'class-validator';''',
)
replace_once(
    'src/visit/visit.controller.ts',
    '''class CreateInvitationDto { @IsUUID() hostUserId: string; }''',
    '''class CreateInvitationDto {
  @IsUUID() hostUserId: string;
  @IsOptional() @IsIn(['standard', 'random_host_topic', 'visitor_topic']) mode?: 'standard' | 'random_host_topic' | 'visitor_topic';
  @IsOptional() @IsUUID() topicId?: string;
}''',
)
replace_once(
    'src/visit/visit.controller.ts',
    '''  @Post() @SocialRateLimit('visit_create') create(@CurrentUser() user: UserPayload, @Body() dto: CreateInvitationDto) { return this.visits.createInvitation(user.id, dto.hostUserId); }''',
    '''  @Post() @SocialRateLimit('visit_create') create(@CurrentUser() user: UserPayload, @Body() dto: CreateInvitationDto) { return this.visits.createInvitation(user.id, dto.hostUserId, { mode: dto.mode, topicId: dto.topicId }); }''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''const INVITATION_SELECT = { id: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true, assetPackSnapshotId: true, assetPackRefId: true, companionName: true, companionDescription: true, companionTags: true, status: true, expiresAt: true, respondedAt: true, cancelledAt: true, createdAt: true, updatedAt: true } as const;
const SESSION_SELECT = { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, hostNetworkCompanionId: true, networkCompanionId: true, assetPackSnapshotId: true, assetPackRefId: true, state: true,''',
    '''const INVITATION_SELECT = { id: true, visitorOwnerUserId: true, hostUserId: true, networkCompanionId: true, assetPackSnapshotId: true, assetPackRefId: true, companionName: true, companionDescription: true, companionTags: true, visitMode: true, topicRefId: true, topicOwnerCompanionId: true, topicCreatedByUserId: true, topicTitle: true, topicSummary: true, topicTags: true, topicSourceUrl: true, topicShareScope: true, topicAllowRecipientSave: true, topicSelectedAt: true, status: true, expiresAt: true, respondedAt: true, cancelledAt: true, createdAt: true, updatedAt: true } as const;
const SESSION_SELECT = { id: true, invitationId: true, visitorOwnerUserId: true, hostUserId: true, hostNetworkCompanionId: true, networkCompanionId: true, assetPackSnapshotId: true, assetPackRefId: true, visitMode: true, state: true,''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''  async createInvitation(visitorOwnerUserId: string, hostUserId: string) {
    this.requireFeature();''',
    '''  async createInvitation(visitorOwnerUserId: string, hostUserId: string, input: { mode?: 'standard' | 'random_host_topic' | 'visitor_topic'; topicId?: string } = {}) {
    this.requireFeature();''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''      const snapshot = await this.loadCurrentSnapshotInTransaction(tx, visitorOwnerUserId);
      if (!snapshot) this.notAvailable();
      if (!supportsVisualVisit(snapshot.pack.manifest)) this.visualAssetsUnavailable();
      const existing = await tx.visitInvitation.findFirst({ where: { visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, status: PENDING, expiresAt: { gt: new Date() } }, select: INVITATION_SELECT });
      if (existing) throw new ConflictException({ code: 'VISIT_INVITATION_ALREADY_EXISTS', message: 'An equivalent Visit invitation is already pending' });
      return tx.visitInvitation.create({ data: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, assetPackSnapshotId: snapshot.pack.id, assetPackRefId: snapshot.pack.id,
        companionName: snapshot.companion.name, companionDescription: snapshot.companion.publicDescription, companionTags: snapshot.companion.publicTags,
        status: PENDING, expiresAt: new Date(Date.now() + this.limits.invitationTtlHours * 3_600_000),
      }, select: INVITATION_SELECT });''',
    '''      const snapshot = await this.loadCurrentSnapshotInTransaction(tx, visitorOwnerUserId);
      if (!snapshot) this.notAvailable();
      if (!supportsVisualVisit(snapshot.pack.manifest)) this.visualAssetsUnavailable();
      const visitMode = input.mode ?? 'standard';
      const topic = await this.resolveInvitationTopic(tx, visitorOwnerUserId, hostUserId, snapshot.companion.id, visitMode, input.topicId);
      const existing = await tx.visitInvitation.findFirst({ where: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id,
        visitMode, topicRefId: topic?.topicRefId ?? null,
        status: PENDING, expiresAt: { gt: new Date() },
      }, select: INVITATION_SELECT });
      if (existing) throw new ConflictException({ code: 'VISIT_INVITATION_ALREADY_EXISTS', message: 'An equivalent Visit invitation is already pending' });
      return tx.visitInvitation.create({ data: {
        visitorOwnerUserId, hostUserId, networkCompanionId: snapshot.companion.id, assetPackSnapshotId: snapshot.pack.id, assetPackRefId: snapshot.pack.id,
        companionName: snapshot.companion.name, companionDescription: snapshot.companion.publicDescription, companionTags: snapshot.companion.publicTags,
        visitMode,
        ...(topic ?? {}),
        status: PENDING, expiresAt: new Date(Date.now() + this.limits.invitationTtlHours * 3_600_000),
      }, select: INVITATION_SELECT });''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''        hostNetworkCompanionId: host?.activeNetworkCompanionId ?? null,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id, state: 'preparing',
      }, select: SESSION_SELECT });''',
    '''        hostNetworkCompanionId: host?.activeNetworkCompanionId ?? null,
        networkCompanionId: invitation.networkCompanionId, assetPackSnapshotId: invitation.assetPackSnapshotId, assetPackRefId: pack.id,
        visitMode: invitation.visitMode,
        ...(invitation.topicTitle && invitation.topicSummary && invitation.topicCreatedByUserId ? {
          socialShare: { create: {
            title: invitation.topicTitle,
            summary: invitation.topicSummary,
            tags: invitation.topicTags,
            sourceUrl: invitation.topicShareScope === 'summary_and_source' ? invitation.topicSourceUrl : null,
            createdByUserId: invitation.topicCreatedByUserId,
          } },
        } : {}),
        state: 'preparing',
      }, select: SESSION_SELECT });''',
)
insert_before(
    'src/visit/visit.service.ts',
    '''  private async assertEligible(tx: any, first: string, second: string) {''',
    '''  private async resolveInvitationTopic(
    tx: Prisma.TransactionClient,
    visitorOwnerUserId: string,
    hostUserId: string,
    visitorCompanionId: string,
    mode: 'standard' | 'random_host_topic' | 'visitor_topic',
    topicId?: string,
  ) {
    if (mode === 'standard') {
      if (topicId) throw new ConflictException({ code: 'VISIT_TOPIC_NOT_AVAILABLE', message: 'A standard Visit cannot attach a topic' });
      return undefined;
    }
    const now = new Date();
    if (mode === 'visitor_topic') {
      if (!topicId) throw new ConflictException({ code: 'VISIT_TOPIC_REQUIRED', message: 'Choose a shareable topic for this Visit' });
      const topic = await tx.shareableTopic.findFirst({
        where: {
          id: topicId,
          companionId: visitorCompanionId,
          revokedAt: null,
          OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
        },
      });
      if (!topic) throw new ConflictException({ code: 'VISIT_TOPIC_NOT_AVAILABLE', message: 'The selected topic is not available' });
      return this.topicSnapshot(topic, visitorOwnerUserId, now);
    }

    const host = await tx.user.findUnique({
      where: { id: hostUserId },
      select: {
        activeNetworkCompanion: {
          select: {
            id: true, published: true, visibility: true, activeAssetPackId: true,
            randomVisitsEnabled: true, randomVisitAudience: true,
          },
        },
      },
    });
    const hostCompanion = host?.activeNetworkCompanion;
    if (!hostCompanion || !hostCompanion.published || hostCompanion.visibility !== 'friends_only'
      || !hostCompanion.activeAssetPackId || !hostCompanion.randomVisitsEnabled
      || hostCompanion.randomVisitAudience !== 'friends') {
      throw new ConflictException({ code: 'RANDOM_VISIT_NOT_AVAILABLE', message: 'The host Companion is not accepting random visits' });
    }
    const topic = await tx.shareableTopic.findFirst({
      where: {
        companionId: hostCompanion.id,
        audience: 'friends',
        eligibleForRandomVisit: true,
        revokedAt: null,
        OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      },
      orderBy: [{ lastUsedAt: { sort: 'asc', nulls: 'first' } }, { updatedAt: 'desc' }],
    });
    if (!topic) throw new ConflictException({ code: 'RANDOM_VISIT_TOPIC_NOT_AVAILABLE', message: 'The host Companion has no active random-visit topic' });
    await tx.shareableTopic.update({ where: { id: topic.id }, data: { lastUsedAt: now } });
    return this.topicSnapshot(topic, hostUserId, now);
  }

  private topicSnapshot(topic: any, createdByUserId: string, selectedAt: Date) {
    return {
      topicRefId: topic.id,
      topicOwnerCompanionId: topic.companionId,
      topicCreatedByUserId: createdByUserId,
      topicTitle: topic.title,
      topicSummary: topic.summary,
      topicTags: topic.tags,
      topicSourceUrl: topic.shareScope === 'summary_and_source' ? topic.sourceUrl : null,
      topicShareScope: topic.shareScope,
      topicAllowRecipientSave: topic.allowRecipientSave,
      topicSelectedAt: selectedAt,
    };
  }

''',
)
replace_once(
    'src/visit/visit.service.ts',
    '''  private invitationSummary(value: any) { const { assetPackSnapshotId, assetPackRefId: _assetPackRefId, ...summary } = value; return { ...summary, assetPackId: assetPackSnapshotId, companionDescription: value.companionDescription ?? undefined, respondedAt: value.respondedAt?.toISOString(), cancelledAt: value.cancelledAt?.toISOString(), expiresAt: value.expiresAt.toISOString(), createdAt: value.createdAt.toISOString(), updatedAt: value.updatedAt.toISOString() }; }
  private sessionSummary(value: any) { return { id: value.id, invitationId: value.invitationId, visitorOwnerUserId: value.visitorOwnerUserId, hostUserId: value.hostUserId, networkCompanionId: value.networkCompanionId, assetPackId: value.assetPackSnapshotId, state: value.state,''',
    '''  private invitationSummary(value: any) {
    const { assetPackSnapshotId, assetPackRefId: _assetPackRefId, topicRefId: _topicRefId, topicCreatedByUserId: _topicCreatedByUserId, ...summary } = value;
    return {
      ...summary,
      assetPackId: assetPackSnapshotId,
      companionDescription: value.companionDescription ?? undefined,
      topic: value.topicTitle ? {
        ownerCompanionId: value.topicOwnerCompanionId,
        title: value.topicTitle,
        summary: value.topicSummary,
        tags: value.topicTags,
        sourceUrl: value.topicShareScope === 'summary_and_source' ? value.topicSourceUrl ?? undefined : undefined,
        shareScope: value.topicShareScope,
        allowRecipientSave: value.topicAllowRecipientSave,
      } : undefined,
      topicSelectedAt: value.topicSelectedAt?.toISOString(),
      respondedAt: value.respondedAt?.toISOString(),
      cancelledAt: value.cancelledAt?.toISOString(),
      expiresAt: value.expiresAt.toISOString(),
      createdAt: value.createdAt.toISOString(),
      updatedAt: value.updatedAt.toISOString(),
    };
  }
  private sessionSummary(value: any) { return { id: value.id, invitationId: value.invitationId, visitorOwnerUserId: value.visitorOwnerUserId, hostUserId: value.hostUserId, networkCompanionId: value.networkCompanionId, assetPackId: value.assetPackSnapshotId, visitMode: value.visitMode, state: value.state,''',
)

# ---------------------------------------------------------------------------
# Portal CRUD and policy management.
# ---------------------------------------------------------------------------
replace_once(
    'src/portal/portal.controller.ts',
    '''import { PortalService } from './portal.service';''',
    '''import { PortalService } from './portal.service';
import { UpdateCompanionSocialPolicyDto, UpsertShareableTopicDto } from '../companion/dto/shareable-topic.dto';''',
)
replace_once(
    'src/portal/portal.controller.ts',
    '''  @Get('companions/:id/asset-packs')''',
    '''  @Get('companions/:id/shareable-topics')
  shareableTopics(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.portal.listShareableTopics(user.id, id);
  }

  @Post('companions/:id/shareable-topics')
  createShareableTopic(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpsertShareableTopicDto) {
    return this.portal.createShareableTopic(user.id, id, dto);
  }

  @Patch('companions/:id/shareable-topics/:topicId')
  updateShareableTopic(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('topicId', ParseUUIDPipe) topicId: string, @Body() dto: UpsertShareableTopicDto) {
    return this.portal.updateShareableTopic(user.id, id, topicId, dto);
  }

  @Delete('companions/:id/shareable-topics/:topicId')
  revokeShareableTopic(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Param('topicId', ParseUUIDPipe) topicId: string) {
    return this.portal.revokeShareableTopic(user.id, id, topicId);
  }

  @Patch('companions/:id/social-policy')
  updateSocialPolicy(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCompanionSocialPolicyDto) {
    return this.portal.updateSocialPolicy(user.id, id, dto);
  }

  @Get('companions/:id/asset-packs')''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''import { UpdateProfileDto } from '../community/dto/update-profile.dto';''',
    '''import { UpdateProfileDto } from '../community/dto/update-profile.dto';
import { UpdateCompanionSocialPolicyDto, UpsertShareableTopicDto } from '../companion/dto/shareable-topic.dto';''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''          published: true,
          activeAssetPackId: true,''',
    '''          published: true,
          randomVisitsEnabled: true,
          randomVisitAudience: true,
          allowJoinRequests: true,
          activeAssetPackId: true,''',
)
replace_once(
    'src/portal/portal.service.ts',
    '''        published: true,
        activeAssetPackId: true,''',
    '''        published: true,
        randomVisitsEnabled: true,
        randomVisitAudience: true,
        allowJoinRequests: true,
        activeAssetPackId: true,''',
)
insert_before(
    'src/portal/portal.service.ts',
    '''  async listAssetPacks(''',
    '''  listShareableTopics(userId: string, companionId: string) {
    return this.companions.listShareableTopics(userId, companionId);
  }

  createShareableTopic(userId: string, companionId: string, dto: UpsertShareableTopicDto) {
    return this.companions.createShareableTopic(userId, companionId, dto);
  }

  updateShareableTopic(userId: string, companionId: string, topicId: string, dto: UpsertShareableTopicDto) {
    return this.companions.updateShareableTopic(userId, companionId, topicId, dto);
  }

  revokeShareableTopic(userId: string, companionId: string, topicId: string) {
    return this.companions.revokeShareableTopic(userId, companionId, topicId);
  }

  updateSocialPolicy(userId: string, companionId: string, dto: UpdateCompanionSocialPolicyDto) {
    return this.companions.updateSocialPolicy(userId, companionId, dto);
  }

''',
)
# Export shareable topics in the user's data export.
replace_once(
    'src/portal/portal.service.ts',
    '''    yield ',"companionAssetPacks":';''',
    '''    yield ',"shareableTopics":';
    yield* this.streamExportArray((cursor) => this.prisma.shareableTopic.findMany({
      where: { companion: { ownerUserId: userId } },
      ...exportCursorPage(cursor),
    }));
    yield ',"companionAssetPacks":';''',
)

# ---------------------------------------------------------------------------
# Portal UI.
# ---------------------------------------------------------------------------
panel = Path('portal/src/features/companion/ShareableTopicsPanel.tsx')
panel.parent.mkdir(parents=True, exist_ok=True)
panel.write_text('''import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Globe2, Plus, ShieldCheck, Trash2 } from 'lucide-react';
import { api, jsonBody } from '../../lib/api';
import { Button, EmptyState, ErrorState, PaperCard, Stamp } from '../../components/ui';

export interface ShareableTopic {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  sourceUrl?: string;
  audience: 'friends' | 'selected';
  shareScope: 'summary_only' | 'summary_and_source';
  allowRecipientSave: boolean;
  eligibleForRandomVisit: boolean;
  expiresAt?: string;
  lastUsedAt?: string;
}

interface CompanionPolicy {
  id: string;
  published: boolean;
  randomVisitsEnabled: boolean;
  randomVisitAudience: string;
  allowJoinRequests: boolean;
}

const emptyDraft = { title: '', summary: '', tags: '', sourceUrl: '', eligibleForRandomVisit: false, allowRecipientSave: false, shareScope: 'summary_only' as const };

export function ShareableTopicsPanel({ companion }: { companion: CompanionPolicy }) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(emptyDraft);
  const topics = useQuery({
    queryKey: ['shareable-topics', companion.id],
    queryFn: () => api<ShareableTopic[]>(`/api/portal/companions/${companion.id}/shareable-topics`),
  });
  const createTopic = useMutation({
    mutationFn: () => api(`/api/portal/companions/${companion.id}/shareable-topics`, {
      method: 'POST',
      ...jsonBody({
        title: draft.title,
        summary: draft.summary,
        tags: draft.tags.split(',').map((tag) => tag.trim()).filter(Boolean),
        sourceUrl: draft.shareScope === 'summary_and_source' && draft.sourceUrl ? draft.sourceUrl : undefined,
        audience: 'friends',
        shareScope: draft.shareScope,
        allowRecipientSave: draft.allowRecipientSave,
        eligibleForRandomVisit: draft.eligibleForRandomVisit,
      }),
    }),
    onSuccess: () => {
      setDraft(emptyDraft);
      void queryClient.invalidateQueries({ queryKey: ['shareable-topics', companion.id] });
    },
  });
  const revoke = useMutation({
    mutationFn: (topicId: string) => api(`/api/portal/companions/${companion.id}/shareable-topics/${topicId}`, { method: 'DELETE' }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['shareable-topics', companion.id] }),
  });
  const policy = useMutation({
    mutationFn: (next: Partial<CompanionPolicy>) => api(`/api/portal/companions/${companion.id}/social-policy`, { method: 'PATCH', ...jsonBody(next) }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['companions'] });
      void queryClient.invalidateQueries({ queryKey: ['shareable-topics', companion.id] });
    },
  });
  const hasRandomTopic = topics.data?.some((topic) => topic.eligibleForRandomVisit) ?? false;

  useEffect(() => setDraft(emptyDraft), [companion.id]);

  return <section aria-labelledby="shareable-topics-heading">
    <div className="section-title"><div><p className="eyebrow">Social permissions</p><h2 id="shareable-topics-heading">Shareable Topics</h2></div><Globe2 /></div>
    <PaperCard>
      <div className="section-heading"><div><h3>Random Visit policy</h3><p>Random visitors discuss one active topic owned by this Host Companion.</p></div><ShieldCheck /></div>
      <label className="inline-form"><input type="checkbox" checked={companion.randomVisitsEnabled} disabled={!companion.published || !hasRandomTopic || policy.isPending} onChange={(event) => policy.mutate({ randomVisitsEnabled: event.target.checked })} /> Accept random visits from friends</label>
      <label className="inline-form"><input type="checkbox" checked={companion.allowJoinRequests} disabled={policy.isPending} onChange={(event) => policy.mutate({ allowJoinRequests: event.target.checked })} /> Allow another Companion to request joining a future Social Room</label>
      {!companion.published && <p className="inline-error">Publish this Companion before enabling random visits.</p>}
      {!hasRandomTopic && <p>Create at least one topic marked for random visits.</p>}
      {policy.isError && <p className="inline-error">{policy.error.message}</p>}
    </PaperCard>
    <PaperCard>
      <h3>Add an approved topic</h3>
      <div className="form-grid">
        <label><span>Title</span><input maxLength={120} value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })} /></label>
        <label><span>Tags, separated by commas</span><input value={draft.tags} onChange={(event) => setDraft({ ...draft, tags: event.target.value })} /></label>
        <label className="form-span"><span>Public summary</span><textarea maxLength={600} value={draft.summary} onChange={(event) => setDraft({ ...draft, summary: event.target.value })} /></label>
        <label><span>Sharing scope</span><select value={draft.shareScope} onChange={(event) => setDraft({ ...draft, shareScope: event.target.value as typeof draft.shareScope })}><option value="summary_only">Summary only</option><option value="summary_and_source">Summary and source</option></select></label>
        {draft.shareScope === 'summary_and_source' && <label><span>HTTPS source URL</span><input type="url" value={draft.sourceUrl} onChange={(event) => setDraft({ ...draft, sourceUrl: event.target.value })} /></label>}
        <label><input type="checkbox" checked={draft.eligibleForRandomVisit} onChange={(event) => setDraft({ ...draft, eligibleForRandomVisit: event.target.checked })} /> Available for random visits</label>
        <label><input type="checkbox" checked={draft.allowRecipientSave} onChange={(event) => setDraft({ ...draft, allowRecipientSave: event.target.checked })} /> Allow recipient to save the topic later</label>
      </div>
      <Button disabled={!draft.title.trim() || !draft.summary.trim() || createTopic.isPending} onClick={() => createTopic.mutate()}><Plus /> Add topic</Button>
      {createTopic.isError && <p className="inline-error">{createTopic.error.message}</p>}
    </PaperCard>
    {topics.isError && <ErrorState error={topics.error} onRetry={() => void topics.refetch()} />}
    {topics.data?.length === 0 && <EmptyState title="No approved topics">Add a sanitized summary before allowing Social Visits to use it.</EmptyState>}
    <div className="pack-list">
      {topics.data?.map((topic) => <PaperCard className="pack-card" key={topic.id}>
        <div className="section-heading"><div><h3>{topic.title}</h3><p>{topic.summary}</p></div><Stamp tone={topic.eligibleForRandomVisit ? 'good' : 'neutral'}>{topic.eligibleForRandomVisit ? 'Random Visit' : 'Manual only'}</Stamp></div>
        {topic.tags.length > 0 && <p>{topic.tags.join(' · ')}</p>}
        {topic.sourceUrl && <a className="text-link" href={topic.sourceUrl} target="_blank" rel="noreferrer">Open source ↗</a>}
        <Button variant="danger" disabled={revoke.isPending} onClick={() => revoke.mutate(topic.id)}><Trash2 /> Revoke</Button>
      </PaperCard>)}
    </div>
  </section>;
}
''', encoding='utf-8')
replace_once(
    'portal/src/pages/CompanionPage.tsx',
    '''import { formatBytes, formatDate, sentenceCase, shortId } from '../lib/format';''',
    '''import { formatBytes, formatDate, sentenceCase, shortId } from '../lib/format';
import { ShareableTopicsPanel } from '../features/companion/ShareableTopicsPanel';''',
)
replace_once(
    'portal/src/pages/CompanionPage.tsx',
    '''  published: boolean;
  isActive: boolean;''',
    '''  published: boolean;
  randomVisitsEnabled: boolean;
  randomVisitAudience: string;
  allowJoinRequests: boolean;
  isActive: boolean;''',
)
replace_once(
    'portal/src/pages/CompanionPage.tsx',
    '''          <div className="section-title">
            <div>
              <p className="eyebrow">Wardrobe archive</p>''',
    '''          <ShareableTopicsPanel companion={companion} />
          <div className="section-title">
            <div>
              <p className="eyebrow">Wardrobe archive</p>''',
)

# ---------------------------------------------------------------------------
# Focused tests.
# ---------------------------------------------------------------------------
Path('src/companion/shareable-topics.spec.ts').write_text('''import { CompanionService } from './companion.service';

describe('CompanionService shareable topics', () => {
  it('requires one active random topic before enabling random visits', async () => {
    const prisma = {
      networkCompanion: {
        findUnique: jest.fn().mockResolvedValue({ id: 'companion-1', ownerUserId: 'user-1', published: true, activeAssetPackId: 'pack-1', randomVisitsEnabled: false, randomVisitAudience: 'friends', allowJoinRequests: true }),
      },
      shareableTopic: { count: jest.fn().mockResolvedValue(0) },
    };
    const service = new CompanionService(prisma as never, {} as never, { publishToUser: jest.fn() } as never);
    await expect(service.updateSocialPolicy('user-1', 'companion-1', { randomVisitsEnabled: true }))
      .rejects.toMatchObject({ response: expect.objectContaining({ code: 'RANDOM_VISIT_TOPIC_REQUIRED' }) });
  });
});
''', encoding='utf-8')
Path('src/visit/random-visit-topic.spec.ts').write_text('''import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('random Visit topic contract', () => {
  it('selects an active Host-owned topic and snapshots it before acceptance', () => {
    const source = readFileSync(join(__dirname, 'visit.service.ts'), 'utf8');
    expect(source).toContain("mode === 'random_host_topic'");
    expect(source).toContain('randomVisitsEnabled');
    expect(source).toContain('topicOwnerCompanionId');
    expect(source).toContain('socialShare: { create:');
    expect(source).toContain("visitMode: invitation.visitMode");
  });
});
''', encoding='utf-8')
