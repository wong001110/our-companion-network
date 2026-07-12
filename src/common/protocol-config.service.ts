import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

@Injectable()
export class ProtocolConfigService {
  readonly protocolVersion: string;
  readonly minimumClientVersion: string;
  readonly serverVersion: string;
  readonly features = {
    authentication: true,
    socketConnection: true,
    friends: false,
    presence: false,
    publicCompanions: false,
    assetPacks: false,
    visitInvitations: false,
    visitSessions: false,
  } as const;

  constructor(config: ConfigService) {
    this.protocolVersion = config.get<string>('PROTOCOL_VERSION', '0.1');
    this.minimumClientVersion = config.get<string>('MINIMUM_CLIENT_VERSION', '0.1.0');
    this.serverVersion = config.get<string>('SERVER_VERSION', '0.1.0');
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
