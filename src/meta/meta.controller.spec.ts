import { MetaController } from './meta.controller';

describe('MetaController', () => {
  it('includes sanitized Visit timing only while Visit capability is enabled', () => {
    const controller = new MetaController({
      protocolVersion: '0.3', minimumClientVersion: '0.3.0',
      features: { visitSessions: true, visitInvitations: true, visualVisits: false },
      visitRuntimeConfig: { heartbeatIntervalSeconds: 5, heartbeatTimeoutSeconds: 30 },
      isCompatible: () => ({ compatible: true }),
      storageCapability: { configured: true },
    } as never);
    expect(controller.compatibility('0.3.0', '0.3')).toMatchObject({ compatible: true, visit: { heartbeatIntervalSeconds: 5, heartbeatTimeoutSeconds: 30 } });
  });
});
