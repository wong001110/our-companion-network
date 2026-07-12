import { IsString, Matches } from 'class-validator';

export class FriendCodeDto {
  @IsString()
  @Matches(/^[0-9A-F]{8}$/, { message: 'Friend code must be 8 hexadecimal characters' })
  code: string;
}
