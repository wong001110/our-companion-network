from pathlib import Path

path = Path('src/visit/visit-room.service.ts')
source = path.read_text(encoding='utf-8')
source = source.replace("import { randomUUID } from 'node:crypto';\n", '')
source = source.replace("const LIVE_SESSION_STATES = ['preparing', 'ready', 'active', 'ending'];\n", '')
path.write_text(source, encoding='utf-8')
