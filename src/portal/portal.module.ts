import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { CompanionModule } from '../companion/companion.module';
import { IdentityModule } from '../identity/identity.module';
import { BrowserAuthController } from './browser-auth.controller';
import { BrowserAuthService } from './browser-auth.service';
import { PortalController } from './portal.controller';
import { PortalService } from './portal.service';
import { AdminModule } from '../admin/admin.module';
import { StorageModule } from '../storage/storage.module';
import { AccountDeletionCleanupService } from './account-deletion-cleanup.service';

@Module({
  imports: [
    CommonModule,
    IdentityModule,
    CompanionModule,
    AdminModule,
    StorageModule,
  ],
  controllers: [BrowserAuthController, PortalController],
  providers: [
    BrowserAuthService,
    PortalService,
    AccountDeletionCleanupService,
  ],
  exports: [BrowserAuthService, PortalService],
})
export class PortalModule {}
