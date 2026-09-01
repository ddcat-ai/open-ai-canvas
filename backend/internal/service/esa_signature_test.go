package service

import (
	"testing"
)

func TestPopSignature(t *testing.T) {
	params := map[string]string{
		"Format":           "JSON",
		"Version":          "2024-09-10",
		"AccessKeyId":      "testid",
		"SignatureMethod":  "HMAC-SHA1",
		"Timestamp":        "2026-09-01T12:00:00Z",
		"SignatureVersion": "1.0",
		"SignatureNonce":   "random-nonce-123",
		"Action":           "DescribeSiteTimeSeriesData",
	}
	sig := calculatePopSignature("GET", params, "testsecret")
	if sig == "" {
		t.Fatalf("signature is empty")
	}
	t.Logf("Generated Signature: %s", sig)
}
