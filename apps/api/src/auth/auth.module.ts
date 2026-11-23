import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from '../config/app-config';
import { MeModule } from '../me/me.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthKeys } from './auth-keys';
import { AuthService } from './auth.service';
import { ConsoleOtpSender, OTP_SENDER } from './otp-sender';
import { OtpService } from './otp.service';
import { TokenService } from './token.service';

@Global()
@Module({
  imports: [MeModule],
  controllers: [AuthController],
  providers: [
    AuthKeys,
    OtpService,
    TokenService,
    AuthService,
    {
      provide: OTP_SENDER,
      inject: [AppConfig],
      // Only `console` exists so far; config validation forbids it in production.
      useFactory: (config: AppConfig) => (config.otpProvider === 'console' ? new ConsoleOtpSender() : null),
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, AuthKeys],
})
export class AuthModule {}
