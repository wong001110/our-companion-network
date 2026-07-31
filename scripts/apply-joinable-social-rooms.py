from pathlib import Path


def replace_once(path: str, old: str, new: str) -> None:
    file = Path(path)
    source = file.read_text(encoding='utf-8')
    if old not in source:
        raise SystemExit(f'anchor not found: {path}')
    file.write_text(source.replace(old, new, 1), encoding='utf-8')


controller_anchor = '''  @Get('visit-reservation')
  @SocialRateLimit('visit_read')
  reservation(@CurrentUser() user: UserPayload) { return this.rooms.getReservation(user.id); }
'''
replace_once(
    'src/visit/visit-room.controller.ts',
    controller_anchor,
    controller_anchor + '''
  @Get('visit-rooms/joinable')
  @SocialRateLimit('visit_read')
  joinableRooms(@CurrentUser() user: UserPayload) { return this.rooms.listJoinableRooms(user.id); }
''',
)

service_anchor = '  async getRoom(userId: string, sessionId: string) {\n'
service_method = '''  async listJoinableRooms(userId: string) {
    const reservation = await this.prisma.visitReservation.findUnique({ where: { userId }, select: { userId: true } });
    if (reservation) return [];
    const sessions = await this.prisma.visitSession.findMany({
      where: {
        state: { in: ['ready', 'active'] },
        hostNetworkCompanion: { allowJoinRequests: true },
        participants: { none: { userId, state: { not: 'left' } } },
      },
      select: {
        id: true, state: true, hostUserId: true, roomCapacity: true, currentTopicSequence: true, updatedAt: true,
        host: { select: { username: true } },
        hostNetworkCompanion: { select: { id: true, name: true } },
        participants: {
          where: { state: { not: 'left' } },
          select: { userId: true, networkCompanionId: true, role: true, networkCompanion: { select: { name: true } } },
          orderBy: [{ joinedAt: 'asc' }, { id: 'asc' }],
        },
        roomTopics: { where: { state: 'active' }, select: TOPIC_SELECT, orderBy: { sequence: 'asc' }, take: 1 },
      },
      orderBy: { updatedAt: 'desc' },
      take: 20,
    });
    const peerIds = [...new Set(sessions.flatMap((session) => session.participants.map((participant) => participant.userId)).filter((peerId) => peerId !== userId))];
    if (!peerIds.length) return [];
    const [friendships, blocks] = await Promise.all([
      this.prisma.friendship.findMany({ where: { userId, friendId: { in: peerIds } }, select: { friendId: true } }),
      this.prisma.blockedUser.findMany({
        where: { OR: [{ blockerId: userId, blockedId: { in: peerIds } }, { blockerId: { in: peerIds }, blockedId: userId }] },
        select: { blockerId: true, blockedId: true },
      }),
    ]);
    const friendIds = new Set(friendships.map((friendship) => friendship.friendId));
    const blockedIds = new Set(blocks.map((block) => block.blockerId === userId ? block.blockedId : block.blockerId));
    return sessions
      .filter((session) => session.participants.length < session.roomCapacity)
      .filter((session) => session.participants.every((participant) => participant.userId === userId || (friendIds.has(participant.userId) && !blockedIds.has(participant.userId))))
      .map((session) => ({
        sessionId: session.id,
        state: session.state,
        hostUserId: session.hostUserId,
        hostUsername: session.host.username,
        hostNetworkCompanionId: session.hostNetworkCompanion?.id,
        hostCompanionName: session.hostNetworkCompanion?.name,
        roomCapacity: session.roomCapacity,
        participantCount: session.participants.length,
        currentTopicSequence: session.currentTopicSequence,
        participants: session.participants.map((participant) => ({
          userId: participant.userId,
          networkCompanionId: participant.networkCompanionId,
          companionName: participant.networkCompanion.name,
          role: participant.role,
        })),
        activeTopic: session.roomTopics[0] ? this.topicSummary(session.roomTopics[0]) : undefined,
        updatedAt: session.updatedAt.toISOString(),
      }));
  }

'''
replace_once('src/visit/visit-room.service.ts', service_anchor, service_method + service_anchor)

test_anchor = "  it('keeps room assets scoped to active participants', () => {\n"
test_case = '''  it('lists only joinable friend rooms through a sanitized discovery endpoint', () => {
    const controllerSource = readFileSync(join(__dirname, 'visit-room.controller.ts'), 'utf8');
    expect(controllerSource).toContain("@Get('visit-rooms/joinable')");
    expect(roomSource).toContain('listJoinableRooms');
    expect(roomSource).toContain("hostNetworkCompanion: { allowJoinRequests: true }");
    expect(roomSource).toContain('friendIds.has(participant.userId)');
    expect(roomSource).toContain('session.participants.length < session.roomCapacity');
    expect(roomSource).toContain('activeTopic: session.roomTopics[0]');
  });

'''
replace_once('src/visit/visit-room-reservation.spec.ts', test_anchor, test_case + test_anchor)
