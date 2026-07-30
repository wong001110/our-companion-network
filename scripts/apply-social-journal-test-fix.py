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
if old not in source:
    raise SystemExit('portal export fixture anchor not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
