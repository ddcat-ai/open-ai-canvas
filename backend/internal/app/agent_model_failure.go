package app

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net"
	"strings"
	"syscall"

	"yingce/backend/internal/model"
)

// Local failure reasons are separate from provider codes and display messages.
// Store them in the existing execution diagnostic so recovery survives a restart.
type agentModelFailureReason string

const (
	agentModelFailureEmpty       agentModelFailureReason = "model_empty_output"
	agentModelFailureArguments   agentModelFailureReason = "model_truncated_arguments"
	agentModelFailureStepTimeout agentModelFailureReason = "model_step_timeout"
	agentModelFailureTimeout     agentModelFailureReason = "model_request_timeout"
	agentModelFailureCancelled   agentModelFailureReason = "model_request_cancelled"
	agentModelFailureReset       agentModelFailureReason = "model_connection_reset"
	agentModelFailureRefused     agentModelFailureReason = "model_connection_refused"
	agentModelFailureEOF         agentModelFailureReason = "model_transport_eof"
	agentModelFailureDNS         agentModelFailureReason = "upstream_dns_failed"
	agentModelFailureTransient   agentModelFailureReason = "model_upstream_transient"
	agentModelFailurePermanent   agentModelFailureReason = "model_upstream_permanent"
	agentModelFailureSubmission  agentModelFailureReason = "model_submission_uncertain"
	agentModelFailureUnknown     agentModelFailureReason = "model_task_failed"
)

type agentModelFailureError struct {
	reason agentModelFailureReason
	err    error
}

func (e agentModelFailureError) Error() string { return e.err.Error() }
func (e agentModelFailureError) Unwrap() error { return e.err }

func agentModelFailure(reason agentModelFailureReason, err error) error {
	return agentModelFailureError{reason: reason, err: err}
}

func agentModelErrorReason(err error) agentModelFailureReason {
	var local agentModelFailureError
	if errors.As(err, &local) {
		return local.reason
	}
	if isRouteDispatchUncertain(err) {
		return agentModelFailureSubmission
	}
	var appErr *AppError
	if errors.As(err, &appErr) && appErr.Reason == ReasonUpstreamDNSFailed {
		return agentModelFailureDNS
	}
	var dns *net.DNSError
	if errors.As(err, &dns) {
		return agentModelFailureDNS
	}
	if errors.Is(err, context.DeadlineExceeded) {
		return agentModelFailureTimeout
	}
	if errors.Is(err, context.Canceled) {
		return agentModelFailureCancelled
	}
	if errors.Is(err, syscall.ECONNRESET) || errors.Is(err, syscall.EPIPE) {
		return agentModelFailureReset
	}
	if errors.Is(err, syscall.ECONNREFUSED) {
		return agentModelFailureRefused
	}
	if errors.Is(err, io.EOF) || errors.Is(err, io.ErrUnexpectedEOF) {
		return agentModelFailureEOF
	}
	var network net.Error
	if errors.As(err, &network) && network.Timeout() {
		return agentModelFailureTimeout
	}
	var httpErr providerHTTPError
	if errors.As(err, &httpErr) {
		return agentModelUpstreamReason(httpErr.StatusCode, agentModelProviderCode(httpErr.Body))
	}
	var payloadErr providerPayloadError
	if errors.As(err, &payloadErr) {
		return agentModelUpstreamReason(200, agentModelProviderCode(payloadErr.raw))
	}
	return agentModelFailureUnknown
}

func agentModelProviderCode(raw string) string {
	var payload map[string]any
	_ = json.Unmarshal([]byte(raw), &payload)
	code, _ := providerFailureDetails(payload)
	return code
}

func agentModelTaskReason(task *model.Task) agentModelFailureReason {
	if diagnostic := taskExecutionDiagnostic(task); diagnostic != nil {
		if diagnostic.Phase == "preparation" && diagnostic.RetryClass == "reconcile_submission" {
			return agentModelFailureSubmission
		}
		return agentModelFailureReason(diagnostic.Code)
	}
	return agentModelFailureUnknown
}

func agentModelUpstreamReason(status int, code string) agentModelFailureReason {
	if status == 408 {
		return agentModelFailureTimeout
	}
	if status == 429 || status >= 500 {
		return agentModelFailureTransient
	}
	if status >= 400 && status < 500 {
		return agentModelFailurePermanent
	}
	// Exact codes from the existing retry classifier; never inspect message text
	// or accept a known code as a substring of an unknown provider code.
	switch strings.ToLower(strings.TrimSpace(code)) {
	case "invalid_request", "authentication", "permission", "forbidden", "model_not_found", "insufficient_quota", "content_policy", "sensitive_words_detected", "safety":
		return agentModelFailurePermanent
	case "upstream_timeout":
		return agentModelFailureTimeout
	case "openai_error", "api_error", "server_error", "temporarily_unavailable", "service_unavailable", "overloaded", "gateway_error", "rate_limit", "too_many_requests":
		return agentModelFailureTransient
	}
	return agentModelFailureUnknown
}
