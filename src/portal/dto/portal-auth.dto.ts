import {
  Equals,
  IsEmail,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';

export class PortalLoginDto {
  @IsEmail()
  email: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  password: string;
}

export class ChangePasswordDto {
  @IsString()
  @MinLength(8)
  @MaxLength(128)
  currentPassword: string;

  @IsString()
  @MinLength(8)
  @MaxLength(128)
  newPassword: string;
}

export class PortalDataDeleteDto {
  @IsString()
  @Equals('DELETE')
  confirmation: 'DELETE';
}

export class PortalAccountDeleteDto {
  @IsString()
  @Equals('DELETE MY ACCOUNT')
  confirmation: 'DELETE MY ACCOUNT';
}
