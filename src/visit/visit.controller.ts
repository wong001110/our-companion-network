import {
  Controller,
  Get,
  Post,
  Patch,
  Body,
  Param,
  UseGuards,
} from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { VisitService } from './visit.service';
import { CreateVisitDto } from './dto/create-visit.dto';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';

@Controller('visits')
@UseGuards(AuthGuard('jwt'))
export class VisitController {
  constructor(private readonly visitService: VisitService) {}

  @Post()
  async sendVisit(
    @CurrentUser() user: UserPayload,
    @Body() dto: CreateVisitDto,
  ) {
    return this.visitService.sendVisit(user.id, dto);
  }

  @Get('inbox')
  async getInbox(@CurrentUser() user: UserPayload) {
    return this.visitService.getInbox(user.id);
  }

  @Get('outbox')
  async getOutbox(@CurrentUser() user: UserPayload) {
    return this.visitService.getOutbox(user.id);
  }

  @Get('history')
  async getHistory(@CurrentUser() user: UserPayload) {
    return this.visitService.getHistory(user.id);
  }

  @Get('pending')
  async getPendingVisits(@CurrentUser() user: UserPayload) {
    return this.visitService.getPendingVisits(user.id);
  }

  @Patch(':id/accept')
  async acceptVisit(
    @CurrentUser() user: UserPayload,
    @Param('id') visitId: string,
  ) {
    return this.visitService.acceptVisit(user.id, visitId);
  }

  @Patch(':id/dismiss')
  async dismissVisit(
    @CurrentUser() user: UserPayload,
    @Param('id') visitId: string,
  ) {
    return this.visitService.dismissVisit(user.id, visitId);
  }
}
