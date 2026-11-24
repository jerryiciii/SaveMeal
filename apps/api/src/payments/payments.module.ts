import { Global, Module } from '@nestjs/common';
import { AppConfig } from '../config/app-config';
import { ConsolePaymentMailer, PAYMENT_MAILER, ResendPaymentMailer, type PaymentMailer } from './payment-mailer';
import { ReservationPaymentsController } from './payments.controller';
import { PaymentsService } from './payments.service';

@Global()
@Module({
  controllers: [ReservationPaymentsController],
  providers: [
    PaymentsService,
    {
      provide: PAYMENT_MAILER,
      inject: [AppConfig],
      useFactory: (config: AppConfig): PaymentMailer => {
        const { resendApiKey, from, fromName } = config.otpEmail;
        if (resendApiKey && from && config.nodeEnv !== 'test') {
          return new ResendPaymentMailer({
            apiKey: resendApiKey,
            from: fromName ? `${fromName} <${from}>` : from,
            appPublicUrl: config.appPublicUrl,
          });
        }
        return new ConsolePaymentMailer();
      },
    },
  ],
  exports: [PaymentsService, PAYMENT_MAILER],
})
export class PaymentsModule {}
