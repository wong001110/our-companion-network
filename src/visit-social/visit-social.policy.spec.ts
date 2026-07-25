import { assertNextVisitTurn, assertSharedMomentEligible, sanitizeVisitShareEnvelope, VISIT_SOCIAL_MAX_TURNS } from './visit-social.policy';

describe('Visit social policy', () => {
  it('sanitizes the approved Discovery copy and limits tags', () => {
    expect(sanitizeVisitShareEnvelope({
      title: '  Quiet   music  ',
      summary: '  A calm   collection for late work. ',
      tags: ['music', 'music', 'focus', 'night', 'calm', 'extra'],
    })).toEqual({
      kind: 'discovery',
      title: 'Quiet music',
      summary: 'A calm collection for late work.',
      tags: ['music', 'focus', 'night', 'calm', 'extra'],
    });
  });

  it('requires the visiting owner to take the first turn', () => {
    expect(() => assertNextVisitTurn({
      senderUserId: 'host',
      visitorOwnerUserId: 'owner',
      currentTurnCount: 0,
    })).toThrow('VISIT_TURN_OWNER_START_REQUIRED');
  });

  it('rejects consecutive turns from the same participant', () => {
    expect(() => assertNextVisitTurn({
      senderUserId: 'owner',
      visitorOwnerUserId: 'owner',
      lastSenderUserId: 'owner',
      currentTurnCount: 1,
    })).toThrow('VISIT_TURN_ORDER_INVALID');
  });

  it('enforces the bounded turn limit', () => {
    expect(() => assertNextVisitTurn({
      senderUserId: 'host',
      visitorOwnerUserId: 'owner',
      lastSenderUserId: 'owner',
      currentTurnCount: VISIT_SOCIAL_MAX_TURNS,
    })).toThrow('VISIT_TURN_LIMIT_REACHED');
  });

  it('does not create Shared Moments for cancelled or empty Visits', () => {
    expect(() => assertSharedMomentEligible('cancelled', 2)).toThrow('VISIT_SESSION_NOT_COMPLETED');
    expect(() => assertSharedMomentEligible('failed', 2)).toThrow('VISIT_SESSION_NOT_COMPLETED');
    expect(() => assertSharedMomentEligible('ended', 0)).toThrow('VISIT_SHARED_MOMENT_EMPTY');
    expect(() => assertSharedMomentEligible('ended', 1)).not.toThrow();
  });
});
