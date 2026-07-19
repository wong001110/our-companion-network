import 'reflect-metadata';
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE, SortDirection } from './dto/pagination.dto';
import { boundedPage, pageEnvelope, stableOrderBy } from './pagination';

describe('bounded pagination contract', () => {
  it('uses safe defaults and caps programmatic callers at the shared maximum', () => {
    expect(boundedPage()).toEqual({
      page: 1,
      limit: DEFAULT_PAGE_SIZE,
      skip: 0,
      take: DEFAULT_PAGE_SIZE,
    });
    expect(boundedPage({ page: 3, limit: MAX_PAGE_SIZE + 500 })).toEqual({
      page: 3,
      limit: MAX_PAGE_SIZE,
      skip: MAX_PAGE_SIZE * 2,
      take: MAX_PAGE_SIZE,
    });
  });

  it('always adds an ID tie-breaker to non-ID sorting', () => {
    expect(stableOrderBy('createdAt', SortDirection.DESC)).toEqual([
      { createdAt: 'desc' },
      { id: 'desc' },
    ]);
    expect(stableOrderBy('id', SortDirection.ASC)).toEqual([{ id: 'asc' }]);
  });

  it('returns a stable page envelope', () => {
    expect(pageEnvelope(['a'], 21, { page: 2, limit: 10 })).toEqual({
      items: ['a'],
      pagination: { page: 2, limit: 10, total: 21, totalPages: 3 },
    });
  });
});
