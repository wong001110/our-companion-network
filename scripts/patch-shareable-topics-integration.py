from pathlib import Path

path = Path('scripts/apply-shareable-topics-random-visits.py')
source = path.read_text(encoding='utf-8')
old = '''# Export shareable topics in the user's data export.
replace_once(
    'src/portal/portal.service.ts',
    ''' + "'''    yield ',\"companionAssetPacks\":';'''" + ''',
    ''' + "'''    yield ',\"shareableTopics\":';
    yield* this.streamExportArray((cursor) => this.prisma.shareableTopic.findMany({
      where: { companion: { ownerUserId: userId } },
      ...exportCursorPage(cursor),
    }));
    yield ',\"companionAssetPacks\":';'''" + ''',
)
'''
new = '''# Export shareable topics in the user's data export.
replace_once(
    'src/portal/portal.service.ts',
    ''' + "'''    yield ',\"notifications\":';'''" + ''',
    ''' + "'''    yield ',\"shareableTopics\":';
    yield* this.streamExportArray((cursor) => this.prisma.shareableTopic.findMany({
      where: { companion: { ownerUserId: userId } },
      ...exportCursorPage(cursor),
    }));
    yield ',\"notifications\":';'''" + ''',
)
'''
if old not in source:
    raise SystemExit('Shareable Topics export integration block not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
