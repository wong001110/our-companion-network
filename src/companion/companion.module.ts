import { Module } from '@nestjs/common';
import { CompanionService } from './companion.service';
import { AssetPackController, CompanionController, FriendCompanionController } from './companion.controller';

@Module({ controllers: [CompanionController, AssetPackController, FriendCompanionController], providers: [CompanionService] })
export class CompanionModule {}
