import {
  parseAdminRoleCliArgs,
  productionConfirmationToken,
  validateEnvironmentConfirmation,
  validateTargetConfirmation,
} from './admin-role.cli';

describe('admin role CLI controls', () => {
  it('requires an explicit target and rejects unknown arguments', () => {
    expect(() => parseAdminRoleCliArgs(['promote'])).toThrow('--uid is required');
    expect(() => parseAdminRoleCliArgs([
      'promote', '--uid', 'OC-ABCDEFGH', '--role', 'SUPERADMIN',
    ])).toThrow('Unknown CLI argument');
  });

  it('normalizes the target and accepts explicit non-interactive confirmation', () => {
    expect(parseAdminRoleCliArgs([
      'demote',
      '--uid', 'oc-abcdefgh',
      '--confirm', 'oc-abcdefgh',
      '--reason', 'Caretaker rotation',
    ])).toMatchObject({
      action: 'demote',
      uid: 'OC-ABCDEFGH',
      confirm: 'OC-ABCDEFGH',
      reason: 'Caretaker rotation',
    });
    expect(() => validateTargetConfirmation('OC-ABCDEFGH', 'oc-abcdefgh'))
      .not.toThrow();
    expect(() => validateTargetConfirmation('OC-ABCDEFGH', 'OC-WRONG123'))
      .toThrow('did not match');
  });

  it('requires both production environment and action-specific confirmation', () => {
    const options = parseAdminRoleCliArgs([
      'promote',
      '--uid', 'OC-ABCDEFGH',
      '--environment', 'production',
      '--confirm-production', productionConfirmationToken('promote', 'OC-ABCDEFGH'),
    ]);
    expect(() => validateEnvironmentConfirmation(options, 'production')).not.toThrow();
    expect(() => validateEnvironmentConfirmation(
      { ...options, confirmProduction: 'wrong' },
      'production',
    )).toThrow('Production requires');
    expect(() => validateEnvironmentConfirmation(
      { ...options, environment: 'staging' },
      'production',
    )).toThrow('explicit flag');
  });
});
