import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

export interface VisitRuntimeLimits {
  invitationTtlHours: number;
  preparationTtlMinutes: number;
  sessionMaxMinutes: number;
  heartbeatIntervalSeconds: number;
  heartbeatTimeoutSeconds: number;
}

@Injectable()
export class VisitConfigService {
  constructor(private readonly config: ConfigService) {}

  get limits(): VisitRuntimeLimits {
    const heartbeatIntervalSeconds = this.positiveInteger('VISIT_HEARTBEAT_INTERVAL_SECONDS', 15, 5, 60);
    // Values below the public recommendation are still parsed so they can be safely clamped.
    const configuredTimeout = this.positiveInteger('VISIT_HEARTBEAT_TIMEOUT_SECONDS', 60, 1, 300);
    const heartbeatTimeoutSeconds = Math.max(30, configuredTimeout, heartbeatIntervalSeconds * 2, heartbeatIntervalSeconds + 5);
    return {
      invitationTtlHours: this.positiveInteger('VISIT_INVITATION_TTL_HOURS', 24, 1, 168),
      preparationTtlMinutes: this.positiveInteger('VISIT_PREPARATION_TTL_MINUTES', 10, 1, 60),
      sessionMaxMinutes: this.positiveInteger('VISIT_SESSION_MAX_MINUTES', 30, 5, 240),
      heartbeatIntervalSeconds,
      heartbeatTimeoutSeconds,
    };
  }

  private positiveInteger(key: string, fallback: number, min: number, max: number): number {
    const value = Number(this.config.get<string>(key, String(fallback)));
    return Number.isSafeInteger(value) && value >= min && value <= max ? value : fallback;
  }
}
