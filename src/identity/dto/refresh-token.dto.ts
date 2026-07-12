import { IsString, IsUUID } from 'class-validator';

export class RefreshTokenDto {
  @IsString()
  refreshToken: string;

  @IsUUID()
  deviceId: string;
}
