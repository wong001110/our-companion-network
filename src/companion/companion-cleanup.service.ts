import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { CompanionService } from './companion.service';

/** Keeps temporary and retired packs bounded without making startup depend on R2. */
@Injectable()
export class CompanionCleanupService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly companions: CompanionService) {}

  onModuleInit() {
    void this.run();
    this.timer = setInterval(() => void this.run(), 60 * 60 * 1000);
  }

  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.companions.abandonExpiredUploads(100);
      await this.companions.cleanupSupersededPacks(100);
    } catch {
      // Storage outages are retried on the next bounded pass.
    } finally { this.running = false; }
  }
}
