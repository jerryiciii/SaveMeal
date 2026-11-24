import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppConfig } from '../config/app-config';
import { MeModule } from '../me/me.module';
import { AuthController } from './auth.controller';
import { AuthGuard } from './auth.guard';
import { AuthKeys } from './auth-keys';
import { AuthService } from './auth.service';
import { BrevoOtpSender, ResendOtpSender } from './email-otp-sender';
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
      useFactory: (config: AppConfig) => {
        if (config.otpProvider === 'resend') {
          const from = config.otpEmail.fromName
            ? `${config.otpEmail.fromName} <${config.otpEmail.from!}>`
            : config.otpEmail.from!;
          return new ResendOtpSender({
            apiKey: config.otpEmail.resendApiKey!,
            from,
          });
        }
        if (config.otpProvider === 'brevo') {
          return new BrevoOtpSender({
            apiKey: config.otpEmail.brevoApiKey!,
            senderEmail: config.otpEmail.from!,
            senderName: config.otpEmail.fromName,
          });
        }
        return new ConsoleOtpSender();
      },
    },
    { provide: APP_GUARD, useClass: AuthGuard },
  ],
  exports: [TokenService, AuthKeys],
})
export class AuthModule {}
