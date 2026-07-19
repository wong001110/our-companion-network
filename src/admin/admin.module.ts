import { Module } from '@nestjs/common';
import { AuditService } from './audit.service';
import { AdminRoleService } from './admin-role.service';
import { SuperadminGuard } from './superadmin.guard';
import { CommonModule } from '../common/common.module';
import { StorageModule } from '../storage/storage.module';
import { CompanionModule } from '../companion/companion.module';
import { VisitModule } from '../visit/visit.module';
import { AdminApiService } from './admin-api.service';
import { AdminController } from './admin.controller';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [CommonModule, StorageModule, CompanionModule, VisitModule, PresenceModule],
  controllers: [AdminController],
  providers: [AuditService, AdminRoleService, SuperadminGuard, AdminApiService],
  exports: [AuditService, AdminRoleService, SuperadminGuard],
})
export class AdminModule {}
