from pathlib import Path

path = Path('scripts/apply-shareable-topics-random-visits.py')
source = path.read_text(encoding='utf-8')
start_marker = "# Export shareable topics in the user's data export.\n"
end_marker = "# ---------------------------------------------------------------------------\n# Portal UI.\n"
start = source.find(start_marker)
end = source.find(end_marker, start)
if start < 0 or end < 0:
    raise SystemExit('Shareable Topics export integration markers not found')
replacement = '''# Export shareable topics in the user's data export.
replace_once(
    'src/portal/portal.service.ts',
    """    yield ',\"notifications\":';""",
    """    yield ',\"shareableTopics\":';
    yield* this.streamExportArray((cursor) => this.prisma.shareableTopic.findMany({
      where: { companion: { ownerUserId: userId } },
      ...exportCursorPage(cursor),
    }));
    yield ',\"notifications\":';""",
)

'''
path.write_text(source[:start] + replacement + source[end:], encoding='utf-8')
