import { describe, expect, it } from 'vitest';
import {
  chooseCompanionPassport,
} from './CompanionPage';
import { inspectionCount } from './admin/AdminAssetsPage';

function companion(
  id: string,
  options: { active?: boolean; published?: boolean } = {},
) {
  return {
    id,
    name: id,
    publicDescription: null,
    publicTags: [],
    visibility: 'friends_only',
    published: options.published ?? false,
    isActive: options.active ?? false,
    activeAssetPackId: null,
    publishedAt: null,
    createdAt: '2026-07-19T00:00:00.000Z',
    updatedAt: '2026-07-19T00:00:00.000Z',
  };
}

describe('Portal acceptance regressions', () => {
  it('prefers an explicit selection, then the active or published passport', () => {
    const rows = [
      companion('private'),
      companion('published', { published: true }),
      companion('active', { active: true }),
    ];

    expect(chooseCompanionPassport(rows, null)?.id).toBe('active');
    expect(chooseCompanionPassport(rows, 'private')?.id).toBe('private');
    expect(chooseCompanionPassport(rows.slice(0, 2), null)?.id)
      .toBe('published');
  });

  it('counts R2 mismatch arrays instead of coercing them as numbers', () => {
    expect(inspectionCount([])).toBe(0);
    expect(inspectionCount(['a.png', 'b.png'])).toBe(2);
    expect(inspectionCount(null)).toBe(0);
  });
});
