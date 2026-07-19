import { Module } from '@nestjs/common';
import { CompanionService } from './companion.service';
import { CompanionCleanupService } from './companion-cleanup.service';
import { AssetPackController, CompanionController, FriendCompanionController } from './companion.controller';
import { CommonModule } from '../common/common.module';
import { VisitModule } from '../visit/visit.module';

@Module({ imports: [CommonModule, VisitModule], controllers: [CompanionController, AssetPackController, FriendCompanionController], providers: [CompanionService, CompanionCleanupService], exports: [CompanionService] })
export class CompanionModule {}
