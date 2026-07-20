import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SuperadminGuard } from '../admin/superadmin.guard';
import { DeveloperDebugService } from './developer-debug.service';
import {
  AdminDebugEventQueryDto,
  BatchIngestBodyDto,
} from './dto/developer-debug.dto';

const MAX_BATCH_SIZE = 50;
const MAX_PAYLOAD_BYTES = 64 * 1024;

@Controller()
export class DeveloperDebugController {
  constructor(
    private readonly debugService: DeveloperDebugService,
    private readonly config: ConfigService,
  ) {}

  @Post('developer/debug-events/batch')
  async ingestBatch(
    @CurrentUser() user: UserPayload,
    @Body() body: BatchIngestBodyDto,
  ) {
    const enabled = this.config.get<string>('DEVELOPER_DEBUG_INGEST_ENABLED');
    if (enabled !== 'true') {
      throw new BadRequestException({
        code: 'INGEST_DISABLED',
        message: 'Debug event ingest is not enabled',
      });
    }

    if (!body.events || body.events.length === 0) {
      throw new BadRequestException({
        code: 'EMPTY_BATCH',
        message: 'Batch must contain at least one event',
      });
    }

    if (body.events.length > MAX_BATCH_SIZE) {
      throw new BadRequestException({
        code: 'BATCH_TOO_LARGE',
        message: `Maximum batch size is ${MAX_BATCH_SIZE}`,
      });
    }

    const serialized = JSON.stringify(body);
    if (Buffer.byteLength(serialized, 'utf-8') > MAX_PAYLOAD_BYTES) {
      throw new BadRequestException({
        code: 'PAYLOAD_TOO_LARGE',
        message: 'Total batch payload exceeds maximum size',
      });
    }

    return this.debugService.ingestBatch(
      user.id,
      user.deviceId,
      body.events,
    );
  }

  @Get('admin/developer/debug-events')
  @UseGuards(SuperadminGuard)
  listEvents(@Query() query: AdminDebugEventQueryDto) {
    return this.debugService.listEvents(query);
  }

  @Get('admin/developer/debug-events/:id')
  @UseGuards(SuperadminGuard)
  getEvent(@Param('id', ParseUUIDPipe) id: string) {
    return this.debugService.getEvent(id);
  }

  @Delete('admin/developer-debug-events/expired')
  @UseGuards(SuperadminGuard)
  pruneExpired() {
    return this.debugService.pruneExpired();
  }
}
