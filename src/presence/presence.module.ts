import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { CommonModule } from '../common/common.module';
import { PresenceGateway } from './presence.gateway';

@Module({
  imports: [CommonModule],
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService],
})
export class PresenceModule {}
