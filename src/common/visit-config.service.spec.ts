import { VisitConfigService } from './visit-config.service';

describe('VisitConfigService', () => {
  const config = (values: Record<string, string> = {}) => ({ get: jest.fn((key: string, fallback: string) => values[key] ?? fallback) });

  it('uses the safe default cadence', () => {
    expect(new VisitConfigService(config() as never).limits).toMatchObject({ heartbeatIntervalSeconds: 15, heartbeatTimeoutSeconds: 60 });
  });

  it.each([
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: '10', VISIT_HEARTBEAT_TIMEOUT_SECONDS: '45' }, 10, 45],
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: '5', VISIT_HEARTBEAT_TIMEOUT_SECONDS: '6' }, 5, 30],
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: '30', VISIT_HEARTBEAT_TIMEOUT_SECONDS: '40' }, 30, 60],
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: '60', VISIT_HEARTBEAT_TIMEOUT_SECONDS: '100' }, 60, 120],
  ])('clamps configured heartbeat values safely', (values, interval, timeout) => {
    expect(new VisitConfigService(config(values) as never).limits).toMatchObject({ heartbeatIntervalSeconds: interval, heartbeatTimeoutSeconds: timeout });
  });

  it.each([
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: 'NaN' }, 15, 60],
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: '0' }, 15, 60],
    [{ VISIT_HEARTBEAT_INTERVAL_SECONDS: '61' }, 15, 60],
    [{ VISIT_HEARTBEAT_TIMEOUT_SECONDS: 'NaN' }, 15, 60],
    [{ VISIT_HEARTBEAT_TIMEOUT_SECONDS: '301' }, 15, 60],
  ])('falls back for invalid values', (values, interval, timeout) => {
    expect(new VisitConfigService(config(values) as never).limits).toMatchObject({ heartbeatIntervalSeconds: interval, heartbeatTimeoutSeconds: timeout });
  });
});
