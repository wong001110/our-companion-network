import { Body, Controller, Get, Param, ParseUUIDPipe, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUrl, IsUUID, Length, MaxLength } from 'class-validator';
import { CurrentUser, UserPayload } from '../common/decorators/current-user.decorator';
import { SocialRateLimit } from '../common/decorators/social-rate-limit.decorator';
import { SocialRateLimitGuard } from '../common/guards/social-rate-limit.guard';
import { VisitSocialService } from './visit-social.service';
import { VISIT_SOCIAL_EMOTIONS, VISIT_SOCIAL_INTENTS } from './visit-social.policy';

class SetVisitShareDto {
  @IsString() @Length(1, 120) title: string;
  @IsString() @Length(1, 600) summary: string;
  @IsOptional() @IsArray() @ArrayMaxSize(5) @IsString({ each: true }) @MaxLength(40, { each: true }) tags?: string[];
  @IsOptional() @IsUrl({ require_protocol: true }, { message: 'sourceUrl must be an absolute URL' }) @MaxLength(2_000) sourceUrl?: string;
}

class AppendVisitTurnDto {
  @IsUUID() clientTurnId: string;
  @IsIn([...VISIT_SOCIAL_INTENTS]) intent: (typeof VISIT_SOCIAL_INTENTS)[number];
  @IsString() @Length(1, 800) message: string;
  @IsOptional() @IsIn([...VISIT_SOCIAL_EMOTIONS]) emotion?: (typeof VISIT_SOCIAL_EMOTIONS)[number];
  @IsOptional() @IsString() @MaxLength(80) topic?: string;
}

@UseGuards(AuthGuard('jwt'), SocialRateLimitGuard)
@Controller('visit-sessions/:id/social')
export class VisitSocialController {
  constructor(private readonly social: VisitSocialService) {}

  @Get()
  @SocialRateLimit('visit_read')
  getState(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.getState(user.id, id);
  }

  @Post('share')
  @SocialRateLimit('visit_mutation')
  setShare(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: SetVisitShareDto) {
    return this.social.setShare(user.id, id, dto);
  }

  @Post('turns')
  @SocialRateLimit('visit_mutation')
  async appendTurn(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string, @Body() dto: AppendVisitTurnDto) {
    await this.social.appendTurn(user.id, id, dto);
    return this.social.getState(user.id, id);
  }

  @Post('shared-moment')
  @SocialRateLimit('visit_mutation')
  finalizeMoment(@CurrentUser() user: UserPayload, @Param('id', ParseUUIDPipe) id: string) {
    return this.social.finalizeMoment(user.id, id);
  }
}
