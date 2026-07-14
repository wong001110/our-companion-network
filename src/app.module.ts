import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_INTERCEPTOR, APP_FILTER } from '@nestjs/core';
import { PrismaModule } from './prisma/prisma.module';
import { CommonModule } from './common/common.module';
import { IdentityModule } from './identity/identity.module';
import { FriendModule } from './friend/friend.module';
import { PresenceModule } from './presence/presence.module';
import { VisitModule } from './visit/visit.module';
import { NotificationModule } from './notification/notification.module';
import { CommunityModule } from './community/community.module';
import { JwtAuthGuard } from './common/guards/jwt-auth.guard';
import { TransformInterceptor } from './common/interceptors/transform.interceptor';
import { AllExceptionsFilter } from './common/filters/http-exception.filter';
import { MetaModule } from './meta/meta.module';
import { StorageModule } from './storage/storage.module';
import { CompanionModule } from './companion/companion.module';
import { SmokeModule } from './smoke/smoke.module';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    CommonModule,
    StorageModule,
    MetaModule,
    IdentityModule,
    FriendModule,
    PresenceModule,
    VisitModule,
    NotificationModule,
    CommunityModule,
    CompanionModule,
    SmokeModule,
  ],
  providers: [
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
    {
      provide: APP_INTERCEPTOR,
      useClass: TransformInterceptor,
    },
    {
      provide: APP_FILTER,
      useClass: AllExceptionsFilter,
    },
  ],
})
export class AppModule {}
