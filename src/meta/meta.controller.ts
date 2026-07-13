import { Controller, Get, Headers } from '@nestjs/common';
import { Public } from '../common/decorators/public.decorator';
import { ProtocolConfigService } from '../common/protocol-config.service';

@Controller('meta')
@Public()
export class MetaController {
  constructor(private readonly protocolConfig: ProtocolConfigService) {}
  @Get('health')
  health() {
    return { status: 'ok', protocolVersion: this.protocolConfig.protocolVersion };
  }

  @Get('protocol')
  protocol() {
    return {
      protocolVersion: this.protocolConfig.protocolVersion,
      minimumClientVersion: this.protocolConfig.minimumClientVersion,
      serverVersion: this.protocolConfig.serverVersion,
      features: this.protocolConfig.features,
      storage: this.protocolConfig.storageCapability,
    };
  }

  @Get('client-compatibility')
  compatibility(@Headers('x-our-companion-client-version') clientVersion?: string, @Headers('x-our-companion-protocol-version') protocolVersion?: string) {
    const result = this.protocolConfig.isCompatible(clientVersion, protocolVersion);
    return {
      compatible: result.compatible,
      protocolVersion: this.protocolConfig.protocolVersion,
      minimumClientVersion: this.protocolConfig.minimumClientVersion,
      features: this.protocolConfig.features,
      visit: this.protocolConfig.features.visitSessions ? this.protocolConfig.visitRuntimeConfig : undefined,
      reason: result.reason,
    };
  }
}
