import { Module } from '@nestjs/common';
import { RateLimiter } from '../common/rate-limiter';
import { MyReservationsController, PickupsController, ReservationsController } from './reservations.controller';
import { ReservationsService } from './reservations.service';

@Module({
  controllers: [ReservationsController, MyReservationsController, PickupsController],
  providers: [RateLimiter, ReservationsService],
  exports: [RateLimiter, ReservationsService],
})
export class ReservationsModule {}
