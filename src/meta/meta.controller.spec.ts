import { MetaController } from './meta.controller';

describe('MetaController', () => {
  it('includes sanitized Visit timing only while Visit capability is enabled', () => {
    const controller = new MetaController({
      protocolVersion: '0.4', minimumClientVersion: '0.4.0',
      features: { visitSessions: true, visitInvitations: true, visualVisits: true },
      visitRuntimeConfig: { heartbeatIntervalSeconds: 5, heartbeatTimeoutSeconds: 30 },
      isCompatible: () => ({ compatible: true }),
      storageCapability: { configured: true },
    } as never);
    expect(controller.compatibility('0.4.0', '0.4')).toMatchObject({ compatible: true, visit: { heartbeatIntervalSeconds: 5, heartbeatTimeoutSeconds: 30 } });
  });
});
