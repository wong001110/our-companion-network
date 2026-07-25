import { Module } from '@nestjs/common';
import { CommonModule } from '../common/common.module';
import { VisitSocialController } from './visit-social.controller';
import { VisitSocialService } from './visit-social.service';

@Module({
  imports: [CommonModule],
  controllers: [VisitSocialController],
  providers: [VisitSocialService],
  exports: [VisitSocialService],
})
export class VisitSocialModule {}
