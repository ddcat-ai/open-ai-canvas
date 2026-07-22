package service

import "testing"

func TestValidateOutboundURLRejectsLocalAndLinkLocalHosts(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	for _, rawURL := range []string{"http://127.0.0.1:8080", "http://localhost:8080", "http://169.254.169.254/latest/meta-data"} {
		if _, err := ValidateOutboundURL(rawURL); err == nil {
			t.Fatalf("ValidateOutboundURL(%q) should fail", rawURL)
		}
	}
}

func TestValidateOutboundURLAllowsPrivateNetworkHosts(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	if _, err := ValidateOutboundURL("http://192.168.1.10:8080"); err != nil {
		t.Fatalf("ValidateOutboundURL() error = %v", err)
	}
}

func TestValidateOutboundURLAllowsExplicitPrivateUpstreamOverride(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	if _, err := ValidateOutboundURL("http://127.0.0.1:8080"); err != nil {
		t.Fatalf("ValidateOutboundURL() error = %v", err)
	}
}
