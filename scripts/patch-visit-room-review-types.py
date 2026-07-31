from pathlib import Path

path = Path('src/visit/visit.service.ts')
source = path.read_text(encoding='utf-8')
old = "    result.displacedInvitations.forEach((invitation) => this.publishInvitation({ ...invitation, status: 'declined' }, 'visit.invitation.updated'));"
new = "    result.displacedInvitations.forEach((invitation) => this.publishInvitation(invitation, 'visit.invitation.updated'));"
if old not in source:
    raise SystemExit('displaced invitation publish anchor not found')
path.write_text(source.replace(old, new, 1), encoding='utf-8')
