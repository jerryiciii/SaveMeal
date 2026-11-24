import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import type { Payment, Reservation } from '@savemeal/shared';
import { CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { RejectPaymentDto, SubmitPaymentProofDto } from './payment.dto';
import { PaymentsService } from './payments.service';

const reservationIdPipe = () =>
  new ParseUUIDPipe({ exceptionFactory: () => new AppException('RESERVATION_NOT_FOUND') });

@Controller('reservations')
export class ReservationPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** PAY-1 · GET /reservations/:reservationId/payment (BUYER, SELLER or ADMIN). */
  @Get(':reservationId/payment')
  async getForReservation(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationIdPipe()) reservationId: string,
  ): Promise<{ data: Payment }> {
    return { data: await this.payments.getForReservation(account, reservationId) };
  }

  /** PAY-2 · POST /reservations/:reservationId/payment-proof (BUYER). */
  @Post(':reservationId/payment-proof')
  @HttpCode(200)
  async submitProof(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationIdPipe()) reservationId: string,
    @Body() body: SubmitPaymentProofDto,
  ): Promise<{ data: Reservation }> {
    return { data: await this.payments.submitProof(account, reservationId, body) };
  }

  /** PAY-3 · POST /reservations/:reservationId/payment/confirm (SELLER). */
  @Post(':reservationId/payment/confirm')
  @HttpCode(200)
  async confirmPayment(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationIdPipe()) reservationId: string,
  ): Promise<{ data: Reservation }> {
    return { data: await this.payments.confirmPayment(account, reservationId) };
  }

  /** PAY-4 · POST /reservations/:reservationId/payment/reject (SELLER). */
  @Post(':reservationId/payment/reject')
  @HttpCode(200)
  async rejectPayment(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationIdPipe()) reservationId: string,
    @Body() body: RejectPaymentDto,
  ): Promise<{ data: Reservation }> {
    return { data: await this.payments.rejectPayment(account, reservationId, body) };
  }
}
