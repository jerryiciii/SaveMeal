-- v1.3.1: Opt-in nearby listing email alerts (DOMAIN.md D15)

ALTER TABLE "accounts"
  ADD COLUMN "nearby_alerts_enabled" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "nearby_alert_lat" DOUBLE PRECISION,
  ADD COLUMN "nearby_alert_lng" DOUBLE PRECISION,
  ADD COLUMN "nearby_alert_radius_km" INTEGER NOT NULL DEFAULT 3,
  ADD COLUMN "nearby_alert_last_sent_at" TIMESTAMPTZ(3);

ALTER TABLE "accounts"
  ADD CONSTRAINT "accounts_nearby_alert_radius_km_check"
  CHECK ("nearby_alert_radius_km" IN (1, 3, 5));

CREATE INDEX "accounts_nearby_alerts_active_idx"
  ON "accounts" ("nearby_alert_lat", "nearby_alert_lng")
  WHERE "nearby_alerts_enabled" = true AND "status" = 'ACTIVE' AND "email" IS NOT NULL;
