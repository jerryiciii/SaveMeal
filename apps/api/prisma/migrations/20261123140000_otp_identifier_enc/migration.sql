-- Pending OTP requests keep the identifier encrypted (AES-256-GCM) so the account can be created on
-- verify without storing the phone or email in clear. Rows are short-lived (purged by JOB-3).
ALTER TABLE "otp_requests" ADD COLUMN "identifier_enc" TEXT NOT NULL;
