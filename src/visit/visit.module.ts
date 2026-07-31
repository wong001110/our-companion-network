import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { StorageModule } from '../storage/storage.module';
import { VisitInvitationController, VisitSessionController } from './visit.controller';
import { VisitRoomController } from './visit-room.controller';
import { VisitRoomService } from './visit-room.service';
import { VisitService } from './visit.service';

@Module({ imports: [CommonModule, StorageModule], controllers: [VisitInvitationController, VisitSessionController, VisitRoomController], providers: [VisitService, VisitRoomService], exports: [VisitService, VisitRoomService] })
export class VisitModule {}
