import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, Max, Min } from 'class-validator';

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

export enum SortDirection {
  ASC = 'asc',
  DESC = 'desc',
}

export class PagePaginationDto {
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page: number = 1;

  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(MAX_PAGE_SIZE)
  limit: number = DEFAULT_PAGE_SIZE;
}

export class SortedPagePaginationDto extends PagePaginationDto {
  @IsOptional()
  @IsEnum(SortDirection)
  direction: SortDirection = SortDirection.DESC;
}
