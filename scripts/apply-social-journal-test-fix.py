from pathlib import Path

path = Path('src/portal/portal.service.spec.ts')
source = path.read_text(encoding='utf-8')
old = '''      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      discovery: cursorModel([]),'''
new = '''      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      companionRelationship: cursorModel([]),
      discovery: cursorModel([]),'''
count = source.count(old)
if count != 2:
    raise SystemExit(f'expected 2 portal export fixture anchors, found {count}')
path.write_text(source.replace(old, new), encoding='utf-8')
