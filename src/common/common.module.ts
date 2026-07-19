import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { JwtStrategy } from './strategies/jwt.strategy';
import { SocketAuthService } from './socket-auth.service';
import { ProtocolConfigService } from './protocol-config.service';
import { SocialEventPublisher } from './social-event-publisher.service';
import { SocialRateLimitGuard } from './guards/social-rate-limit.guard';
import { VisitConfigService } from './visit-config.service';
import { StorageModule } from '../storage/storage.module';
import { BrowserSecurityService } from './browser-security.service';
import { BrowserOriginGuard } from './guards/browser-origin.guard';
import { BrowserCsrfGuard } from './guards/browser-csrf.guard';
import { PortalRateLimitGuard } from './guards/portal-rate-limit.guard';

@Module({
  imports: [
    JwtModule.registerAsync({
      imports: [ConfigModule],
      useFactory: (configService: ConfigService) => ({
        secret: configService.get<string>('JWT_SECRET'),
        signOptions: {
          expiresIn: configService.get<string>('JWT_EXPIRATION', '15m'),
        },
      }),
      inject: [ConfigService],
    }),
    PassportModule,
    StorageModule,
  ],
  providers: [JwtStrategy, SocketAuthService, ProtocolConfigService, SocialEventPublisher, SocialRateLimitGuard, VisitConfigService, BrowserSecurityService, BrowserOriginGuard, BrowserCsrfGuard, PortalRateLimitGuard],
  exports: [JwtModule, SocketAuthService, ProtocolConfigService, SocialEventPublisher, SocialRateLimitGuard, VisitConfigService, BrowserSecurityService, BrowserOriginGuard, BrowserCsrfGuard, PortalRateLimitGuard],
})
export class CommonModule {}
