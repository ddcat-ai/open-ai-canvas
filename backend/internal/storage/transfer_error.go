package storage

import (
	"context"
	"errors"
	"fmt"
	"net"
	"strings"
)

// ObjectTransferError keeps provider HTTP status separate from the user-facing
// message so delivery recovery can retry transient storage failures without
// retrying permission or configuration errors.
type ObjectTransferError struct {
	Provider   string
	Operation  string
	StatusCode int
	Detail     string
	Cause      error
}

func (e *ObjectTransferError) Error() string {
	if e == nil {
		return "对象存储传输失败"
	}
	label := strings.TrimSpace(strings.TrimSpace(e.Provider) + " " + strings.TrimSpace(e.Operation) + "失败")
	if label == "失败" {
		label = "对象存储传输失败"
	}
	if e.StatusCode > 0 {
		label += fmt.Sprintf("：HTTP %d", e.StatusCode)
	}
	if detail := strings.TrimSpace(e.Detail); detail != "" {
		return label + " " + detail
	}
	if e.Cause != nil {
		return label + "：" + e.Cause.Error()
	}
	return label
}

func (e *ObjectTransferError) Unwrap() error {
	if e == nil {
		return nil
	}
	return e.Cause
}

// Retryable is intentionally narrow: rate limits, server errors and transport
// timeouts can recover; authentication, permission and malformed requests do not.
func (e *ObjectTransferError) Retryable() bool {
	if e == nil {
		return false
	}
	if e.StatusCode == 408 || e.StatusCode == 429 || e.StatusCode >= 500 {
		return true
	}
	if errors.Is(e.Cause, context.DeadlineExceeded) {
		return true
	}
	var networkErr net.Error
	return errors.As(e.Cause, &networkErr) && (networkErr.Timeout() || networkErr.Temporary())
}

func newObjectTransferError(provider, operation string, statusCode int, detail string, cause error) error {
	return &ObjectTransferError{Provider: provider, Operation: operation, StatusCode: statusCode, Detail: detail, Cause: cause}
}
