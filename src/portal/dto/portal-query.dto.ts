import {
  IsDateString,
  IsEnum,
  IsIn,
  IsOptional,
  IsString,
  MaxLength,
} from 'class-validator';
import {
  PagePaginationDto,
  SortDirection,
  SortedPagePaginationDto,
} from '../../common/dto/pagination.dto';

export class PortalListQueryDto extends SortedPagePaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class FriendRequestQueryDto extends PagePaginationDto {
  @IsOptional()
  @IsString()
  @MaxLength(100)
  search?: string;

  @IsOptional()
  @IsIn(['incoming', 'outgoing'])
  direction: 'incoming' | 'outgoing' = 'incoming';

  @IsOptional()
  @IsEnum(SortDirection)
  sortDirection: SortDirection = SortDirection.DESC;

  @IsOptional()
  @IsString()
  @MaxLength(40)
  status?: string;

  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @IsOptional()
  @IsDateString()
  dateTo?: string;
}

export class PortalVisitQueryDto extends PortalListQueryDto {
  @IsOptional()
  @IsIn(['sessions', 'invitations'])
  kind: 'sessions' | 'invitations' = 'sessions';
}
