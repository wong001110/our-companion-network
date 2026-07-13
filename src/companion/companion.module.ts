import { Module } from '@nestjs/common';
import { CompanionService } from './companion.service';
import { CompanionCleanupService } from './companion-cleanup.service';
import { AssetPackController, CompanionController, FriendCompanionController } from './companion.controller';

@Module({ controllers: [CompanionController, AssetPackController, FriendCompanionController], providers: [CompanionService, CompanionCleanupService] })
export class CompanionModule {}
