import { IsInt, IsObject, IsString, Matches, Min } from 'class-validator';

export class InitiateAssetPackDto {
  @IsInt() @Min(1) schemaVersion: number;
  @IsString() @Matches(/^[a-f0-9]{64}$/) manifestHash: string;
  @IsInt() @Min(1) totalFiles: number;
  @IsInt() @Min(1) totalBytes: number;
  @IsObject() manifest: Record<string, unknown>;
}
