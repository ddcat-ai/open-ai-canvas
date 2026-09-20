package outbound

import (
	"context"
	"errors"
	"net"
	"net/http"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/kernel"
)

func TestOutboundDNSFailurePreservesCauseWithoutExposingHost(t *testing.T) {
	previous := net.DefaultResolver
	net.DefaultResolver = &net.Resolver{PreferGo: true, Dial: func(context.Context, string, string) (net.Conn, error) {
		return nil, errors.New("private-sentinel DNS transport unavailable")
	}}
	t.Cleanup(func() { net.DefaultResolver = previous })

	for _, validate := range []func(string) error{ValidateOutboundHost, validateCustomRelayHost} {
		err := validate("private-sentinel.invalid")
		var appErr *kernel.AppError
		var dnsErr *net.DNSError
		if !errors.As(err, &appErr) || appErr.Status != http.StatusBadGateway || appErr.Reason != kernel.ReasonUpstreamDNSFailed || appErr.Retryable {
			t.Fatalf("incorrect DNS failure classification: %#v", err)
		}
		if !errors.As(err, &dnsErr) {
			t.Fatal("DNS cause was discarded")
		}
		if strings.Contains(err.Error(), "private-sentinel") {
			t.Fatal("DNS details leaked into safe message")
		}
	}
	// Invalid destinations remain policy failures, never DNS/network failures.
	for _, host := range []string{"", "localhost", "127.0.0.1", "10.0.0.1"} {
		_, err := resolveOutboundHostWithPolicy(context.Background(), host, false)
		var badRequest *BadRequestError
		if !errors.As(err, &badRequest) {
			t.Fatalf("SSRF validation weakened for %q: %v", host, err)
		}
	}
}

func TestOutboundDNSCancellationKeepsCancellationSemantics(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := resolveOutboundHostWithPolicy(ctx, "cancelled.invalid", false)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("cancellation became a DNS failure: %v", err)
	}
}
