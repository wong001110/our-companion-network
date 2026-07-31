from pathlib import Path

path = Path('src/portal/portal-storage-deletion.spec.ts')
source = path.read_text(encoding='utf-8')
old_sessions = "      visitSession: { deleteMany: jest.fn(), updateMany: jest.fn() },"
new_sessions = "      visitSession: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), updateMany: jest.fn() },"
old_invitations = "      visitInvitation: { deleteMany: jest.fn(), updateMany: jest.fn() },"
new_invitations = "      visitInvitation: { findMany: jest.fn().mockResolvedValue([]), deleteMany: jest.fn(), updateMany: jest.fn() },\n      visitReservation: { deleteMany: jest.fn().mockResolvedValue({ count: 0 }) },\n      visitSessionParticipant: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },\n      visitJoinRequest: { updateMany: jest.fn().mockResolvedValue({ count: 0 }) },"
if source.count(old_sessions) != 3:
    raise SystemExit(f'expected 3 Visit Session deletion fixtures, found {source.count(old_sessions)}')
if source.count(old_invitations) != 3:
    raise SystemExit(f'expected 3 Visit Invitation deletion fixtures, found {source.count(old_invitations)}')
source = source.replace(old_sessions, new_sessions)
source = source.replace(old_invitations, new_invitations)
path.write_text(source, encoding='utf-8')
