import { IsString, IsOptional, IsUUID } from 'class-validator';

export class FriendRequestDto {
  @IsUUID()
  receiverId: string;

  @IsString()
  @IsOptional()
  message?: string;
}
