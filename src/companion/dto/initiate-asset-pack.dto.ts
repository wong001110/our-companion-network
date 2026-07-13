import { IsInt, IsObject, IsString, Min } from 'class-validator';

export class InitiateAssetPackDto {
  @IsInt() schemaVersion: number;
  @IsString() manifestHash: string;
  @IsInt() @Min(1) totalFiles: number;
  @IsInt() @Min(1) totalBytes: number;
  @IsObject() manifest: Record<string, unknown>;
}
