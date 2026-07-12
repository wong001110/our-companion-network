import { IsString, IsOptional } from 'class-validator';

export class FriendRequestDto {
  @IsString()
  receiverId: string;

  @IsString()
  @IsOptional()
  message?: string;
}
