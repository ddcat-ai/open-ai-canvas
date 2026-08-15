package service

import (
	"context"
	"net"
	"net/url"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestDesktopLocalChannelModeRejectsPublicAcrossProductionDispatch(t *testing.T) {
	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	requested := true
	const publicBaseURL = "https://8.8.8.8"

	if _, err := open.channelFromRequest(ChannelRequest{Name: "Public", BaseURL: publicBaseURL, AllowLocalChannel: &requested}, model.ModelChannel{Scope: model.ChannelScopeSystem}); err == nil {
		t.Fatal("saving allowLocalChannel=true with a public Base URL must fail")
	}
	if _, err := ValidateCustomRelayChannelURL(publicBaseURL+"/v1/models", publicBaseURL, true, true); err == nil {
		t.Fatal("custom relay allowLocalChannel=true must not fall back to the public relay policy")
	}
	if _, err := open.resolveProviderConfig(providerConfig{BaseURL: publicBaseURL, AllowLocalChannel: true}); err == nil {
		t.Fatal("generation provider allowLocalChannel=true must reject a public Base URL before dispatch")
	}
}

func TestDesktopLocalChannelModeOwnsOutboundPolicy(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1,localhost,192.168.1.20,169.254.169.254")
	open := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	closed := &Service{}

	for _, rawURL := range []string{
		"https://8.8.8.8/v1/models",
		"http://192.168.1.20:8000/v1/models",
		"http://169.254.169.254/latest/meta-data",
		"http://127.0.0.2:8000/v1/models",
		"http://localhost.:8000/v1/models",
		"http://[::1]:8000/v1/models",
	} {
		if _, err := open.validateChannelOutboundURL(rawURL, true, false); err == nil {
			t.Fatalf("allowLocalChannel=true must reject non-exact-loopback URL %q", rawURL)
		}
	}

	for _, rawURL := range []string{
		"http://127.0.0.1:8000/v1/models",
		"http://localhost:8000/v1/models",
	} {
		for _, customRelay := range []bool{false, true} {
			_, err := open.validateChannelOutboundURL(rawURL, false, customRelay)
			if err == nil || !strings.Contains(err.Error(), "不允许访问本机、内网或链路本地地址") {
				t.Fatalf("allowLocalChannel=false must reject exact loopback %q with canonical error, customRelay=%v: %v", rawURL, customRelay, err)
			}
		}
	}

	for _, customRelay := range []bool{false, true} {
		if _, err := open.validateChannelOutboundURL("https://8.8.8.8/v1/models", false, customRelay); err != nil {
			t.Fatalf("ordinary public channel must keep the existing outbound policy, customRelay=%v: %v", customRelay, err)
		}
	}

	for _, rawURL := range []string{
		"http://127.0.0.1:8000/v1/models",
		"https://8.8.8.8/v1/models",
	} {
		if _, err := closed.validateChannelOutboundURL(rawURL, true, false); err == nil {
			t.Fatalf("server capability=false must reject requested local mode for %q", rawURL)
		}
	}
}

func TestGoURLParserDesktopLoopbackPortBoundary(t *testing.T) {
	tests := []struct {
		rawURL   string
		wantErr  bool
		wantHost string
		wantPort string
	}{
		{rawURL: "http://localhost:", wantHost: "localhost", wantPort: ""},
		{rawURL: "http://localhost:0", wantHost: "localhost", wantPort: "0"},
		{rawURL: "http://localhost:65536", wantHost: "localhost", wantPort: "65536"},
		{rawURL: "http://localhost:abc", wantErr: true},
	}
	for _, test := range tests {
		parsed, err := url.Parse(test.rawURL)
		if test.wantErr {
			if err == nil {
				t.Fatalf("url.Parse(%q) error=nil, want parser error", test.rawURL)
			}
			continue
		}
		if err != nil {
			t.Fatalf("url.Parse(%q) error=%v", test.rawURL, err)
		}
		if parsed.Hostname() != test.wantHost || parsed.Port() != test.wantPort {
			t.Fatalf("url.Parse(%q) hostname=%q port=%q", test.rawURL, parsed.Hostname(), parsed.Port())
		}
	}
}

func TestDesktopLoopbackPolicyValidatesPortSyntaxAndRange(t *testing.T) {
	policy := desktopLoopbackOutboundPolicy(func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("127.0.0.1")}, nil
	})

	for _, rawURL := range []string{
		"http://localhost",
		"http://localhost:1/v1/models",
		"http://127.0.0.1:65535/v1/models",
	} {
		if _, err := validateOutboundURLWithPolicy(rawURL, policy); err != nil {
			t.Fatalf("strict local URL %q must be accepted: %v", rawURL, err)
		}
	}

	for _, rawURL := range []string{
		"http://localhost:/v1/models",
		"http://localhost:0/v1/models",
		"http://localhost:65536/v1/models",
		"http://localhost:abc/v1/models",
		"http://localhost:+1/v1/models",
		"http://localhost:-1/v1/models",
		"http://localhost:0x50/v1/models",
	} {
		if _, err := validateOutboundURLWithPolicy(rawURL, policy); err == nil {
			t.Fatalf("strict local URL %q must reject invalid port syntax/range", rawURL)
		}
	}
}
