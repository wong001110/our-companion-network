import {
  IsDateString,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { SortedPagePaginationDto } from '../../common/dto/pagination.dto';

export class AdminListQueryDto extends SortedPagePaginationDto {
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

export class AdminReasonDto {
  @IsString()
  @MinLength(4)
  @MaxLength(500)
  reason: string;
}
