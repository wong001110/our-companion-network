import { Module } from '@nestjs/common';
import { DeveloperDebugService } from './developer-debug.service';
import { DeveloperDebugController } from './developer-debug.controller';
import { AdminModule } from '../admin/admin.module';

@Module({
  imports: [AdminModule],
  controllers: [DeveloperDebugController],
  providers: [DeveloperDebugService],
  exports: [DeveloperDebugService],
})
export class DeveloperDebugModule {}
