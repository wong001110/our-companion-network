import { Type } from 'class-transformer';
import {
  IsArray,
  IsDateString,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';

export class BatchIngestEventDto {
  @IsString()
  @IsNotEmpty()
  @MaxLength(128)
  clientEventId: string;

  @IsString()
  @IsNotEmpty()
  @MaxLength(64)
  kind: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  operation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  model?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  companionId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  correlationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cycleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  turnId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(512)
  summary?: string;

  @IsNotEmpty()
  payload: Record<string, unknown>;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  errorCode?: string;

  @IsOptional()
  @IsString()
  @MaxLength(1000)
  errorMessage?: string;

  @IsDateString()
  clientCreatedAt: string;
}

export class BatchIngestBodyDto {
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => BatchIngestEventDto)
  events: BatchIngestEventDto[];
}

export enum DebugEventSortField {
  RECEIVED_AT = 'receivedAt',
  CLIENT_CREATED_AT = 'clientCreatedAt',
}

export class AdminDebugEventQueryDto {
  @IsOptional()
  @IsString()
  @MaxLength(256)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cursor?: string;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  limit: number = 50;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  userId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  deviceId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  kind?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  operation?: string;

  @IsOptional()
  @IsString()
  @MaxLength(64)
  status?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  provider?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  correlationId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  cycleId?: string;

  @IsOptional()
  @IsString()
  @MaxLength(128)
  turnId?: string;

  @IsOptional()
  @IsDateString()
  from?: string;

  @IsOptional()
  @IsDateString()
  to?: string;

  @IsOptional()
  @IsEnum(DebugEventSortField)
  sortBy: DebugEventSortField = DebugEventSortField.RECEIVED_AT;

  @IsOptional()
  @IsEnum(['asc', 'desc'])
  sortDir: 'asc' | 'desc' = 'desc';
}
