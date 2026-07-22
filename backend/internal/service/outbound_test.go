package service

import "testing"

func TestValidateOutboundURLRejectsPrivateHosts(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	for _, rawURL := range []string{"http://127.0.0.1:8080", "http://localhost:8080", "http://169.254.169.254/latest/meta-data"} {
		if _, err := ValidateOutboundURL(rawURL); err == nil {
			t.Fatalf("ValidateOutboundURL(%q) should fail", rawURL)
		}
	}
}

func TestValidateOutboundURLAllowsExplicitPrivateUpstreamOverride(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	if _, err := ValidateOutboundURL("http://127.0.0.1:8080"); err != nil {
		t.Fatalf("ValidateOutboundURL() error = %v", err)
	}
}

func TestValidateOutboundURLAllowsOnlyNamedPrivateUpstream(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	if _, err := ValidateOutboundURL("http://127.0.0.1:8080"); err != nil {
		t.Fatalf("ValidateOutboundURL() error = %v", err)
	}
	if _, err := ValidateOutboundURL("http://127.0.0.2:8080"); err == nil {
		t.Fatal("ValidateOutboundURL() should reject an unlisted private host")
	}
}

func TestAllowedPrivateUpstreamHostUsesExactCaseInsensitiveMatch(t *testing.T) {
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", " API.EXAMPLE.COM.,trusted.internal ")
	if !allowedPrivateUpstreamHost("api.example.com") {
		t.Fatal("allowedPrivateUpstreamHost() should allow exact normalized hostname")
	}
	if allowedPrivateUpstreamHost("api.example.com.evil.test") {
		t.Fatal("allowedPrivateUpstreamHost() should reject hostname suffix confusion")
	}
}
