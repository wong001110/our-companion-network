export const VISIT_SOCIAL_MAX_TURNS = 12;

export const VISIT_SOCIAL_INTENTS = [
  'GREET',
  'ASK',
  'ANSWER',
  'SHARE',
  'REACT',
  'AGREE',
  'DISAGREE',
  'COMFORT',
  'PAUSE',
  'LEAVE',
] as const;

export const VISIT_SOCIAL_EMOTIONS = [
  'neutral',
  'gentle',
  'curious',
  'happy',
  'thoughtful',
  'concerned',
] as const;

export type VisitSocialIntent = (typeof VISIT_SOCIAL_INTENTS)[number];
export type VisitSocialEmotion = (typeof VISIT_SOCIAL_EMOTIONS)[number];

export interface VisitShareEnvelopeInput {
  title: string;
  summary: string;
  tags?: string[];
  sourceUrl?: string;
}

export interface SanitizedVisitShareEnvelope {
  kind: 'discovery';
  title: string;
  summary: string;
  tags: string[];
  sourceUrl?: string;
}

export function sanitizeVisitShareEnvelope(input: VisitShareEnvelopeInput): SanitizedVisitShareEnvelope {
  const title = normalizeText(input.title, 120);
  const summary = normalizeText(input.summary, 600);
  if (!title || !summary) throw new Error('VISIT_SHARE_INVALID');

  const tags = [...new Set((input.tags ?? [])
    .map((tag) => normalizeText(tag, 40))
    .filter(Boolean))]
    .slice(0, 5);

  const sourceUrl = input.sourceUrl?.trim();
  if (sourceUrl && sourceUrl.length > 2_000) throw new Error('VISIT_SHARE_INVALID');

  return {
    kind: 'discovery',
    title,
    summary,
    tags,
    ...(sourceUrl ? { sourceUrl } : {}),
  };
}

export function assertNextVisitTurn(input: {
  senderUserId: string;
  visitorOwnerUserId: string;
  lastSenderUserId?: string;
  currentTurnCount: number;
  maxTurns?: number;
}): void {
  const maxTurns = input.maxTurns ?? VISIT_SOCIAL_MAX_TURNS;
  if (input.currentTurnCount >= maxTurns) throw new Error('VISIT_TURN_LIMIT_REACHED');
  if (!input.lastSenderUserId && input.senderUserId !== input.visitorOwnerUserId) {
    throw new Error('VISIT_TURN_OWNER_START_REQUIRED');
  }
  if (input.lastSenderUserId === input.senderUserId) throw new Error('VISIT_TURN_ORDER_INVALID');
}

export function assertSharedMomentEligible(state: string, turnCount: number): void {
  if (state !== 'ended') throw new Error('VISIT_SESSION_NOT_COMPLETED');
  if (!Number.isInteger(turnCount) || turnCount < 1) throw new Error('VISIT_SHARED_MOMENT_EMPTY');
}

function normalizeText(value: string, maximumLength: number): string {
  return value.replace(/\s+/g, ' ').trim().slice(0, maximumLength);
}
