import {
  DEFAULT_PAGE_SIZE,
  MAX_PAGE_SIZE,
  PagePaginationDto,
  SortDirection,
} from './dto/pagination.dto';

export interface BoundedPage {
  page: number;
  limit: number;
  skip: number;
  take: number;
}

export interface PageEnvelope<T> {
  items: T[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export type StableOrderBy = Array<Record<string, SortDirection>>;

export function boundedPage(input: Partial<PagePaginationDto> = {}): BoundedPage {
  const page = Number.isSafeInteger(input.page) && Number(input.page) > 0
    ? Number(input.page)
    : 1;
  const requestedLimit = Number.isSafeInteger(input.limit) && Number(input.limit) > 0
    ? Number(input.limit)
    : DEFAULT_PAGE_SIZE;
  const limit = Math.min(requestedLimit, MAX_PAGE_SIZE);
  return { page, limit, skip: (page - 1) * limit, take: limit };
}

/**
 * Every list receives an ID tie-breaker so records cannot jump between pages
 * when the primary sort field has equal values.
 */
export function stableOrderBy(
  field: string,
  direction: SortDirection = SortDirection.DESC,
): StableOrderBy {
  return field === 'id'
    ? [{ id: direction }]
    : [{ [field]: direction }, { id: direction }];
}

export function pageEnvelope<T>(
  items: T[],
  total: number,
  page: Pick<BoundedPage, 'page' | 'limit'>,
): PageEnvelope<T> {
  return {
    items,
    pagination: {
      page: page.page,
      limit: page.limit,
      total,
      totalPages: Math.ceil(total / page.limit),
    },
  };
}
