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
      const phases = [
        () => this.companions.abandonExpiredUploads(100),
        () => this.companions.cleanupActivePackStaging(100),
        () => this.companions.cleanupSupersededPacks(100),
      ];
      for (const phase of phases) {
        try {
          await phase();
        } catch {
          // A phase-level database or storage failure must not starve later
          // independent cleanup phases. Each phase retries on the next pass.
        }
      }
    } finally { this.running = false; }
  }
}
