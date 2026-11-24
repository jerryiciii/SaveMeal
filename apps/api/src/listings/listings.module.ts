import { Module } from '@nestjs/common';
import { ListingSearchService } from './listing-search.service';
import { ListingsController, MyListingsController, SellersController } from './listings.controller';
import { ListingsService } from './listings.service';

@Module({
  controllers: [ListingsController, MyListingsController, SellersController],
  providers: [ListingsService, ListingSearchService],
  exports: [ListingsService],
})
export class ListingsModule {}
