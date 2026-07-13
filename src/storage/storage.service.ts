import { Injectable, OnModuleDestroy, OnModuleInit, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import {
  DeleteObjectsCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StorageCapability {
  configured: boolean;
  provider: 'cloudflare_r2';
  uploadsEnabled: boolean;
  downloadsEnabled: boolean;
}

export interface ObjectMetadata {
  sizeBytes: number;
  mimeType?: string;
  sha256?: string;
}

export interface PresignedObjectUrl {
  url: string;
  expiresAt: string;
}

@Injectable()
export class StorageService implements OnModuleInit, OnModuleDestroy {
  private readonly client?: S3Client;
  private readonly bucket?: string;
  private readonly uploadTtlSeconds: number;
  private readonly downloadTtlSeconds: number;
  private readonly limitsValue: { maxFileBytes: number; maxPackBytes: number; maxPackFiles: number; uploadSessionTtlHours: number; maxUserStorageBytes: number; supersededPackRetentionDays: number };
  private _capability: StorageCapability;
  private recoveryTimer?: NodeJS.Timeout;

  constructor(config: ConfigService) {
    const uploadTtlSeconds = configuredPositiveInt(config.get<string>('R2_UPLOAD_URL_TTL_SECONDS'), 900);
    const downloadTtlSeconds = configuredPositiveInt(config.get<string>('R2_DOWNLOAD_URL_TTL_SECONDS'), 900);
    const maxFileBytes = configuredPositiveInt(config.get<string>('R2_MAX_ASSET_FILE_BYTES'), 20 * 1024 * 1024);
    const maxPackBytes = configuredPositiveInt(config.get<string>('R2_MAX_ASSET_PACK_BYTES'), 500 * 1024 * 1024);
    const maxPackFiles = configuredPositiveInt(config.get<string>('R2_MAX_ASSET_PACK_FILES'), 1000);
    const uploadSessionTtlHours = configuredPositiveInt(config.get<string>('R2_UPLOAD_SESSION_TTL_HOURS'), 24);
    const maxUserStorageBytes = configuredPositiveInt(config.get<string>('R2_MAX_USER_STORAGE_BYTES'), 2 * 1024 * 1024 * 1024);
    const supersededPackRetentionDays = configuredPositiveInt(config.get<string>('R2_SUPERSEDED_PACK_RETENTION_DAYS'), 30);
    this.uploadTtlSeconds = uploadTtlSeconds ?? 900;
    this.downloadTtlSeconds = downloadTtlSeconds ?? 900;
    this.limitsValue = { maxFileBytes: maxFileBytes ?? 20 * 1024 * 1024, maxPackBytes: maxPackBytes ?? 500 * 1024 * 1024, maxPackFiles: maxPackFiles ?? 1000, uploadSessionTtlHours: uploadSessionTtlHours ?? 24, maxUserStorageBytes: maxUserStorageBytes ?? 2 * 1024 * 1024 * 1024, supersededPackRetentionDays: supersededPackRetentionDays ?? 30 };
    const accountId = config.get<string>('CLOUDFLARE_ACCOUNT_ID')?.trim();
    const bucket = config.get<string>('R2_BUCKET_NAME')?.trim();
    const accessKeyId = config.get<string>('R2_ACCESS_KEY_ID')?.trim();
    const secretAccessKey = config.get<string>('R2_SECRET_ACCESS_KEY')?.trim();
    const endpoint = config.get<string>('R2_ENDPOINT')?.trim();
    const endpointValid = endpoint ? validEndpoint(endpoint) : false;
    const limitsValid = Boolean(uploadTtlSeconds && downloadTtlSeconds && maxFileBytes && maxPackBytes && maxPackFiles && uploadSessionTtlHours && maxUserStorageBytes && supersededPackRetentionDays);
    const configured = Boolean(accountId && bucket && accessKeyId && secretAccessKey && endpointValid && limitsValid);
    this._capability = { configured, provider: 'cloudflare_r2', uploadsEnabled: false, downloadsEnabled: false };
    if (!configured || !endpoint || !bucket || !accessKeyId || !secretAccessKey) return;
    this.bucket = bucket;
    this.client = new S3Client({
      region: config.get<string>('R2_REGION', 'auto'),
      endpoint,
      credentials: { accessKeyId, secretAccessKey },
    });
  }

  get capability(): StorageCapability {
    return this._capability;
  }

  get limits() {
    return this.limitsValue;
  }

  async onModuleInit() {
    await this.refreshCapability();
    this.recoveryTimer = setInterval(() => void this.refreshCapability(), 5 * 60 * 1000);
  }

  onModuleDestroy() { if (this.recoveryTimer) clearInterval(this.recoveryTimer); }

  async refreshCapability(): Promise<StorageCapability> {
    if (!this.client || !this.bucket) return this.capability;
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      this._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: true, downloadsEnabled: true };
    } catch {
      // S0-S2 remain available when R2 is absent or temporarily unavailable.
      this._capability = { configured: true, provider: 'cloudflare_r2', uploadsEnabled: false, downloadsEnabled: false };
    }
    return this.capability;
  }

  async createPutUrl(objectKey: string, mimeType: string, sha256: string): Promise<PresignedObjectUrl> {
    this.requireAvailable();
    const expiresIn = this.uploadTtlSeconds;
    const url = await getSignedUrl(this.client!, new PutObjectCommand({
      Bucket: this.bucket!, Key: objectKey, ContentType: mimeType, Metadata: { sha256 },
    }), { expiresIn, unhoistableHeaders: new Set(['content-type', 'x-amz-meta-sha256']) });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async createGetUrl(objectKey: string): Promise<PresignedObjectUrl> {
    this.requireAvailable();
    const expiresIn = this.downloadTtlSeconds;
    const url = await getSignedUrl(this.client!, new GetObjectCommand({ Bucket: this.bucket!, Key: objectKey }), { expiresIn });
    return { url, expiresAt: new Date(Date.now() + expiresIn * 1000).toISOString() };
  }

  async headObject(objectKey: string): Promise<ObjectMetadata | null> {
    this.requireAvailable();
    try {
      const result = await this.client!.send(new HeadObjectCommand({ Bucket: this.bucket!, Key: objectKey }));
      return { sizeBytes: Number(result.ContentLength ?? 0), mimeType: result.ContentType, sha256: result.Metadata?.sha256 };
    } catch (error) {
      if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return null;
      this.markUnavailable();
      throw error;
    }
  }

  async putManifest(objectKey: string, body: string): Promise<void> {
    this.requireAvailable();
    try { await this.client!.send(new PutObjectCommand({ Bucket: this.bucket!, Key: objectKey, Body: body, ContentType: 'application/json' })); }
    catch (error) { this.markUnavailable(); throw error; }
  }

  async deleteObjects(objectKeys: string[]): Promise<void> {
    this.requireAvailable();
    if (!objectKeys.length) return;
    try {
      const result = await this.client!.send(new DeleteObjectsCommand({ Bucket: this.bucket!, Delete: { Objects: objectKeys.map(Key => ({ Key })), Quiet: true } }));
      // S3-compatible APIs can report a successful request with per-object errors.
      // Keep the lifecycle claim intact so the next cleanup pass retries safely.
      if (result.Errors?.length) throw new Error('ASSET_STORAGE_DELETE_INCOMPLETE');
    }
    catch (error) { this.markUnavailable(); throw error; }
  }

  private requireAvailable() {
    if (!this.capability.uploadsEnabled || !this.capability.downloadsEnabled) {
      throw new ServiceUnavailableException({ code: 'ASSET_STORAGE_UNAVAILABLE', message: 'Asset storage is currently unavailable' });
    }
  }
  private markUnavailable() { if (this._capability.configured) this._capability = { ...this._capability, uploadsEnabled: false, downloadsEnabled: false }; }
}

function validEndpoint(value: string): boolean {
  try {
    const parsed = new URL(value);
    return (parsed.protocol === 'https:' || parsed.protocol === 'http:') && Boolean(parsed.host) && !parsed.username && !parsed.password;
  } catch { return false; }
}

function configuredPositiveInt(value: string | undefined, fallback: number): number | undefined {
  if (value === undefined || value === '') return fallback;
  const number = Number(value);
  return Number.isSafeInteger(number) && number > 0 ? number : undefined;
}
