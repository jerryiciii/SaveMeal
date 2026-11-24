/** Error envelope and catalogue from docs/API_CONTRACT.md v1.1 §0 and §16. */

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "REFRESH_INVALID",
  "FORBIDDEN",
  "ACCOUNT_SUSPENDED",
  "FEATURE_DISABLED",
  "OWN_LISTING_RESERVATION",
  "NOT_FOUND",
  "LISTING_NOT_FOUND",
  "RESERVATION_NOT_FOUND",
  "SELLER_NOT_FOUND",
  "IMAGE_NOT_FOUND",
  "REPORT_NOT_FOUND",
  "ACCOUNT_NOT_FOUND",
  "INVALID_STATE_TRANSITION",
  "FIELD_LOCKED",
  "QUANTITY_BELOW_RESERVED",
  "PRICE_INCREASE_NOT_ALLOWED",
  "PICKUP_WINDOW_EXTENSION_NOT_ALLOWED",
  "LISTING_SOLD_OUT",
  "LISTING_NOT_AVAILABLE",
  "LISTING_BLOCKED",
  "ACTIVE_RESERVATION_LIMIT",
  "ALREADY_RESERVED",
  "RESERVATION_NOT_ACTIVE",
  "CANCEL_WINDOW_CLOSED",
  "PICKUP_TOO_EARLY",
  "PICKUP_WINDOW_CLOSED",
  "PICKUP_TOKEN_EXPIRED",
  "PICKUP_TOKEN_USED",
  "IMAGE_IN_USE",
  "ACCOUNT_HAS_ACTIVE_ITEMS",
  "IMAGE_TOO_LARGE",
  "IMAGE_TYPE_UNSUPPORTED",
  "LISTING_INCOMPLETE",
  "DECLARATION_INCOMPLETE",
  "LISTING_TOO_OLD",
  "LISTING_LIMIT",
  "PICKUP_WINDOW_INVALID",
  "QUANTITY_LIMIT_EXCEEDED",
  "PICKUP_TOKEN_INVALID",
  "PICKUP_CODE_INVALID",
  "REPORT_TARGET_INVALID",
  "IDEMPOTENCY_KEY_REUSED",
  "RATE_LIMITED",
  "OTP_TOO_MANY_ATTEMPTS",
  "INTERNAL",
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export type ErrorBody = {
  error: {
    code: ErrorCode;
    message: string;
    details?: Record<string, unknown>;
    requestId?: string;
  };
};

export class ApiError extends Error {
  readonly status: number;
  readonly code: ErrorCode | "NETWORK_ERROR";
  readonly details: Record<string, unknown> | undefined;
  readonly requestId: string | undefined;

  constructor(
    status: number,
    code: ErrorCode | "NETWORK_ERROR",
    message: string,
    details?: Record<string, unknown>,
    requestId?: string,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
    this.requestId = requestId;
  }
}

export function isErrorBody(value: unknown): value is ErrorBody {
  if (typeof value !== "object" || value === null || !("error" in value)) return false;
  const err = (value as { error: unknown }).error;
  return typeof err === "object" && err !== null && typeof (err as { code?: unknown }).code === "string";
}
