/** Error envelope and catalogue from docs/API_CONTRACT.md §0 and §15. */

export const ERROR_CODES = [
  "VALIDATION_FAILED",
  "OTP_INVALID",
  "OTP_EXPIRED",
  "UNAUTHENTICATED",
  "TOKEN_EXPIRED",
  "REFRESH_INVALID",
  "GOOGLE_TOKEN_INVALID",
  "FORBIDDEN",
  "ACCOUNT_SUSPENDED",
  "STORE_SUSPENDED",
  "FEATURE_DISABLED",
  "OWN_STORE_RESERVATION",
  "NOT_FOUND",
  "STORE_NOT_FOUND",
  "BATCH_NOT_FOUND",
  "RESERVATION_NOT_FOUND",
  "IMAGE_NOT_FOUND",
  "INCIDENT_NOT_FOUND",
  "PAYMENT_NOT_FOUND",
  "MEMBER_USER_NOT_FOUND",
  "INVALID_STATE_TRANSITION",
  "STORE_ALREADY_EXISTS",
  "STORE_NOT_VERIFIED",
  "STORE_REJECTED",
  "MEMBER_ALREADY_EXISTS",
  "CANNOT_REMOVE_OWNER",
  "FIELD_LOCKED",
  "QUANTITY_BELOW_RESERVED",
  "PRICE_INCREASE_NOT_ALLOWED",
  "PICKUP_WINDOW_EXTENSION_NOT_ALLOWED",
  "SAFETY_CHECK_STALE",
  "PAUSED_BY_INCIDENT",
  "BATCH_SOLD_OUT",
  "BATCH_NOT_AVAILABLE",
  "ACTIVE_RESERVATION_LIMIT",
  "ALREADY_RESERVED",
  "RESERVATION_NOT_ACTIVE",
  "CANCEL_WINDOW_CLOSED",
  "PICKUP_TOO_EARLY",
  "PICKUP_WINDOW_CLOSED",
  "PAYMENT_PENDING",
  "BATCH_REMOVED_UNSAFE",
  "NO_SHOW_TOO_EARLY",
  "PAYMENT_NOT_PENDING",
  "REFUND_NOT_DUE",
  "CHAT_CLOSED",
  "REVIEW_NOT_ALLOWED",
  "REVIEW_EXISTS",
  "WASTE_LOG_EXISTS",
  "WASTE_LOG_LOCKED",
  "IMAGE_IN_USE",
  "ACCOUNT_HAS_ACTIVE_ITEMS",
  "IMAGE_TOO_LARGE",
  "IMAGE_TYPE_UNSUPPORTED",
  "SAFETY_CHECK_FAILED",
  "BATCH_INCOMPLETE",
  "PICKUP_WINDOW_INVALID",
  "QUANTITY_LIMIT_EXCEEDED",
  "PICKUP_CODE_INVALID",
  "INCIDENT_TARGET_INVALID",
  "IDEMPOTENCY_KEY_REUSED",
  "MEMBER_LIMIT",
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
