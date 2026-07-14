import { Body, Controller, NotFoundException, Post } from '@nestjs/common';
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
  async cleanup(@Body() dto: SmokeCleanupDto) {
    this.requireSmokeRuntime();
    const suffix = `-s5-${dto.runId}@example.invalid`;
    const users = await this.prisma.user.findMany({ where: { email: { endsWith: suffix } }, select: { id: true } });
    const userIds = users.map((user) => user.id);
    if (!userIds.length) return { cleaned: true, users: 0 };
    const packs = await this.prisma.companionAssetPack.findMany({ where: { companion: { ownerUserId: { in: userIds } } }, include: { files: { select: { objectKey: true } } } });
    const objectKeys = packs.flatMap((pack) => pack.files.map((file) => file.objectKey));
    if (objectKeys.length) await this.storage.deleteObjects(objectKeys);
    await this.prisma.$transaction(async (tx) => {
      const companionIds = (await tx.networkCompanion.findMany({ where: { ownerUserId: { in: userIds } }, select: { id: true } })).map((companion) => companion.id);
      await tx.user.updateMany({ where: { id: { in: userIds } }, data: { activeNetworkCompanionId: null } });
      await tx.networkCompanion.updateMany({ where: { id: { in: companionIds } }, data: { activeAssetPackId: null } });
      await tx.visitSession.deleteMany({ where: { OR: [{ visitorOwnerUserId: { in: userIds } }, { hostUserId: { in: userIds } }, { networkCompanionId: { in: companionIds } }] } });
      await tx.visitInvitation.deleteMany({ where: { OR: [{ visitorOwnerUserId: { in: userIds } }, { hostUserId: { in: userIds } }, { networkCompanionId: { in: companionIds } }] } });
      await tx.networkCompanion.deleteMany({ where: { id: { in: companionIds } } });
      await tx.user.deleteMany({ where: { id: { in: userIds } } });
    });
    return { cleaned: true, users: userIds.length };
  }

  private requireSmokeRuntime(): void {
    if (this.config.get<string>('OUR_COMPANION_SMOKE_TEST') !== '1' || this.config.get<string>('SMOKE_TEST_ALLOW_DESTRUCTIVE_ENDPOINTS') !== '1') {
      throw new NotFoundException();
    }
  }
}
