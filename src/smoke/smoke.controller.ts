import { Body, Controller, Headers, NotFoundException, Post } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { IsString, Matches } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { StorageService } from '../storage/storage.service';
import { Public } from '../common/decorators/public.decorator';

class SmokeCleanupDto {
  @IsString()
  @Matches(/^[a-z0-9-]{12,40}$/i)
  runId: string;
}

/** Dedicated-test-server cleanup only. It is deliberately not a general data-management API. */
@Controller('smoke')
export class SmokeController {
  constructor(private readonly config: ConfigService, private readonly prisma: PrismaService, private readonly storage: StorageService) {}

  @Public()
  @Post('cleanup')
  async cleanup(@Headers('x-smoke-test-token') token: string | undefined, @Body() dto: SmokeCleanupDto) {
    this.requireSmokeRuntime(token);
    const suffix = `-s5-${dto.runId}@example.invalid`;
    const users = await this.prisma.user.findMany({ where: { email: { endsWith: suffix } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    if (!userIds.length) return { cleaned: true, users: 0, packs: 0, objects: 0 };
    const packs = await this.prisma.companionAssetPack.findMany({
      where: { companion: { ownerUserId: { in: userIds } } },
      select: { objectPrefix: true, files: { select: { objectKey: true } } },
    });
    const uniqueObjectKeys = [...new Set(packs.flatMap((pack) => [...pack.files.map((file) => file.objectKey), `${pack.objectPrefix}/manifest.json`]))];
    if (uniqueObjectKeys.length) await this.storage.deleteObjects(uniqueObjectKeys);
    await this.prisma.$transaction(async (tx) => {
      const companionIds = (await tx.networkCompanion.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } })).map((companion) => companion.id);
      await tx.user.updateMany({ where: { id: { in: userIds } }, data: { activeNetworkCompanionId: null } });
      await tx.networkCompanion.updateMany({ where: { id: { in: companionIds } }, data: { activeAssetPackId: null } });
      await tx.visitSession.deleteMany({ where: { OR: [{ visitorOwnerUserId: { in: userIds } }, { hostUserId: { in: userIds } }, { networkCompanionId: { in: companionIds } }] } });
      await tx.visitInvitation.deleteMany({ where: { OR: [{ visitorOwnerUserId: { in: userIds } }, { hostUserId: { in: userIds } }, { networkCompanionId: { in: companionIds } }] } });
      await tx.networkCompanion.deleteMany({ where: { id: { in: companionIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    return { cleaned: true, users: userIds.length, packs: packs.length, objects: uniqueObjectKeys.length };
  }

  private requireSmokeRuntime(token: string | undefined): void {
    const expected = this.config.get<string>('SMOKE_TEST_CLEANUP_TOKEN');
    const databaseUrl = this.config.get<string>('DATABASE_URL');
    const smokeFlagsValid = this.config.get<string>('OUR_COMPANION_SMOKE_TEST') === '1'
      && this.config.get<string>('SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS') === '1'
      && this.config.get<string>('SMOKE_TEST_DATABASE') === '1';
    let suspiciousDatabase = true;
    try {
      const database = new URL(databaseUrl ?? '');
      suspiciousDatabase = /(production|prod|primary|live)/.test(`${database.hostname}${database.pathname}`.toLowerCase())
        && this.config.get<string>('SMOKE_TEST_DATABASE_CONFIRMED') !== '1';
    } catch {
      suspiciousDatabase = true;
    }
    if (!smokeFlagsValid || suspiciousDatabase || !expected || !token || token !== expected) {
      throw new NotFoundException();
    }
  }
}
