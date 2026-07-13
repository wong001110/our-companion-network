import { ProtocolConfigService } from './protocol-config.service';

describe('ProtocolConfigService', () => {
  const config = (values: Record<string, string> = {}) => ({ get: jest.fn((key: string, fallback: string) => values[key] ?? fallback) });

  it('uses one configured protocol source for compatibility decisions', () => {
    const service = new ProtocolConfigService(config({ PROTOCOL_VERSION: '0.3', MINIMUM_CLIENT_VERSION: '1.4.0', SERVER_VERSION: '7.0.0' }) as never);
    expect(service.protocolVersion).toBe('0.3');
    expect(service.minimumClientVersion).toBe('1.4.0');
    expect(service.isCompatible('1.4.0', '0.3')).toEqual({ compatible: true });
    expect(service.isCompatible('1.3.9', '0.3')).toEqual({ compatible: false, reason: 'CLIENT_VERSION_TOO_OLD' });
    expect(service.isCompatible('1.4.0', '0.1')).toEqual({ compatible: false, reason: 'UNSUPPORTED_PROTOCOL_VERSION' });
  });
});
