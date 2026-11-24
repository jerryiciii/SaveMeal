-- SaveMeal v1.3: P2P direct bank QR payments, buyer transfer proof, seller manual confirm/reject.

-- AlterEnum
ALTER TYPE "ReservationStatus" ADD VALUE IF NOT EXISTS 'AWAITING_SELLER_CONFIRM';

-- AlterEnum
ALTER TYPE "CancelReason" ADD VALUE IF NOT EXISTS 'PAYMENT_REJECTED';

-- AlterEnum
ALTER TYPE "ImagePurpose" ADD VALUE IF NOT EXISTS 'PAYMENT_QR';
ALTER TYPE "ImagePurpose" ADD VALUE IF NOT EXISTS 'PAYMENT_PROOF';

-- AlterEnum
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'PROOF_SUBMITTED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'CONFIRMED';
ALTER TYPE "PaymentStatus" ADD VALUE IF NOT EXISTS 'REJECTED';

-- AlterTable accounts
ALTER TABLE "accounts"
  ADD COLUMN "bank_qr_image_id" UUID;

-- AlterTable food_listings
ALTER TABLE "food_listings"
  ADD COLUMN "bank_qr_image_id" UUID;

-- AlterTable payments: add v1.3 P2P fields and make legacy v1.2 gateway columns nullable/defaulted
ALTER TABLE "payments"
  ADD COLUMN "amount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "seller_qr_image_id" UUID,
  ADD COLUMN "proof_image_id" UUID,
  ADD COLUMN "proof_submitted_at" TIMESTAMPTZ(3),
  ADD COLUMN "confirmed_at" TIMESTAMPTZ(3),
  ADD COLUMN "rejected_at" TIMESTAMPTZ(3),
  ADD COLUMN "reject_reason" VARCHAR(300),
  ALTER COLUMN "provider" DROP NOT NULL,
  ALTER COLUMN "food_amount" SET DEFAULT 0,
  ALTER COLUMN "platform_fee" SET DEFAULT 0,
  ALTER COLUMN "payable_amount" SET DEFAULT 0,
  ALTER COLUMN "seller_net" SET DEFAULT 0,
  ALTER COLUMN "bank_code" DROP NOT NULL,
  ALTER COLUMN "account_no" DROP NOT NULL,
  ALTER COLUMN "account_name" DROP NOT NULL,
  ALTER COLUMN "transfer_content" DROP NOT NULL,
  ALTER COLUMN "qr_image_url" DROP NOT NULL;

-- Backfill amount for any existing payment rows
UPDATE "payments"
   SET "amount" = "payable_amount"
 WHERE "amount" = 0 AND "payable_amount" > 0;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_amount_check" CHECK ("amount" >= 0);

-- AddForeignKey
ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_bank_qr_image_id_fkey"
  FOREIGN KEY ("bank_qr_image_id") REFERENCES "listing_images"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "food_listings"
  ADD CONSTRAINT "food_listings_bank_qr_image_id_fkey"
  FOREIGN KEY ("bank_qr_image_id") REFERENCES "listing_images"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_seller_qr_image_id_fkey"
  FOREIGN KEY ("seller_qr_image_id") REFERENCES "listing_images"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "payments"
  ADD CONSTRAINT "payments_proof_image_id_fkey"
  FOREIGN KEY ("proof_image_id") REFERENCES "listing_images"("id")
  ON DELETE SET NULL ON UPDATE CASCADE;
