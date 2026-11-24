import { Injectable } from '@nestjs/common';
import type { Account, Prisma } from '@prisma/client';
import type { Me, MeSeller, PickupLocation, SellerType, UpdateMeBody } from '@savemeal/shared';
import { AppException } from '../common/errors/app-exception';
import { logEvent } from '../common/event-log';
import { toImage } from '../common/images';
import { toApiTime } from '../common/time';
import { PrismaService } from '../prisma/prisma.service';

export const DELETED_DISPLAY_NAME = 'Người dùng đã xóa';

type AccountWithAvatar = Account & {
  avatar: { id: string; storageKey: string; width: number; height: number } | null;
};

export function toMeSeller(account: Account): MeSeller {
  const hasPickup =
    account.defaultPickupAddress !== null && account.defaultPickupLat !== null && account.defaultPickupLng !== null;
  return {
    name: account.sellerName,
    type: account.sellerType,
    verified: account.sellerVerifiedAt !== null,
    defaultPickup: hasPickup
      ? { address: account.defaultPickupAddress!, lat: account.defaultPickupLat!, lng: account.defaultPickupLng! }
      : null,
  };
}

@Injectable()
export class MeService {
  constructor(private readonly prisma: PrismaService) {}

  async getMe(accountId: string): Promise<Me> {
    const account = await this.prisma.account.findUniqueOrThrow({
      where: { id: accountId },
      include: { avatar: { select: { id: true, storageKey: true, width: true, height: true } } },
    });
    return this.toMe(account);
  }

  /**
   * ME-1 stats (V1/08, V1/35): portions handed over in completed handovers on either side of the
   * account (as buyer or seller), its own RESERVED orders, and its DRAFT/PUBLISHED listings.
   */
  private async toMe(account: AccountWithAvatar): Promise<Me> {
    const [handedOver, reservationsActive, listingsActive] = await Promise.all([
      this.prisma.reservation.aggregate({
        where: { status: 'COMPLETED', OR: [{ buyerId: account.id }, { sellerId: account.id }] },
        _sum: { quantity: true },
      }),
      this.prisma.reservation.count({ where: { buyerId: account.id, status: 'RESERVED' } }),
      this.prisma.foodListing.count({ where: { sellerId: account.id, status: { in: ['DRAFT', 'PUBLISHED'] } } }),
    ]);
    return {
      id: account.id,
      displayName: account.displayName,
      phone: account.phone,
      email: account.email,
      avatar: account.avatar ? toImage(account.avatar) : null,
      role: account.role,
      status: account.status === 'SUSPENDED' ? 'SUSPENDED' : 'ACTIVE',
      seller: toMeSeller(account),
      stats: {
        portionsHandedOver: handedOver._sum.quantity ?? 0,
        reservationsActive,
        listingsActive,
      },
      createdAt: toApiTime(account.createdAt),
    };
  }

  /** ME-2. Phone and email cannot change in v1. */
  async update(accountId: string, body: UpdateMeBody): Promise<Me> {
    const data: Prisma.AccountUpdateInput = {};
    if (body.displayName !== undefined) data.displayName = body.displayName.trim();
    if (body.avatarImageId !== undefined) {
      if (body.avatarImageId === null) {
        data.avatar = { disconnect: true };
      } else {
        const image = await this.prisma.listingImage.findFirst({
          where: { id: body.avatarImageId, uploaderId: accountId, purpose: 'AVATAR' },
          select: { id: true },
        });
        if (!image) throw new AppException('IMAGE_NOT_FOUND');
        data.avatar = { connect: { id: image.id } };
      }
    }
    if (body.seller) {
      const { name, type, defaultPickup } = body.seller;
      if (name !== undefined) data.sellerName = name === null ? null : name.trim() || null;
      if (type !== undefined) data.sellerType = type as SellerType | null;
      if (defaultPickup !== undefined) Object.assign(data, pickupColumns(defaultPickup));
    }
    await this.prisma.account.update({ where: { id: accountId }, data });
    return this.getMe(accountId);
  }

  /**
   * ME-3. Refused while the account has RESERVED orders or PUBLISHED listings. Otherwise the
   * account is soft-deleted and anonymised; its DRAFT listings and tokens are removed, and
   * anonymised reservations, reports and event logs are kept.
   */
  async delete(accountId: string): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Serialise with concurrent reservations/listings for this account.
      await tx.$executeRaw`SELECT 1 FROM accounts WHERE id = ${accountId}::uuid FOR UPDATE`;
      const [activeReservations, activeListings] = await Promise.all([
        tx.reservation.count({ where: { buyerId: accountId, status: 'RESERVED' } }),
        tx.foodListing.count({ where: { sellerId: accountId, status: 'PUBLISHED' } }),
      ]);
      if (activeReservations > 0 || activeListings > 0) {
        throw new AppException('ACCOUNT_HAS_ACTIVE_ITEMS', { activeReservations, activeListings });
      }
      const drafts = await tx.foodListing.findMany({ where: { sellerId: accountId, status: 'DRAFT' }, select: { id: true } });
      const draftIds = drafts.map((d) => d.id);
      await tx.listingImage.deleteMany({ where: { listingId: { in: draftIds } } });
      await tx.foodListing.deleteMany({ where: { id: { in: draftIds } } });
      await tx.refreshToken.deleteMany({ where: { accountId } });
      await tx.account.update({
        where: { id: accountId },
        data: {
          status: 'DELETED',
          deletedAt: new Date(),
          phone: null,
          email: null,
          avatar: { disconnect: true },
          displayName: DELETED_DISPLAY_NAME,
          sellerName: null,
          sellerType: null,
          defaultPickupAddress: null,
          defaultPickupLat: null,
          defaultPickupLng: null,
        },
      });
      await logEvent(tx, {
        actorId: accountId,
        actorType: 'USER',
        event: 'ACCOUNT_DELETED',
        entityType: 'account',
        entityId: accountId,
        data: { draftsDeleted: draftIds.length },
      });
    });
  }
}

function pickupColumns(pickup: PickupLocation | null) {
  return {
    defaultPickupAddress: pickup ? pickup.address.trim() : null,
    defaultPickupLat: pickup ? pickup.lat : null,
    defaultPickupLng: pickup ? pickup.lng : null,
  };
}
