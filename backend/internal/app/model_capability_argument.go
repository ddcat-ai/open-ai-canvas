package app

import "errors"

// modelCapabilityArgumentError preserves the machine-readable field that caused
// a capability rejection while keeping the normal 400 AppError projection for
// non-Agent task callers.
type modelCapabilityArgumentError struct {
	*AppError
	Field string
	Issue string
}

func (e *modelCapabilityArgumentError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.AppError
}

func newModelCapabilityArgumentError(field, issue string, cause error) error {
	if cause == nil {
		cause = BadAuthRequest("模型能力参数无效")
	}
	return &modelCapabilityArgumentError{AppError: BadAuthRequest(cause.Error()), Field: field, Issue: issue}
}

func modelCapabilityMismatchError(match CapabilityMatch) error {
	details := map[string]any{"capabilityIssues": match.Issues}
	for _, issue := range match.Issues {
		field := issue.Name
		switch issue.Kind {
		case "option", "image_parameter":
			if field == "vquality" {
				field = "quality"
			}
		case "input":
			// 参考素材数量或类型不符时，调用方可减少参考或改选模型后重试。
			field = "referenceNodeIds"
		default:
			continue
		}
		details["field"] = field
		details["issue"] = "unsupported_value"
		details["message"] = issue.Reason
		break
	}
	return NewModelError(ErrCodeModelCapabilityNotSupported, "所选模型不支持当前请求").WithDetails(details)
}

func cloudAgentMediaCapabilityArgumentError(err error) error {
	if err == nil {
		return nil
	}
	var argumentErr *modelCapabilityArgumentError
	if errors.As(err, &argumentErr) && argumentErr != nil && argumentErr.Field != "" {
		return cloudAgentFieldError(argumentErr.Field, argumentErr.Issue, argumentErr.Error())
	}
	var modelErr *ModelError
	if errors.As(err, &modelErr) && modelErr != nil {
		field, _ := modelErr.Details["field"].(string)
		issue, _ := modelErr.Details["issue"].(string)
		if field != "" && issue != "" {
			message, _ := modelErr.Details["message"].(string)
			if message == "" {
				message = modelErr.Error()
			}
			return cloudAgentFieldError(field, issue, message+"；请按本回合 model_list 返回的能力参数修正后重试")
		}
	}
	return nil
}
