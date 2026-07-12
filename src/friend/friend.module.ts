import { Module } from '@nestjs/common';
import { FriendController } from './friend.controller';
import { FriendService } from './friend.service';
import { BlockController } from './block.controller';
import { CommonModule } from '../common/common.module';

@Module({
  imports: [CommonModule],
  controllers: [FriendController, BlockController],
  providers: [FriendService],
  exports: [FriendService],
})
export class FriendModule {}
