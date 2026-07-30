from pathlib import Path

path = Path('src/portal/portal.service.spec.ts')
source = path.read_text(encoding='utf-8')

first_old = '''      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      discovery: cursorModel([]),'''
first_new = '''      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      companionRelationship: cursorModel([]),
      discovery: cursorModel([]),'''
if source.count(first_old) != 1:
    raise SystemExit(f'expected first portal export fixture anchor once, found {source.count(first_old)}')
source = source.replace(first_old, first_new, 1)

second_old = '''      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      notification: cursorModel([{'''
second_new = '''      visitInvitation: cursorModel([]),
      visitSession: cursorModel([]),
      companionRelationship: cursorModel([]),
      notification: cursorModel([{'''
if source.count(second_old) != 1:
    raise SystemExit(f'expected nested export fixture anchor once, found {source.count(second_old)}')
source = source.replace(second_old, second_new, 1)

path.write_text(source, encoding='utf-8')
