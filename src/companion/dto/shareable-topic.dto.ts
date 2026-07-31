import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsISO8601, IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class UpsertShareableTopicDto {
  @IsString() @MaxLength(120) title: string;
  @IsString() @MaxLength(600) summary: string;
  @IsOptional() @IsArray() @ArrayMaxSize(8) @IsString({ each: true }) @MaxLength(30, { each: true }) tags?: string[];
  @IsOptional() @IsUrl({ require_protocol: true, protocols: ['https'] }) @MaxLength(2000) sourceUrl?: string;
  @IsOptional() @IsIn(['friends']) audience?: 'friends';
  @IsOptional() @IsIn(['summary_only', 'summary_and_source']) shareScope?: 'summary_only' | 'summary_and_source';
  @IsOptional() @IsBoolean() allowRecipientSave?: boolean;
  @IsOptional() @IsBoolean() eligibleForRandomVisit?: boolean;
  @IsOptional() @IsISO8601() expiresAt?: string;
}

export class UpdateCompanionSocialPolicyDto {
  @IsOptional() @IsBoolean() randomVisitsEnabled?: boolean;
  @IsOptional() @IsIn(['friends']) randomVisitAudience?: 'friends';
  @IsOptional() @IsBoolean() allowJoinRequests?: boolean;
}
