import { Global, Module } from '@nestjs/common';
import {
  AdminPaymentsController,
  MyPayoutsController,
  ReservationPaymentsController,
} from './payments.controller';
import { PaymentsService } from './payments.service';
import { WebhooksController } from './webhooks.controller';

@Global()
@Module({
  controllers: [
    ReservationPaymentsController,
    MyPayoutsController,
    AdminPaymentsController,
    WebhooksController,
  ],
  providers: [PaymentsService],
  exports: [PaymentsService],
})
export class PaymentsModule {}
