import { SetMetadata } from '@nestjs/common';

export type SocialRateLimitPolicy =
  | 'read'
  | 'lookup'
  | 'friend_request_create'
  | 'mutation'
  | 'block_mutation'
  | 'companion_profile'
  | 'asset_initiate'
  | 'asset_upload_urls'
  | 'asset_complete'
  | 'asset_download_urls';

export const SOCIAL_RATE_LIMIT_POLICY = 'socialRateLimitPolicy';

export const SocialRateLimit = (policy: SocialRateLimitPolicy) =>
  SetMetadata(SOCIAL_RATE_LIMIT_POLICY, policy);
