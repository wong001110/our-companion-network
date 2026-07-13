import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { StorageModule } from '../storage/storage.module';
import { VisitInvitationController, VisitSessionController } from './visit.controller';
import { VisitService } from './visit.service';

@Module({ imports: [CommonModule, StorageModule], controllers: [VisitInvitationController, VisitSessionController], providers: [VisitService], exports: [VisitService] })
export class VisitModule {}
