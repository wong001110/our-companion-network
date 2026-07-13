import { BadRequestException } from '@nestjs/common';
import { createHash } from 'node:crypto';

export type AssetCategory = 'animation' | 'portrait' | 'icon' | 'voice' | 'metadata';

export interface CompanionAssetManifestV1 {
  format: 'our-companion-asset-pack';
  schemaVersion: 1;
  runtime: {
    defaultAnimation: 'Idle_Neutral';
    portraitPath?: string;
    iconPath?: string;
    animations: Array<{ name: string; format: 'sprite_sheet' | 'frame_sequence' | 'gif' | 'static'; files: string[]; frameWidth?: number; frameHeight?: number; frameCount?: number; fps?: number; loop: boolean }>;
  };
  files: Array<{ relativePath: string; category: AssetCategory; mimeType: string; sizeBytes: number; sha256: string }>;
}

const ALLOWED_EXTENSIONS: Record<string, { mimeType: string; category: AssetCategory[] }> = {
  '.png': { mimeType: 'image/png', category: ['animation', 'portrait', 'icon'] },
  '.jpg': { mimeType: 'image/jpeg', category: ['animation', 'portrait', 'icon'] },
  '.jpeg': { mimeType: 'image/jpeg', category: ['animation', 'portrait', 'icon'] },
  '.webp': { mimeType: 'image/webp', category: ['animation', 'portrait', 'icon'] },
  '.gif': { mimeType: 'image/gif', category: ['animation', 'portrait', 'icon'] },
  '.json': { mimeType: 'application/json', category: ['metadata'] },
  '.mp3': { mimeType: 'audio/mpeg', category: ['voice'] },
  '.wav': { mimeType: 'audio/wav', category: ['voice'] },
  '.ogg': { mimeType: 'audio/ogg', category: ['voice'] },
};

export interface ManifestLimits { maxFileBytes: number; maxPackBytes: number; maxPackFiles: number; }

export function validateManifest(input: unknown, expectedHash: string, limits: ManifestLimits): { manifest: CompanionAssetManifestV1; canonicalJson: string; totalBytes: number } {
  if (!isRecord(input) || input.format !== 'our-companion-asset-pack' || input.schemaVersion !== 1 || !isRecord(input.runtime) || !Array.isArray(input.files)) {
    invalid('Asset pack manifest has an unsupported schema');
  }
  const manifest = input as unknown as CompanionAssetManifestV1;
  if (manifest.runtime.defaultAnimation !== 'Idle_Neutral' || !Array.isArray(manifest.runtime.animations)) invalid('Asset pack runtime is invalid');
  if (!Array.isArray(manifest.files) || manifest.files.length === 0 || manifest.files.length > limits.maxPackFiles) invalid('Asset pack file count exceeds the allowed limit');
  const seen = new Set<string>();
  const paths = new Set<string>();
  let totalBytes = 0;
  for (const file of manifest.files) {
    if (!isRecord(file) || typeof file.relativePath !== 'string' || typeof file.mimeType !== 'string' || typeof file.category !== 'string' || typeof file.sizeBytes !== 'number' || typeof file.sha256 !== 'string') invalid('Asset pack file metadata is invalid');
    const relativePath = normalizeRelativePath(file.relativePath);
    if (relativePath !== file.relativePath) invalid('Asset pack paths must use normalized POSIX paths');
    const lower = relativePath.toLowerCase();
    if (seen.has(lower)) invalid('Asset pack has duplicate or case-colliding paths');
    seen.add(lower); paths.add(relativePath);
    const extension = extensionOf(relativePath);
    const allowed = ALLOWED_EXTENSIONS[extension];
    if (!allowed || !allowed.category.includes(file.category as AssetCategory) || allowed.mimeType !== file.mimeType) invalid('Asset pack file type is not allowed');
    if (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes <= 0 || file.sizeBytes > limits.maxFileBytes) invalid('Asset pack file size exceeds the allowed limit');
    if (!/^[a-f0-9]{64}$/.test(file.sha256)) invalid('Asset pack file hash is invalid');
    totalBytes += file.sizeBytes;
  }
  if (!Number.isSafeInteger(totalBytes) || totalBytes > limits.maxPackBytes) invalid('Asset pack total size exceeds the allowed limit');
  const animationNames = new Set<string>();
  for (const animation of manifest.runtime.animations) {
    if (!isRecord(animation) || typeof animation.name !== 'string' || !['sprite_sheet', 'frame_sequence', 'gif', 'static'].includes(String(animation.format)) || !Array.isArray(animation.files) || typeof animation.loop !== 'boolean') invalid('Asset pack animation mapping is invalid');
    if (animationNames.has(animation.name) || !animation.name) invalid('Asset pack animation names must be unique');
    animationNames.add(animation.name);
    if (!animation.files.length) invalid('Asset pack animation mapping has no files');
    for (const filePath of animation.files) if (typeof filePath !== 'string' || !paths.has(filePath)) invalid('Asset pack animation references an unknown file');
    if (animation.format === 'sprite_sheet') {
      const frameWidth = animation.frameWidth ?? 0; const frameHeight = animation.frameHeight ?? 0; const frameCount = animation.frameCount ?? 0; const fps = animation.fps ?? 0;
      if (!Number.isSafeInteger(frameWidth) || !Number.isSafeInteger(frameHeight) || !Number.isSafeInteger(frameCount) || !Number.isSafeInteger(fps)
        || frameWidth < 300 || frameHeight < 300 || frameWidth > 4096 || frameHeight > 4096
        || frameCount < 1 || frameCount > 120 || fps < 1 || fps > 120) invalid('Asset pack sprite metadata is invalid');
      const file = manifest.files.find(candidate => candidate.relativePath === animation.files[0]);
      if (!file || file.mimeType !== 'image/png') invalid('Asset pack sprite sheet must reference a PNG asset');
    }
  }
  for (const required of ['Idle_Neutral', 'Enter', 'Leave']) if (!animationNames.has(required)) invalid(`Asset pack is missing required ${required} animation`);
  for (const path of [manifest.runtime.portraitPath, manifest.runtime.iconPath]) if (path !== undefined && (!paths.has(path) || normalizeRelativePath(path) !== path)) invalid('Asset pack runtime image reference is invalid');
  const normalized = canonicalManifest(manifest);
  const canonicalJson = canonicalJsonStringify(normalized);
  const actualHash = createHash('sha256').update(canonicalJson, 'utf8').digest('hex');
  if (!/^[a-f0-9]{64}$/.test(expectedHash) || actualHash !== expectedHash) invalid('Asset pack manifest hash does not match');
  return { manifest: normalized, canonicalJson, totalBytes };
}

export function canonicalManifest(manifest: CompanionAssetManifestV1): CompanionAssetManifestV1 {
  return {
    format: 'our-companion-asset-pack', schemaVersion: 1,
    runtime: {
      defaultAnimation: 'Idle_Neutral',
      ...(manifest.runtime.portraitPath ? { portraitPath: manifest.runtime.portraitPath } : {}),
      ...(manifest.runtime.iconPath ? { iconPath: manifest.runtime.iconPath } : {}),
      animations: manifest.runtime.animations.map(animation => ({ ...animation, files: [...animation.files].sort() })).sort((a, b) => a.name.localeCompare(b.name)),
    },
    files: [...manifest.files].sort((a, b) => a.relativePath.localeCompare(b.relativePath)),
  };
}

export function canonicalJsonStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJsonStringify).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJsonStringify(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
}

export function normalizeRelativePath(value: string): string {
  if (!value || value.includes('\0') || value.includes('\\') || value.startsWith('/') || value.includes('?') || value.includes('#') || /%2e|%2f|%5c/i.test(value)) invalid('Asset pack path is unsafe');
  const segments = value.split('/');
  if (segments.some(segment => !segment || segment === '.' || segment === '..' || segment.startsWith('.') || segment === '.DS_Store')) invalid('Asset pack path is unsafe');
  const normalized = segments.join('/');
  if (!normalized.startsWith('assets/')) invalid('Asset pack files must be in the managed asset root');
  return normalized;
}

function extensionOf(value: string): string { return value.slice(value.lastIndexOf('.')).toLowerCase(); }
function isRecord(value: unknown): value is Record<string, any> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function invalid(message: string): never { throw new BadRequestException({ code: 'ASSET_PACK_MANIFEST_INVALID', message }); }
