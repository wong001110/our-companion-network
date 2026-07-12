import { Controller, Get, Headers } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';

const PROTOCOL_VERSION = '0.1';
const MINIMUM_CLIENT_VERSION = '0.1.0';
const SERVER_VERSION = '0.1.0';

@Controller('meta')
@Public()
export class MetaController {
  @Get('health')
  health() {
    return { status: 'ok', protocolVersion: PROTOCOL_VERSION };
  }

  @Get('protocol')
  protocol() {
    return {
      protocolVersion: PROTOCOL_VERSION,
      minimumClientVersion: MINIMUM_CLIENT_VERSION,
      serverVersion: SERVER_VERSION,
      features: {
        authentication: true,
        socketConnection: true,
        friends: false,
        presence: false,
        publicCompanions: false,
        assetPacks: false,
        visitInvitations: false,
        visitSessions: false,
      },
    };
  }

  @Get('client-compatibility')
  compatibility(@Headers('x-our-companion-client-version') clientVersion?: string, @Headers('x-our-companion-protocol-version') protocolVersion?: string) {
    const protocolCompatible = !protocolVersion || protocolVersion === PROTOCOL_VERSION;
    const clientCompatible = !clientVersion || this.atLeast(clientVersion, MINIMUM_CLIENT_VERSION);
    return {
      compatible: protocolCompatible && clientCompatible,
      protocolVersion: PROTOCOL_VERSION,
      minimumClientVersion: MINIMUM_CLIENT_VERSION,
      reason: protocolCompatible ? (clientCompatible ? undefined : 'CLIENT_VERSION_TOO_OLD') : 'UNSUPPORTED_PROTOCOL_VERSION',
    };
  }

  private atLeast(actual: string, minimum: string): boolean {
    const a = actual.split('.').map(Number);
    const b = minimum.split('.').map(Number);
    return a[0] > b[0] || (a[0] === b[0] && (a[1] > b[1] || (a[1] === b[1] && a[2] >= b[2])));
  }
}
