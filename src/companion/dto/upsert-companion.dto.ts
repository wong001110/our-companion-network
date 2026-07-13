import { IsArray, IsOptional, IsString, MaxLength, ArrayMaxSize } from 'class-validator';

export class UpsertCompanionDto {
  @IsString() @MaxLength(60) name: string;
  @IsOptional() @IsString() @MaxLength(500) publicDescription?: string;
  @IsOptional() @IsArray() @ArrayMaxSize(10) @IsString({ each: true }) @MaxLength(30, { each: true }) publicTags?: string[];
}
