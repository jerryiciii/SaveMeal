import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type {
  AdminAccount,
  AdminAccountStatusResponse,
  AdminMetrics,
  AdminSellerVerificationResponse,
  ListingOwnerView,
  PageInfo,
  Report,
  Reservation,
} from '@savemeal/shared';
import { AdminOnly, CurrentAccount, type AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import {
  AdminAccountStatusDto,
  AdminAccountsQuery,
  AdminBlockListingDto,
  AdminListingsQuery,
  AdminMetricsQuery,
  AdminReportsQuery,
  AdminReservationsQuery,
  AdminSellerVerificationDto,
  AdminUpdateReportDto,
} from './admin.dto';
import { AdminService } from './admin.service';

const reportIdPipe = () => new ParseUUIDPipe({ exceptionFactory: () => new AppException('REPORT_NOT_FOUND') });
const listingIdPipe = () => new ParseUUIDPipe({ exceptionFactory: () => new AppException('LISTING_NOT_FOUND') });
const accountIdPipe = () => new ParseUUIDPipe({ exceptionFactory: () => new AppException('ACCOUNT_NOT_FOUND') });

@Controller('admin')
@AdminOnly()
export class AdminController {
  constructor(private readonly admin: AdminService) {}

  /** ADM-1 · GET /admin/reports */
  @Get('reports')
  listReports(@Query() query: AdminReportsQuery): Promise<{ data: Report[]; page: PageInfo }> {
    return this.admin.listReports(query);
  }

  /** ADM-2 · PATCH /admin/reports/:reportId */
  @Patch('reports/:reportId')
  async updateReport(
    @CurrentAccount() account: AuthAccount,
    @Param('reportId', reportIdPipe()) reportId: string,
    @Body() body: AdminUpdateReportDto,
  ): Promise<{ data: Report }> {
    return { data: await this.admin.updateReport(account, reportId, body) };
  }

  /** ADM-3 · POST /admin/listings/:listingId/block */
  @Post('listings/:listingId/block')
  @HttpCode(200)
  async blockListing(
    @CurrentAccount() account: AuthAccount,
    @Param('listingId', listingIdPipe()) listingId: string,
    @Body() body: AdminBlockListingDto,
  ): Promise<{ data: ListingOwnerView }> {
    return { data: await this.admin.blockListing(account, listingId, body) };
  }

  /** ADM-4 · POST /admin/accounts/:accountId/status */
  @Post('accounts/:accountId/status')
  @HttpCode(200)
  async setAccountStatus(
    @CurrentAccount() account: AuthAccount,
    @Param('accountId', accountIdPipe()) accountId: string,
    @Body() body: AdminAccountStatusDto,
  ): Promise<{ data: AdminAccountStatusResponse }> {
    return { data: await this.admin.setAccountStatus(account, accountId, body) };
  }

  /** ADM-5 · POST /admin/accounts/:accountId/seller-verification */
  @Post('accounts/:accountId/seller-verification')
  @HttpCode(200)
  async setSellerVerification(
    @CurrentAccount() account: AuthAccount,
    @Param('accountId', accountIdPipe()) accountId: string,
    @Body() body: AdminSellerVerificationDto,
  ): Promise<{ data: AdminSellerVerificationResponse }> {
    return { data: await this.admin.setSellerVerification(account, accountId, body) };
  }

  /** ADM-6 · GET /admin/accounts */
  @Get('accounts')
  listAccounts(@Query() query: AdminAccountsQuery): Promise<{ data: AdminAccount[]; page: PageInfo }> {
    return this.admin.listAccounts(query);
  }

  /** ADM-7 · GET /admin/listings */
  @Get('listings')
  listListings(@Query() query: AdminListingsQuery): Promise<{ data: ListingOwnerView[]; page: PageInfo }> {
    return this.admin.listListings(query);
  }

  /** ADM-8 · GET /admin/reservations */
  @Get('reservations')
  listReservations(@Query() query: AdminReservationsQuery): Promise<{ data: Reservation[]; page: PageInfo }> {
    return this.admin.listReservations(query);
  }

  /** ADM-9 · GET /admin/metrics */
  @Get('metrics')
  async getMetrics(@Query() query: AdminMetricsQuery): Promise<{ data: AdminMetrics }> {
    return { data: await this.admin.getMetrics(query) };
  }
}
