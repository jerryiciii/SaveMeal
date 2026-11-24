-- SaveMeal v1.2: automated VietQR payments (SePay), buyer-paid platform fee, and seller payout ledger.

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'PENDING_PAYMENT';

-- CreateEnum
CREATE TYPE "PaymentProvider" AS ENUM ('SEPAY', 'MOCK');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('UNPAID', 'PAID', 'EXPIRED', 'REFUND_DUE', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('NONE', 'PENDING_PAYOUT', 'SETTLED');

-- AlterTable
ALTER TABLE "reservations"
  ADD COLUMN "platform_fee" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payable_amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "payment_expires_at" TIMESTAMPTZ(3);

-- Backfill existing rows before adding CHECK constraints.
UPDATE "reservations"
   SET "payable_amount" = "total_price"
 WHERE "payable_amount" = 0 AND "total_price" > 0;

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_platform_fee_check" CHECK ("platform_fee" >= 0),
  ADD CONSTRAINT "reservations_payable_amount_check" CHECK ("payable_amount" = "total_price" + "platform_fee");

-- Recreate partial unique indexes to cover both PENDING_PAYMENT and RESERVED.
DROP INDEX IF EXISTS "reservations_one_active_per_buyer_listing";
DROP INDEX IF EXISTS "reservations_code_unique_active_per_seller";

CREATE UNIQUE INDEX "reservations_one_active_per_buyer_listing"
  ON "reservations" ("buyer_id", "listing_id")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED');

CREATE UNIQUE INDEX "reservations_code_unique_active_per_seller"
  ON "reservations" ("seller_id", "code")
  WHERE "status" NOT IN ('COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateTable
CREATE TABLE "payments" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "provider" "PaymentProvider" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'UNPAID',
    "payout_status" "PayoutStatus" NOT NULL DEFAULT 'NONE',
    "food_amount" INTEGER NOT NULL,
    "platform_fee" INTEGER NOT NULL,
    "payable_amount" INTEGER NOT NULL,
    "seller_net" INTEGER NOT NULL,
    "bank_code" VARCHAR(20) NOT NULL,
    "account_no" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "transfer_content" VARCHAR(40) NOT NULL,
    "qr_image_url" VARCHAR(500) NOT NULL,
    "checkout_url" VARCHAR(500),
    "provider_tx_id" VARCHAR(120),
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "paid_at" TIMESTAMPTZ(3),
    "refunded_at" TIMESTAMPTZ(3),
    "refund_note" VARCHAR(500),
    "settled_at" TIMESTAMPTZ(3),
    "settle_note" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "seller_payout_accounts" (
    "account_id" UUID NOT NULL,
    "bank_code" VARCHAR(20) NOT NULL,
    "account_no" VARCHAR(40) NOT NULL,
    "account_name" VARCHAR(120) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "seller_payout_accounts_pkey" PRIMARY KEY ("account_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "payments_reservation_id_key" ON "payments"("reservation_id");

-- CreateIndex
CREATE UNIQUE INDEX "payments_transfer_content_key" ON "payments"("transfer_content");

-- CreateIndex
CREATE UNIQUE INDEX "payments_provider_tx_id_key" ON "payments"("provider_tx_id");

-- CreateIndex
CREATE INDEX "payments_status_created_at_idx" ON "payments"("status", "created_at");

-- CreateIndex
CREATE INDEX "payments_seller_id_payout_status_idx" ON "payments"("seller_id", "payout_status");

-- CreateIndex
CREATE INDEX "payments_expires_at_idx" ON "payments"("expires_at");

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "seller_payout_accounts" ADD CONSTRAINT "seller_payout_accounts_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Payment invariants (docs/DOMAIN.md v1.2 §6)
ALTER TABLE "payments"
  ADD CONSTRAINT "payments_food_amount_check" CHECK ("food_amount" >= 0),
  ADD CONSTRAINT "payments_platform_fee_check" CHECK ("platform_fee" >= 0),
  ADD CONSTRAINT "payments_payable_amount_check" CHECK ("payable_amount" = "food_amount" + "platform_fee"),
  ADD CONSTRAINT "payments_seller_net_check" CHECK ("seller_net" = "food_amount");
