import { Module } from '@nestjs/common';
import { VisitController } from './visit.controller';
import { VisitService } from './visit.service';
import { VisitGateway } from './visit.gateway';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [PresenceModule],
  controllers: [VisitController],
  providers: [VisitService, VisitGateway],
  exports: [VisitService],
})
export class VisitModule {}
