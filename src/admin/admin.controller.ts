import {
  Body,
  Controller,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { UserAccountStatus } from '@prisma/client';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { PortalRateLimitGuard } from '../common/guards/portal-rate-limit.guard';
import { AdminApiService } from './admin-api.service';
import { AdminListQueryDto, AdminReasonDto } from './dto/admin-api.dto';
import { AuditService } from './audit.service';
import { SuperadminGuard } from './superadmin.guard';

@Controller('admin')
@UseGuards(PortalRateLimitGuard, SuperadminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminApiService,
    private readonly audit: AuditService,
  ) {}

  @Get('overview')
  overview() {
    return this.admin.overview();
  }

  @Get('users')
  users(@Query() query: AdminListQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  user(
    @CurrentUser() admin: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
  ) {
    return this.admin.getUser(admin.id, id);
  }

  @Patch('users/:id/suspend')
  suspend(
    @CurrentUser() admin: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.setAccountStatus(
      admin.id,
      id,
      UserAccountStatus.SUSPENDED,
      dto.reason,
    );
  }

  @Patch('users/:id/restore')
  restore(
    @CurrentUser() admin: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.setAccountStatus(
      admin.id,
      id,
      UserAccountStatus.ACTIVE,
      dto.reason,
    );
  }

  @Post('users/:userId/devices/:sessionId/revoke')
  revokeDevice(
    @CurrentUser() admin: UserPayload,
    @Param('userId', ParseUUIDPipe) userId: string,
    @Param('sessionId', ParseUUIDPipe) sessionId: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.revokeDevice(
      admin.id,
      userId,
      sessionId,
      dto.reason,
    );
  }

  @Get('companions')
  companions(@Query() query: AdminListQueryDto) {
    return this.admin.listCompanions(query);
  }

  @Get('companions/:id')
  companion(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getCompanion(id);
  }

  @Post('companions/:id/unpublish')
  unpublishCompanion(
    @CurrentUser() admin: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.unpublishCompanion(admin.id, id, dto.reason);
  }

  @Get('asset-packs')
  assetPacks(@Query() query: AdminListQueryDto) {
    return this.admin.listAssetPacks(query);
  }

  @Get('asset-packs/:id')
  assetPack(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getAssetPack(id);
  }

  @Get('visit-invitations')
  visitInvitations(@Query() query: AdminListQueryDto) {
    return this.admin.listVisitInvitations(query);
  }

  @Post('visit-invitations/:id/cancel')
  cancelVisitInvitation(
    @CurrentUser() admin: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.cancelVisitInvitation(admin.id, id, dto.reason);
  }

  @Get('visit-sessions')
  visitSessions(@Query() query: AdminListQueryDto) {
    return this.admin.listVisitSessions(query);
  }

  @Get('visit-sessions/:id')
  visitSession(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getVisitSession(id);
  }

  @Post('visit-sessions/:id/end')
  endVisitSession(
    @CurrentUser() admin: UserPayload,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.endVisitSession(admin.id, id, dto.reason);
  }

  @Get('system-health')
  systemHealth() {
    return this.admin.systemHealth();
  }

  @Get('audit-logs')
  auditLogs(@Query() query: AdminListQueryDto) {
    return this.audit.list(query);
  }

  @Post('storage/cleanup')
  cleanupStorage(
    @CurrentUser() admin: UserPayload,
    @Body() dto: AdminReasonDto,
  ) {
    return this.admin.cleanupStorage(admin.id, dto.reason);
  }
}
