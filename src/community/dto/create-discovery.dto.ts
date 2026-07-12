import { IsString, IsObject, IsOptional } from 'class-validator';

export class CreateDiscoveryDto {
  @IsString()
  title: string;

  @IsString()
  @IsOptional()
  description?: string;

  @IsObject()
  metadata: Record<string, any>;
}
