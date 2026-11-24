import type { ErrorCode } from '@savemeal/shared';

// User-safe Vietnamese messages (contract §0: "message is safe to show to users"). The FE may map
// `code` to its own copy. Domain-specific messages are added with the endpoints that raise them.
const MESSAGES: Partial<Record<ErrorCode, string>> = {
  VALIDATION_FAILED: 'Dữ liệu gửi lên chưa hợp lệ.',
  UNAUTHENTICATED: 'Bạn cần đăng nhập để tiếp tục.',
  TOKEN_EXPIRED: 'Phiên đăng nhập đã hết hạn.',
  FORBIDDEN: 'Bạn không có quyền thực hiện thao tác này.',
  NOT_FOUND: 'Không tìm thấy nội dung yêu cầu.',
  PAYMENT_NOT_FOUND: 'Không tìm thấy giao dịch thanh toán.',
  PAYMENT_NOT_CONFIRMABLE: 'Giao dịch này không thể xác nhận hoặc từ chối ở trạng thái hiện tại.',
  PAYMENT_HOLD_INVALID: 'Thời gian giữ chỗ thanh toán không hợp lệ.',
  PROOF_REQUIRED: 'Vui lòng tải lên ảnh biên lai chuyển khoản.',
  RATE_LIMITED: 'Bạn thao tác quá nhanh. Vui lòng thử lại sau.',
  FEATURE_DISABLED: 'Tính năng này hiện chưa được bật.',
  INTERNAL: 'Đã có lỗi xảy ra. Vui lòng thử lại sau.',
};

const FALLBACK = 'Yêu cầu không thực hiện được.';

export function defaultMessage(code: ErrorCode): string {
  return MESSAGES[code] ?? FALLBACK;
}
