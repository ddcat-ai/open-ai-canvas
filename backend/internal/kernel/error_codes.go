package kernel

// 业务信封 code：成功为 0；失败默认等于 HTTP 状态。需要区分同一状态的不同原因时，用 status*100+n。
// 不使用与 HTTP 无关的 1001/2001 号段，避免和现有 42901 以及前端按 status/code 判断重试打架。
const (
	CodeOK = 0

	CodeInvalidArgument = 400
	CodeUnauthorized    = 401
	CodeForbidden       = 403
	CodeNotFound        = 404
	CodeConflict        = 409
	CodeTooManyRequests = 429
	CodeInternal        = 500
	CodeBadGateway      = 502
	CodeUnavailable     = 503
	CodeTimeout         = 504

	CodeQuotaExceeded       = 40301
	CodeIdempotencyConflict = 40901
	CodeRateLimited         = 42901
)

// ErrorReason 是稳定机器可读原因，前端应判断 reason 而不是解析 msg。
type ErrorReason string

const (
	ReasonInvalidArgument    ErrorReason = "invalid_argument"
	ReasonUnauthorized       ErrorReason = "unauthorized"
	ReasonForbidden          ErrorReason = "forbidden"
	ReasonNotFound           ErrorReason = "not_found"
	ReasonConflict           ErrorReason = "conflict"
	ReasonFailedPrecondition ErrorReason = "failed_precondition"
	ReasonQuotaExceeded      ErrorReason = "quota_exceeded"
	ReasonRateLimited        ErrorReason = "rate_limited"
	ReasonUnavailable        ErrorReason = "unavailable"
	ReasonTimeout            ErrorReason = "timeout"
	ReasonInternal           ErrorReason = "internal"
	ReasonBadGateway         ErrorReason = "bad_gateway"
)

func ReasonForStatus(status int) ErrorReason {
	switch status {
	case CodeInvalidArgument:
		return ReasonInvalidArgument
	case CodeUnauthorized:
		return ReasonUnauthorized
	case CodeForbidden:
		return ReasonForbidden
	case CodeNotFound:
		return ReasonNotFound
	case CodeConflict:
		return ReasonConflict
	case CodeTooManyRequests:
		return ReasonRateLimited
	case CodeBadGateway:
		return ReasonBadGateway
	case CodeUnavailable:
		return ReasonUnavailable
	case CodeTimeout:
		return ReasonTimeout
	default:
		if status >= 500 {
			return ReasonInternal
		}
		return ReasonInvalidArgument
	}
}
