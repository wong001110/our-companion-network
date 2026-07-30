describe('Companion relationship stage policy', () => {
  const stage = (visits: number) => visits >= 12 ? 'trusted' : visits >= 8 ? 'close' : visits >= 4 ? 'friendly' : visits >= 2 ? 'familiar' : visits >= 1 ? 'acquainted' : 'new';
  it.each([[0, 'new'], [1, 'acquainted'], [2, 'familiar'], [4, 'friendly'], [8, 'close'], [12, 'trusted']])('maps %s visits to %s', (visits, expected) => {
    expect(stage(visits)).toBe(expected);
  });
});
