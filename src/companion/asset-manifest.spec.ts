import { createHash } from 'node:crypto';
import { canonicalJsonStringify, canonicalManifest, validateManifest, type CompanionAssetManifestV1 } from './asset-manifest';

const hash = (value: unknown) => createHash('sha256').update(canonicalJsonStringify(value), 'utf8').digest('hex');
const limits = { maxFileBytes: 100, maxPackBytes: 500, maxPackFiles: 10 };
function manifest(): CompanionAssetManifestV1 {
  const files = ['Idle_Neutral', 'Enter', 'Leave'].map(name => ({ relativePath: `assets/animations/${name}.png`, category: 'animation' as const, mimeType: 'image/png', sizeBytes: 1, sha256: 'a'.repeat(64) }));
  return { format: 'our-companion-asset-pack', schemaVersion: 1, runtime: { defaultAnimation: 'Idle_Neutral', animations: ['Leave', 'Enter', 'Idle_Neutral'].map(name => ({ name, format: 'sprite_sheet' as const, files: [`assets/animations/${name}.png`], frameWidth: 300, frameHeight: 300, frameCount: 1, frameDurationMs: 180, loop: name === 'Idle_Neutral' })) }, files };
}

describe('Asset Pack manifest validation', () => {
  it('canonicalizes deterministic content regardless of supplied order', () => {
    const input = manifest();
    const expected = hash(canonicalManifest(input));
    const result = validateManifest(input, expected, limits);
    expect(result.totalBytes).toBe(3);
    expect(result.canonicalJson).toBe(canonicalJsonStringify(canonicalManifest(input)));
  });
  it.each([
    ['assets/animations/../idle.png'],
    ['/assets/animations/idle.png'],
    ['assets/animations/idle.svg'],
    ['assets\\animations\\idle.png'],
  ])('rejects unsafe or unsupported paths: %s', (relativePath) => {
    const input = manifest(); input.files[0].relativePath = relativePath;
    expect(() => validateManifest(input, 'a'.repeat(64), limits)).toThrow('Asset pack');
  });
  it('rejects case-colliding files and a missing required mapping', () => {
    const input = manifest(); input.files.push({ ...input.files[0], relativePath: 'assets/animations/idle_neutral.png' });
    expect(() => validateManifest(input, 'a'.repeat(64), limits)).toThrow();
    const missing = manifest(); missing.runtime.animations = missing.runtime.animations.filter(animation => animation.name !== 'Leave');
    expect(() => validateManifest(missing, 'a'.repeat(64), limits)).toThrow();
  });
  it('rejects missing or invalid sprite timing', () => {
    const missing = manifest(); delete missing.runtime.animations[0].frameDurationMs;
    expect(() => validateManifest(missing, hash(missing), limits)).toThrow('sprite metadata');
    const invalid = manifest(); invalid.runtime.animations[0].frameDurationMs = 0;
    expect(() => validateManifest(invalid, hash(invalid), limits)).toThrow('sprite metadata');
  });
});
