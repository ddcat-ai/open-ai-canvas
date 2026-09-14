package app

import (
	"context"
	"errors"
	"net/http"
	"testing"
)

func TestProviderTaskRecoveryContextSurvivesClientCancellation(t *testing.T) {
	type contextKey string
	parent, cancelParent := context.WithCancel(context.WithValue(context.Background(), contextKey("trace"), "trace-1"))
	cancelParent()

	recovery, cancelRecovery := providerTaskRecoveryContext(parent)
	defer cancelRecovery()
	if recovery.Err() != nil {
		t.Fatalf("recovery context inherited cancellation: %v", recovery.Err())
	}
	if recovery.Value(contextKey("trace")) != "trace-1" {
		t.Fatal("recovery context did not preserve request values")
	}
	if _, ok := recovery.Deadline(); !ok {
		t.Fatal("recovery context has no bounded deadline")
	}
}

func TestRetryableProtocolMediaDownload(t *testing.T) {
	for _, err := range []error{
		errors.New("net/http: TLS handshake timeout"),
		errors.New("read: connection reset by peer"),
		errors.New(`Get "https://download.example/image": read tcp 192.0.2.1:9615->198.51.100.1:443: wsarecv: An existing connection was forcibly closed by the remote host.`),
		errors.New("unexpected EOF"),
		providerHTTPError{StatusCode: http.StatusTooManyRequests},
		providerHTTPError{StatusCode: http.StatusBadGateway},
		providerHTTPError{StatusCode: http.StatusServiceUnavailable},
	} {
		if !retryableProtocolMediaDownload(err) {
			t.Fatalf("retryableProtocolMediaDownload(%v) = false", err)
		}
	}
	for _, err := range []error{
		context.Canceled,
		context.DeadlineExceeded,
		errors.New("HTTP 404"),
		providerHTTPError{StatusCode: http.StatusBadRequest},
		providerHTTPError{StatusCode: http.StatusUnauthorized},
		providerHTTPError{StatusCode: http.StatusNotFound},
	} {
		if retryableProtocolMediaDownload(err) {
			t.Fatalf("retryableProtocolMediaDownload(%v) = true", err)
		}
	}
}
