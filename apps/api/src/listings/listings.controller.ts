import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import type { ListingCard, ListingDetail, ListingOwnerView, MapPin, PageInfo, SellerProfile } from '@savemeal/shared';
import { CurrentAccount, Public, type AuthAccount } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { toApiTime } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateListingDto,
  MyListingsQuery,
  PublishListingDto,
  SearchListingsQuery,
  UpdateListingDto,
  WithdrawListingDto,
} from './listing.dto';
import { sellerSummary } from './listing.mapper';
import { ListingSearchService } from './listing-search.service';
import { ListingsService } from './listings.service';

const listingId = () => new ParseUUIDPipe({ exceptionFactory: () => new AppException('LISTING_NOT_FOUND') });

@Controller('listings')
export class ListingsController {
  constructor(
    private readonly listings: ListingsService,
    private readonly searchService: ListingSearchService,
  ) {}

  /** LIST-1 · GET /listings (PUBLIC): map, list and search. */
  @Get()
  @Public()
  search(@Query() query: SearchListingsQuery): Promise<{ data: ListingCard[] | MapPin[]; page?: PageInfo }> {
    return this.searchService.search(query);
  }

  /** LIST-2 · GET /listings/{id} (PUBLIC; owner/admin get the owner view). */
  @Get(':listingId')
  @Public()
  async get(
    @CurrentAccount() viewer: AuthAccount | undefined,
    @Param('listingId', listingId()) id: string,
  ): Promise<{ data: ListingDetail | ListingOwnerView }> {
    // A suspended viewer is treated as a guest here.
    return { data: await this.listings.get(viewer?.status === 'ACTIVE' ? viewer : undefined, id) };
  }

  /** LIST-3 · POST /listings: create a draft. */
  @Post()
  async create(@CurrentAccount() account: AuthAccount, @Body() body: CreateListingDto): Promise<{ data: ListingOwnerView }> {
    return { data: await this.listings.create(account, body) };
  }

  /** LIST-4 · PATCH /listings/{id} (OWNER) */
  @Patch(':listingId')
  async update(
    @CurrentAccount() account: AuthAccount,
    @Param('listingId', listingId()) id: string,
    @Body() body: UpdateListingDto,
  ): Promise<{ data: ListingOwnerView }> {
    return { data: await this.listings.update(account, id, body) };
  }

  /** LIST-5 · DELETE /listings/{id} (OWNER, DRAFT only) */
  @Delete(':listingId')
  @HttpCode(204)
  async remove(@CurrentAccount() account: AuthAccount, @Param('listingId', listingId()) id: string): Promise<void> {
    await this.listings.remove(account, id);
  }

  /** LIST-6 · POST /listings/{id}/publish (OWNER) */
  @Post(':listingId/publish')
  @HttpCode(200)
  async publish(
    @CurrentAccount() account: AuthAccount,
    @Param('listingId', listingId()) id: string,
    @Body() body: PublishListingDto,
  ): Promise<{ data: ListingOwnerView }> {
    return { data: await this.listings.publish(account, id, body.declaration) };
  }

  /** LIST-7 · POST /listings/{id}/withdraw (OWNER) */
  @Post(':listingId/withdraw')
  @HttpCode(200)
  async withdraw(
    @CurrentAccount() account: AuthAccount,
    @Param('listingId', listingId()) id: string,
    @Body() body: WithdrawListingDto,
  ): Promise<{ data: ListingOwnerView }> {
    return { data: await this.listings.withdraw(account, id, body) };
  }
}

@Controller('me/listings')
export class MyListingsController {
  constructor(private readonly listings: ListingsService) {}

  /** LIST-8 · GET /me/listings */
  @Get()
  mine(@CurrentAccount() account: AuthAccount, @Query() query: MyListingsQuery) {
    return this.listings.mine(account, query);
  }
}

@Controller('sellers')
export class SellersController {
  constructor(private readonly prisma: PrismaService) {}

  /** SELLER-1 · GET /sellers/{accountId} (PUBLIC). Deleted or suspended accounts are 404. */
  @Get(':accountId')
  @Public()
  async get(
    @Param('accountId', new ParseUUIDPipe({ exceptionFactory: () => new AppException('SELLER_NOT_FOUND') })) id: string,
  ): Promise<{ data: SellerProfile }> {
    const account = await this.prisma.account.findUnique({ where: { id } });
    if (!account || account.status !== 'ACTIVE') throw new AppException('SELLER_NOT_FOUND');
    const [activeListingCount, completedHandovers] = await Promise.all([
      this.prisma.foodListing.count({
        where: { sellerId: id, status: 'PUBLISHED', underReview: false, pickupEnd: { gt: new Date() }, quantityAvailable: { gt: 0 } },
      }),
      this.prisma.reservation.count({ where: { sellerId: id, status: 'COMPLETED' } }),
    ]);
    return {
      data: { ...sellerSummary(account), activeListingCount, completedHandovers, memberSince: toApiTime(account.createdAt) },
    };
  }
}
