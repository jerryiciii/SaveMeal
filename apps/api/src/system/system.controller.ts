import { Controller, Get, Logger } from '@nestjs/common';
import {
  ALLERGENS,
  BUYER_CANCEL_REASONS,
  CATEGORIES,
  REPORT_TYPES,
  SELLER_TYPES,
  STORAGES,
  type AppConfigResponse,
  type HealthResponse,
} from '@savemeal/shared';
import { Public } from '../auth/auth.guard';
import { AppException } from '../common/errors/app-exception';
import { AppConfig } from '../config/app-config';
import { PrismaService } from '../prisma/prisma.service';

/** Version of the API contract this server implements. */
export const API_VERSION = '1.1.0';

/** SYS-2 constants that are product choices, not deployment config. */
const RADIUS_KM_OPTIONS = [1, 3, 5];
const MAX_RADIUS_KM = 10;
const MAX_IMAGES_PER_LISTING = 4;
const DEFAULT_CENTER = { lat: 16.0544, lng: 108.2022, label: 'Đà Nẵng' };
const POPULAR_SEARCHES = ['Bánh mì', 'Bánh ngọt', 'Cơm trưa', 'Món miễn phí'];

@Controller()
@Public()
export class SystemController {
  private readonly logger = new Logger(SystemController.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly config: AppConfig,
  ) {}

  /** SYS-1 · GET /health (PUBLIC). A database failure is reported as 500 INTERNAL. */
  @Get('health')
  async health(): Promise<{ data: HealthResponse }> {
    try {
      await this.prisma.ping();
    } catch (error) {
      this.logger.error(`health: database unreachable: ${(error as Error).message}`);
      throw new AppException('INTERNAL');
    }
    return { data: { status: 'ok', db: 'ok', version: API_VERSION } };
  }

  /** SYS-2 · GET /config (PUBLIC): flags, enums, limits and map settings for the PWA. */
  @Get('config')
  appConfig(): { data: AppConfigResponse } {
    const { reservations, listings } = this.config;
    return {
      data: {
        features: { ...this.config.features },
        enums: {
          categories: [...CATEGORIES],
          storage: [...STORAGES],
          allergens: [...ALLERGENS],
          sellerTypes: [...SELLER_TYPES],
          reportTypes: [...REPORT_TYPES],
          cancelReasons: [...BUYER_CANCEL_REASONS],
        },
        limits: {
          maxQtyPerReservation: reservations.maxQtyPerReservation,
          maxActiveReservations: reservations.maxActivePerAccount,
          radiusKmOptions: [...RADIUS_KM_OPTIONS],
          maxRadiusKm: MAX_RADIUS_KM,
          maxImagesPerListing: MAX_IMAGES_PER_LISTING,
          maxWindowHours: listings.maxWindowHours,
          pickupTokenTtlMin: reservations.pickupTokenTtlMin,
          earlyPickupMin: reservations.earlyPickupMin,
        },
        defaultCenter: { ...DEFAULT_CENTER },
        popularSearches: [...POPULAR_SEARCHES],
        map: { ...this.config.map },
      },
    };
  }
}
