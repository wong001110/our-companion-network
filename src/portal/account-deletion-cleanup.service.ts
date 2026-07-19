import {
  Injectable,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PortalService } from './portal.service';

/**
 * Finalizes requested account deletions only after every issued upload URL has
 * expired. This closes the window where a bearer PUT URL could recreate an R2
 * object after the account's database rows had already been removed.
 */
@Injectable()
export class AccountDeletionCleanupService
implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;

  constructor(private readonly portal: PortalService) {}

  onModuleInit() {
    void this.run();
    this.timer = setInterval(() => void this.run(), 60_000);
  }

  onModuleDestroy() {
    if (this.timer) clearInterval(this.timer);
  }

  private async run() {
    if (this.running) return;
    this.running = true;
    try {
      await this.portal.finalizePendingAccountDeletions(100);
    } catch {
      // Database or storage outages leave the durable request in place for the
      // next bounded pass.
    } finally {
      this.running = false;
    }
  }
}
