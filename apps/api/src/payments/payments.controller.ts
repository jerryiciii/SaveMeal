import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Put, Query } from '@nestjs/common';
import type {
  AdminSettlePayoutResponse,
  MyPayoutsResponse,
  PageInfo,
  Payment,
  PayoutAccount,
  Reservation,
} from '@savemeal/shared';
import { AdminOnly, CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import {
  AdminMarkRefundedDto,
  AdminPaymentsQueryDto,
  AdminSettlePayoutDto,
  MyPayoutsQueryDto,
  UpdatePayoutAccountDto,
} from './payment.dto';
import { PaymentsService } from './payments.service';

const reservationIdPipe = () =>
  new ParseUUIDPipe({ exceptionFactory: () => new AppException('RESERVATION_NOT_FOUND') });
const paymentIdPipe = () =>
  new ParseUUIDPipe({ exceptionFactory: () => new AppException('PAYMENT_NOT_FOUND') });
const accountIdPipe = () =>
  new ParseUUIDPipe({ exceptionFactory: () => new AppException('ACCOUNT_NOT_FOUND') });

@Controller('reservations')
export class ReservationPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** PAY-1 · GET /reservations/:reservationId/payment (BUYER or ADMIN). */
  @Get(':reservationId/payment')
  async getForReservation(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationIdPipe()) reservationId: string,
  ): Promise<{ data: Payment }> {
    return { data: await this.payments.getForReservation(account, reservationId) };
  }

  /** PAY-DEV · POST /reservations/:reservationId/payment/simulate (BUYER, mock provider only). */
  @Post(':reservationId/payment/simulate')
  @HttpCode(200)
  async simulate(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationIdPipe()) reservationId: string,
  ): Promise<{ data: Reservation }> {
    return { data: await this.payments.simulatePayment(account, reservationId) };
  }
}

@Controller('me')
export class MyPayoutsController {
  constructor(private readonly payments: PaymentsService) {}

  /** PAY-3 · GET /me/payouts (SELLER). */
  @Get('payouts')
  myPayouts(
    @CurrentAccount() account: AuthAccount,
    @Query() query: MyPayoutsQueryDto,
  ): Promise<{ data: MyPayoutsResponse; page: PageInfo }> {
    return this.payments.myPayouts(account, query);
  }

  /** PAY-4 · PUT /me/payout-account (SELLER). */
  @Put('payout-account')
  async upsertPayoutAccount(
    @CurrentAccount() account: AuthAccount,
    @Body() body: UpdatePayoutAccountDto,
  ): Promise<{ data: PayoutAccount }> {
    return { data: await this.payments.upsertPayoutAccount(account, body) };
  }
}

@Controller('admin')
@AdminOnly()
export class AdminPaymentsController {
  constructor(private readonly payments: PaymentsService) {}

  /** PAY-5 · GET /admin/payments */
  @Get('payments')
  listPayments(@Query() query: AdminPaymentsQueryDto): Promise<{ data: Payment[]; page: PageInfo }> {
    return this.payments.adminListPayments(query);
  }

  /** PAY-5 · POST /admin/payments/:paymentId/mark-refunded */
  @Post('payments/:paymentId/mark-refunded')
  @HttpCode(200)
  async markRefunded(
    @CurrentAccount() account: AuthAccount,
    @Param('paymentId', paymentIdPipe()) paymentId: string,
    @Body() body: AdminMarkRefundedDto,
  ): Promise<{ data: Payment }> {
    return { data: await this.payments.adminMarkRefunded(account, paymentId, body) };
  }

  /** PAY-5 · POST /admin/payouts/:sellerId/settle */
  @Post('payouts/:sellerId/settle')
  @HttpCode(200)
  async settlePayout(
    @CurrentAccount() account: AuthAccount,
    @Param('sellerId', accountIdPipe()) sellerId: string,
    @Body() body: AdminSettlePayoutDto,
  ): Promise<{ data: AdminSettlePayoutResponse }> {
    return { data: await this.payments.adminSettlePayout(account, sellerId, body) };
  }
}
