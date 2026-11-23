-- CreateEnum
CREATE TYPE "UserRole" AS ENUM ('USER', 'ADMIN');

-- CreateEnum
CREATE TYPE "AccountStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'DELETED');

-- CreateEnum
CREATE TYPE "OtpChannel" AS ENUM ('SMS', 'EMAIL');

-- CreateEnum
CREATE TYPE "SellerType" AS ENUM ('INDIVIDUAL', 'SHOP', 'CAFE', 'BAKERY', 'CANTEEN');

-- CreateEnum
CREATE TYPE "Category" AS ENUM ('BAKERY', 'MEAL', 'DRINK', 'PACKAGED', 'OTHER');

-- CreateEnum
CREATE TYPE "Storage" AS ENUM ('ROOM_TEMP', 'CHILLED', 'FROZEN');

-- CreateEnum
CREATE TYPE "Allergen" AS ENUM ('GLUTEN', 'MILK', 'EGG', 'PEANUT', 'TREE_NUT', 'SOY', 'FISH', 'SHELLFISH', 'SESAME');

-- CreateEnum
CREATE TYPE "ListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'EXPIRED', 'WITHDRAWN', 'BLOCKED');

-- CreateEnum
CREATE TYPE "ReservationStatus" AS ENUM ('RESERVED', 'COMPLETED', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "CancelReason" AS ENUM ('BUYER_LATE', 'BUYER_WRONG_QTY', 'BUYER_CHANGED_PLAN', 'BUYER_OTHER', 'SELLER_WITHDREW', 'LISTING_BLOCKED', 'ADMIN');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('WRONG_INFO', 'UNSAFE_FOOD', 'NOT_RECEIVED', 'SELLER_ABSENT', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('OPEN', 'IN_REVIEW', 'RESOLVED', 'DISMISSED');

-- CreateEnum
CREATE TYPE "ReportAction" AS ENUM ('NONE', 'WARNING', 'LISTING_BLOCKED', 'ACCOUNT_SUSPENDED');

-- CreateEnum
CREATE TYPE "ImagePurpose" AS ENUM ('LISTING', 'REPORT', 'AVATAR');

-- CreateEnum
CREATE TYPE "ActorType" AS ENUM ('USER', 'ADMIN', 'SYSTEM');

-- CreateTable
CREATE TABLE "accounts" (
    "id" UUID NOT NULL,
    "phone" VARCHAR(20),
    "email" VARCHAR(254),
    "display_name" VARCHAR(40),
    "avatar_image_id" UUID,
    "role" "UserRole" NOT NULL DEFAULT 'USER',
    "status" "AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "suspended_reason" VARCHAR(300),
    "seller_name" VARCHAR(80),
    "seller_type" "SellerType",
    "seller_verified_at" TIMESTAMPTZ(3),
    "seller_verified_by" UUID,
    "default_pickup_address" VARCHAR(200),
    "default_pickup_lat" DOUBLE PRECISION,
    "default_pickup_lng" DOUBLE PRECISION,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "deleted_at" TIMESTAMPTZ(3),

    CONSTRAINT "accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "otp_requests" (
    "id" UUID NOT NULL,
    "channel" "OtpChannel" NOT NULL,
    "identifier_hash" VARCHAR(128) NOT NULL,
    "ip_hash" VARCHAR(128),
    "code_hash" VARCHAR(128) NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "consumed_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "refresh_tokens" (
    "id" UUID NOT NULL,
    "account_id" UUID NOT NULL,
    "token_hash" VARCHAR(128) NOT NULL,
    "family_id" UUID NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "revoked_at" TIMESTAMPTZ(3),
    "user_agent" VARCHAR(255),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "food_listings" (
    "id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "title" VARCHAR(80) NOT NULL,
    "description" VARCHAR(500),
    "category" "Category" NOT NULL,
    "origin" VARCHAR(200),
    "prepared_at" TIMESTAMPTZ(3),
    "storage" "Storage",
    "storage_note" VARCHAR(200),
    "ingredients" VARCHAR(300),
    "allergens" "Allergen"[] DEFAULT ARRAY[]::"Allergen"[],
    "original_price" INTEGER,
    "price" INTEGER,
    "quantity_total" INTEGER,
    "quantity_available" INTEGER NOT NULL DEFAULT 0,
    "pickup_start" TIMESTAMPTZ(3),
    "pickup_end" TIMESTAMPTZ(3),
    "pickup_address" VARCHAR(200),
    "pickup_lat" DOUBLE PRECISION,
    "pickup_lng" DOUBLE PRECISION,
    "declaration" JSONB,
    "declared_at" TIMESTAMPTZ(3),
    "status" "ListingStatus" NOT NULL DEFAULT 'DRAFT',
    "under_review" BOOLEAN NOT NULL DEFAULT false,
    "published_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),
    "close_reason" VARCHAR(300),
    "blocked_reason" VARCHAR(300),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "food_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "listing_images" (
    "id" UUID NOT NULL,
    "listing_id" UUID,
    "uploader_id" UUID NOT NULL,
    "purpose" "ImagePurpose" NOT NULL DEFAULT 'LISTING',
    "storage_key" VARCHAR(255) NOT NULL,
    "width" INTEGER NOT NULL,
    "height" INTEGER NOT NULL,
    "bytes" INTEGER NOT NULL,
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "listing_images_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reservations" (
    "id" UUID NOT NULL,
    "listing_id" UUID NOT NULL,
    "buyer_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unit_price" INTEGER NOT NULL,
    "total_price" INTEGER NOT NULL,
    "code" VARCHAR(4) NOT NULL,
    "status" "ReservationStatus" NOT NULL DEFAULT 'RESERVED',
    "cancel_reason" "CancelReason",
    "cancel_note" VARCHAR(200),
    "idempotency_key" VARCHAR(64) NOT NULL,
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,
    "completed_at" TIMESTAMPTZ(3),
    "closed_at" TIMESTAMPTZ(3),

    CONSTRAINT "reservations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pickup_tokens" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "token_hash" VARCHAR(64) NOT NULL,
    "expires_at" TIMESTAMPTZ(3) NOT NULL,
    "used_at" TIMESTAMPTZ(3),
    "revoked_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pickup_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reports" (
    "id" UUID NOT NULL,
    "reporter_id" UUID NOT NULL,
    "type" "ReportType" NOT NULL,
    "listing_id" UUID,
    "reservation_id" UUID,
    "reported_account_id" UUID NOT NULL,
    "description" VARCHAR(1000) NOT NULL,
    "image_ids" UUID[] DEFAULT ARRAY[]::UUID[],
    "status" "ReportStatus" NOT NULL DEFAULT 'OPEN',
    "action" "ReportAction",
    "resolution" VARCHAR(1000),
    "handled_by" UUID,
    "handled_at" TIMESTAMPTZ(3),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "event_logs" (
    "id" UUID NOT NULL,
    "actor_id" UUID,
    "actor_type" "ActorType" NOT NULL,
    "event" VARCHAR(60) NOT NULL,
    "entity_type" VARCHAR(40) NOT NULL,
    "entity_id" UUID NOT NULL,
    "data" JSONB NOT NULL DEFAULT '{}',
    "at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "event_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "feedback" (
    "id" UUID NOT NULL,
    "reservation_id" UUID NOT NULL,
    "author_id" UUID NOT NULL,
    "seller_id" UUID NOT NULL,
    "rating" SMALLINT NOT NULL,
    "comment" VARCHAR(500),
    "created_at" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "transaction_metrics" (
    "date" DATE NOT NULL,
    "seller_id" UUID NOT NULL,
    "listings_published" INTEGER NOT NULL DEFAULT 0,
    "listings_expired_with_stock" INTEGER NOT NULL DEFAULT 0,
    "portions_listed" INTEGER NOT NULL DEFAULT 0,
    "portions_reserved" INTEGER NOT NULL DEFAULT 0,
    "portions_handed_over" INTEGER NOT NULL DEFAULT 0,
    "reservations_created" INTEGER NOT NULL DEFAULT 0,
    "reservations_completed" INTEGER NOT NULL DEFAULT 0,
    "reservations_cancelled" INTEGER NOT NULL DEFAULT 0,
    "reservations_expired" INTEGER NOT NULL DEFAULT 0,
    "discount_rate_sum" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "discount_samples" INTEGER NOT NULL DEFAULT 0,
    "updated_at" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "transaction_metrics_pkey" PRIMARY KEY ("date","seller_id")
);

-- CreateIndex
CREATE UNIQUE INDEX "accounts_phone_key" ON "accounts"("phone");

-- CreateIndex
CREATE UNIQUE INDEX "accounts_email_key" ON "accounts"("email");

-- CreateIndex
CREATE INDEX "accounts_status_idx" ON "accounts"("status");

-- CreateIndex
CREATE INDEX "otp_requests_identifier_hash_created_at_idx" ON "otp_requests"("identifier_hash", "created_at");

-- CreateIndex
CREATE INDEX "otp_requests_ip_hash_created_at_idx" ON "otp_requests"("ip_hash", "created_at");

-- CreateIndex
CREATE INDEX "otp_requests_expires_at_idx" ON "otp_requests"("expires_at");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_token_hash_key" ON "refresh_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "refresh_tokens_family_id_idx" ON "refresh_tokens"("family_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_account_id_idx" ON "refresh_tokens"("account_id");

-- CreateIndex
CREATE INDEX "refresh_tokens_expires_at_idx" ON "refresh_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "food_listings_status_pickup_end_idx" ON "food_listings"("status", "pickup_end");

-- CreateIndex
CREATE INDEX "food_listings_seller_id_status_idx" ON "food_listings"("seller_id", "status");

-- CreateIndex
CREATE INDEX "food_listings_pickup_lat_pickup_lng_idx" ON "food_listings"("pickup_lat", "pickup_lng");

-- CreateIndex
CREATE UNIQUE INDEX "listing_images_storage_key_key" ON "listing_images"("storage_key");

-- CreateIndex
CREATE INDEX "listing_images_listing_id_position_idx" ON "listing_images"("listing_id", "position");

-- CreateIndex
CREATE INDEX "listing_images_uploader_id_created_at_idx" ON "listing_images"("uploader_id", "created_at");

-- CreateIndex
CREATE INDEX "reservations_listing_id_status_idx" ON "reservations"("listing_id", "status");

-- CreateIndex
CREATE INDEX "reservations_seller_id_status_idx" ON "reservations"("seller_id", "status");

-- CreateIndex
CREATE INDEX "reservations_buyer_id_status_idx" ON "reservations"("buyer_id", "status");

-- CreateIndex
CREATE INDEX "reservations_status_created_at_idx" ON "reservations"("status", "created_at");

-- CreateIndex
CREATE UNIQUE INDEX "reservations_buyer_id_idempotency_key_key" ON "reservations"("buyer_id", "idempotency_key");

-- CreateIndex
CREATE UNIQUE INDEX "pickup_tokens_token_hash_key" ON "pickup_tokens"("token_hash");

-- CreateIndex
CREATE INDEX "pickup_tokens_reservation_id_created_at_idx" ON "pickup_tokens"("reservation_id", "created_at");

-- CreateIndex
CREATE INDEX "pickup_tokens_expires_at_idx" ON "pickup_tokens"("expires_at");

-- CreateIndex
CREATE INDEX "reports_status_created_at_idx" ON "reports"("status", "created_at");

-- CreateIndex
CREATE INDEX "reports_type_idx" ON "reports"("type");

-- CreateIndex
CREATE INDEX "reports_reporter_id_created_at_idx" ON "reports"("reporter_id", "created_at");

-- CreateIndex
CREATE INDEX "event_logs_entity_type_entity_id_at_idx" ON "event_logs"("entity_type", "entity_id", "at");

-- CreateIndex
CREATE INDEX "event_logs_event_at_idx" ON "event_logs"("event", "at");

-- CreateIndex
CREATE UNIQUE INDEX "feedback_reservation_id_key" ON "feedback"("reservation_id");

-- CreateIndex
CREATE INDEX "feedback_seller_id_created_at_idx" ON "feedback"("seller_id", "created_at");

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_avatar_image_id_fkey" FOREIGN KEY ("avatar_image_id") REFERENCES "listing_images"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_seller_verified_by_fkey" FOREIGN KEY ("seller_verified_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "refresh_tokens" ADD CONSTRAINT "refresh_tokens_account_id_fkey" FOREIGN KEY ("account_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "food_listings" ADD CONSTRAINT "food_listings_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "food_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "listing_images" ADD CONSTRAINT "listing_images_uploader_id_fkey" FOREIGN KEY ("uploader_id") REFERENCES "accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "food_listings"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_buyer_id_fkey" FOREIGN KEY ("buyer_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reservations" ADD CONSTRAINT "reservations_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pickup_tokens" ADD CONSTRAINT "pickup_tokens_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reporter_id_fkey" FOREIGN KEY ("reporter_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reported_account_id_fkey" FOREIGN KEY ("reported_account_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_handled_by_fkey" FOREIGN KEY ("handled_by") REFERENCES "accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_listing_id_fkey" FOREIGN KEY ("listing_id") REFERENCES "food_listings"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reports" ADD CONSTRAINT "reports_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_reservation_id_fkey" FOREIGN KEY ("reservation_id") REFERENCES "reservations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_author_id_fkey" FOREIGN KEY ("author_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "feedback" ADD CONSTRAINT "feedback_seller_id_fkey" FOREIGN KEY ("seller_id") REFERENCES "accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- ---------------------------------------------------------------------------------------------
-- Invariants Prisma cannot express (docs/DOMAIN.md v1.1)
-- ---------------------------------------------------------------------------------------------

-- D§6: stock can never go negative or above the total, whatever the code does.
ALTER TABLE "food_listings"
  ADD CONSTRAINT "food_listings_quantity_check"
    CHECK ("quantity_available" >= 0 AND "quantity_available" <= "quantity_total"),
  ADD CONSTRAINT "food_listings_quantity_total_check"
    CHECK ("quantity_total" IS NULL OR "quantity_total" BETWEEN 1 AND 50),
  ADD CONSTRAINT "food_listings_price_check"
    CHECK ("price" IS NULL OR "price" >= 0),
  ADD CONSTRAINT "food_listings_original_price_check"
    CHECK ("original_price" IS NULL OR "original_price" >= 0),
  ADD CONSTRAINT "food_listings_pickup_window_check"
    CHECK ("pickup_start" IS NULL OR "pickup_end" IS NULL OR "pickup_start" < "pickup_end");

-- A listing that was ever published carries the full required info and the declaration (D§5),
-- so no code path can publish an incomplete listing. PUBLISHED/EXPIRED/BLOCKED all imply it was
-- published (a DRAFT may still be WITHDRAWN while incomplete).
ALTER TABLE "food_listings"
  ADD CONSTRAINT "food_listings_published_complete_check"
    CHECK ("published_at" IS NULL OR (
      "origin" IS NOT NULL AND "prepared_at" IS NOT NULL AND "storage" IS NOT NULL
      AND "price" IS NOT NULL AND "quantity_total" IS NOT NULL
      AND "pickup_start" IS NOT NULL AND "pickup_end" IS NOT NULL
      AND "pickup_address" IS NOT NULL AND "pickup_lat" IS NOT NULL AND "pickup_lng" IS NOT NULL
      AND "declaration" IS NOT NULL AND "declared_at" IS NOT NULL)),
  ADD CONSTRAINT "food_listings_published_status_check"
    CHECK ("status" NOT IN ('PUBLISHED', 'EXPIRED', 'BLOCKED') OR "published_at" IS NOT NULL);

ALTER TABLE "reservations"
  ADD CONSTRAINT "reservations_quantity_check" CHECK ("quantity" >= 1),
  ADD CONSTRAINT "reservations_total_check" CHECK ("unit_price" >= 0 AND "total_price" = "unit_price" * "quantity"),
  ADD CONSTRAINT "reservations_code_check" CHECK ("code" ~ '^[0-9]{4}$'),
  ADD CONSTRAINT "reservations_not_own_listing_check" CHECK ("buyer_id" <> "seller_id");

-- D§6: one active reservation per account per listing.
CREATE UNIQUE INDEX "reservations_one_active_per_buyer_listing"
  ON "reservations" ("buyer_id", "listing_id") WHERE "status" = 'RESERVED';

-- D§2: the 4-digit code is unique among the seller's active (RESERVED) orders.
CREATE UNIQUE INDEX "reservations_code_unique_active_per_seller"
  ON "reservations" ("seller_id", "code") WHERE "status" = 'RESERVED';

-- D§6: a reservation can be handed over once, so at most one token is ever used.
CREATE UNIQUE INDEX "pickup_tokens_one_used_per_reservation"
  ON "pickup_tokens" ("reservation_id") WHERE "used_at" IS NOT NULL;

ALTER TABLE "feedback"
  ADD CONSTRAINT "feedback_rating_check" CHECK ("rating" BETWEEN 1 AND 5);

-- D§2: event_logs is append-only evidence.
CREATE FUNCTION "event_logs_append_only"() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  RAISE EXCEPTION 'event_logs is append-only (% rejected)', TG_OP;
END;
$$;

CREATE TRIGGER "event_logs_no_update_delete"
  BEFORE UPDATE OR DELETE ON "event_logs"
  FOR EACH ROW EXECUTE FUNCTION "event_logs_append_only"();
