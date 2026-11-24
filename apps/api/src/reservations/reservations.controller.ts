import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import type {
  PageInfo,
  PickupConfirmResponse,
  PickupLookupResponse,
  PickupToken,
  Reservation,
} from '@savemeal/shared';
import { CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import {
  CancelReservationDto,
  CreateReservationDto,
  MyReservationsQueryDto,
  MySalesQueryDto,
  PickupConfirmDto,
  PickupLookupDto,
} from './reservation.dto';
import { ReservationsService } from './reservations.service';

const reservationId = () => new ParseUUIDPipe({ exceptionFactory: () => new AppException('RESERVATION_NOT_FOUND') });

@Controller('reservations')
export class ReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** RES-1 · POST /reservations: reserve atomically. */
  @Post()
  async create(
    @CurrentAccount() account: AuthAccount,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() body: CreateReservationDto,
  ): Promise<{ data: Reservation }> {
    return { data: await this.reservations.create(account, body, idempotencyKey) };
  }

  /** RES-3 · GET /reservations/:reservationId (BUYER, SELLER or ADMIN). */
  @Get(':reservationId')
  async get(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationId()) id: string,
  ): Promise<{ data: Reservation }> {
    return { data: await this.reservations.getById(account, id) };
  }

  /** RES-4 · POST /reservations/:reservationId/cancel (BUYER). */
  @Post(':reservationId/cancel')
  @HttpCode(200)
  async cancel(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationId()) id: string,
    @Body() body: CancelReservationDto,
  ): Promise<{ data: Reservation }> {
    return { data: await this.reservations.cancel(account, id, body) };
  }

  /** RES-6 · POST /reservations/:reservationId/pickup-token (BUYER). */
  @Post(':reservationId/pickup-token')
  async rotatePickupToken(
    @CurrentAccount() account: AuthAccount,
    @Param('reservationId', reservationId()) id: string,
  ): Promise<{ data: PickupToken }> {
    return { data: await this.reservations.rotatePickupToken(account, id) };
  }
}

@Controller('me')
export class MyReservationsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** RES-2 · GET /me/reservations (BUYER). */
  @Get('reservations')
  myReservations(
    @CurrentAccount() account: AuthAccount,
    @Query() query: MyReservationsQueryDto,
  ): Promise<{ data: Reservation[]; page: PageInfo }> {
    return this.reservations.myReservations(account, query);
  }

  /** RES-5 · GET /me/sales (SELLER). */
  @Get('sales')
  mySales(
    @CurrentAccount() account: AuthAccount,
    @Query() query: MySalesQueryDto,
  ): Promise<{ data: Reservation[]; page: PageInfo }> {
    return this.reservations.mySales(account, query);
  }
}

@Controller('pickups')
export class PickupsController {
  constructor(private readonly reservations: ReservationsService) {}

  /** RES-7 · POST /pickups/lookup (SELLER). */
  @Post('lookup')
  @HttpCode(200)
  async lookup(@CurrentAccount() account: AuthAccount, @Body() body: PickupLookupDto): Promise<{ data: PickupLookupResponse }> {
    return { data: await this.reservations.lookupPickup(account, body) };
  }

  /** RES-8 · POST /pickups/confirm (SELLER). */
  @Post('confirm')
  @HttpCode(200)
  async confirm(
    @CurrentAccount() account: AuthAccount,
    @Body() body: PickupConfirmDto,
  ): Promise<{ data: PickupConfirmResponse }> {
    return { data: await this.reservations.confirmPickup(account, body) };
  }
}
