from pathlib import Path

path = Path('src/visit/visit-room.service.ts')
source = path.read_text(encoding='utf-8')
old = "    if (result.changed) await this.publishRoom(result.sessionId, 'visit.participant.joined', { joinRequestId, participantId: result.participant.id });"
new = "    if (result.changed && result.participant) await this.publishRoom(result.sessionId, 'visit.participant.joined', { joinRequestId, participantId: result.participant.id });"
if old not in source:
    raise SystemExit('Visit room result narrowing anchor not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
