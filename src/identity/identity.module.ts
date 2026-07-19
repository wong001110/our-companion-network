import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { IdentityController } from './identity.controller';
import { IdentityService } from './identity.service';
import { JwtStrategy } from '../common/strategies/jwt.strategy';
import { AuthRateLimitGuard } from '../common/guards/auth-rate-limit.guard';
import { PresenceModule } from '../presence/presence.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
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
    PresenceModule,
  ],
  controllers: [IdentityController],
  providers: [IdentityService, JwtStrategy, AuthRateLimitGuard],
  exports: [IdentityService, AuthRateLimitGuard],
})
export class IdentityModule {}
