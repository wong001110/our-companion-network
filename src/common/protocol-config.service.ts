import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { StorageCapability, StorageService } from '../storage/storage.service';
import { VisitConfigService } from './visit-config.service';

@Injectable()
export class ProtocolConfigService {
  readonly protocolVersion: string;
  readonly minimumClientVersion: string;
  readonly serverVersion: string;
  readonly baseFeatures = {
    authentication: true,
    sockets: true,
    friends: true,
    presence: true,
    visitInvitations: true,
    visitSessions: true,
    visualVisits: false,
  } as const;

  constructor(config: ConfigService, private readonly storage?: StorageService, private readonly visits: VisitConfigService = new VisitConfigService(config)) {
    this.protocolVersion = config.get<string>('PROTOCOL_VERSION', '0.3');
    this.minimumClientVersion = config.get<string>('MINIMUM_CLIENT_VERSION', '0.3.0');
    this.serverVersion = config.get<string>('SERVER_VERSION', '0.3.0');
  }

  get storageCapability(): StorageCapability {
    return this.storage?.capability ?? { configured: false, provider: 'cloudflare_r2', uploadsEnabled: false, downloadsEnabled: false };
  }

  get features() {
    const enabled = this.storageCapability.uploadsEnabled && this.storageCapability.downloadsEnabled;
    return { ...this.baseFeatures, publicCompanions: enabled, assetPacks: enabled, visitInvitations: enabled, visitSessions: enabled } as const;
  }

  get visitRuntimeConfig() {
    const limits = this.visits.limits;
    return { heartbeatIntervalSeconds: limits.heartbeatIntervalSeconds, heartbeatTimeoutSeconds: limits.heartbeatTimeoutSeconds };
  }

  isCompatible(clientVersion?: string, protocolVersion?: string): { compatible: boolean; reason?: string } {
    if (protocolVersion && protocolVersion !== this.protocolVersion) return { compatible: false, reason: 'UNSUPPORTED_PROTOCOL_VERSION' };
    if (clientVersion && !this.atLeast(clientVersion, this.minimumClientVersion)) return { compatible: false, reason: 'CLIENT_VERSION_TOO_OLD' };
    return { compatible: true };
  }

  private atLeast(actual: string, minimum: string): boolean {
    const a = actual.split('.').map(Number);
    const b = minimum.split('.').map(Number);
    return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
  }
}
