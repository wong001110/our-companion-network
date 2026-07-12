import { Module } from '@nestjs/common';
import { PresenceService } from './presence.service';
import { CommonModule } from '../common/common.module';
import { PresenceGateway } from './presence.gateway';
import { PresenceController } from './presence.controller';

@Module({
  imports: [CommonModule],
  controllers: [PresenceController],
  providers: [PresenceService, PresenceGateway],
  exports: [PresenceService, PresenceGateway],
})
export class PresenceModule {}
