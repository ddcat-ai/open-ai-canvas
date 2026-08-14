package service

import (
	"context"
	"net"
	"net/http"
	"net/http/httptest"
	"reflect"
	"strings"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm/schema"
)

func TestRuntimeCapabilitiesDoNotExposeWritableDesktopFlag(t *testing.T) {
	typeInfo := reflect.TypeOf(RuntimeCapabilities{})
	if field, ok := typeInfo.FieldByName("DesktopLocalChannels"); ok && field.IsExported() {
		t.Fatal("RuntimeCapabilities must not expose a writable DesktopLocalChannels field outside the service package")
	}
}

func TestRuntimeCapabilitiesRequireExplicitDesktopFlagAndLoopbackBind(t *testing.T) {
	tests := []struct {
		name    string
		bind    string
		setting string
		want    bool
	}{
		{name: "default disabled", bind: "127.0.0.1:8080", setting: "", want: false},
		{name: "explicit loopback desktop", bind: "127.0.0.1:8080", setting: "true", want: true},
		{name: "wildcard bind stays closed", bind: ":8080", setting: "true", want: false},
		{name: "all interfaces stays closed", bind: "0.0.0.0:8080", setting: "true", want: false},
		{name: "lan bind stays closed", bind: "192.168.1.5:8080", setting: "true", want: false},
		{name: "hostname bind is not a trusted bind identity", bind: "localhost:8080", setting: "true", want: false},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			capabilities := RuntimeCapabilitiesForDeployment(test.bind, test.setting)
			if capabilities.desktopLocalChannels != test.want {
				t.Fatalf("desktopLocalChannels = %v, want %v", capabilities.desktopLocalChannels, test.want)
			}
		})
	}
}

func TestModelChannelLocalFlagHasFalseMigrationDefault(t *testing.T) {
	parsed, err := schema.Parse(&model.ModelChannel{}, &sync.Map{}, schema.NamingStrategy{})
	if err != nil {
		t.Fatal(err)
	}
	field := parsed.LookUpField("AllowLocalChannel")
	if field == nil || !field.HasDefaultValue || strings.ToLower(strings.TrimSpace(field.DefaultValue)) != "false" {
		t.Fatalf("AllowLocalChannel migration field = %#v", field)
	}
	if (model.ModelChannel{}).AllowLocalChannel {
		t.Fatal("zero/legacy ModelChannel must default allowLocalChannel=false")
	}
}

func TestRuntimeFeatureAvailabilityExposesDesktopCapabilityReadOnly(t *testing.T) {
	svc := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	features := svc.withRuntimeCapabilities(publicFeatureAvailability(nil, defaultFeatureAvailability()))
	if !features.DesktopLocalChannelsEnabled {
		t.Fatal("public feature payload must expose the server-held desktop capability")
	}
	if writable := defaultFeatureAvailability(); writable.ShortDramaEnabled != features.ShortDramaEnabled || writable.TaskCenterEnabled != features.TaskCenterEnabled || writable.CreditsEnabled != features.CreditsEnabled {
		t.Fatal("runtime capability must not alter writable feature availability")
	}
}

func TestDesktopLocalChannelRequiresRequestedFlagAndServerCapability(t *testing.T) {
	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "true")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1,localhost")

	closed := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: false}}
	if _, err := closed.validateChannelOutboundURL("http://127.0.0.1:8000/v1/models", true, false); err == nil {
		t.Fatal("server capability=false must reject a forged requested allowLocalChannel=true even when legacy private overrides are enabled")
	}

	t.Setenv("CANVAS_ALLOW_PRIVATE_UPSTREAMS", "false")
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "")
	desktop := &Service{runtimeCapabilities: RuntimeCapabilities{desktopLocalChannels: true}}
	if _, err := desktop.validateChannelOutboundURL("http://127.0.0.1:8000/v1/models", false, false); err == nil {
		t.Fatal("requested allowLocalChannel=false must reject loopback")
	}
	for _, rawURL := range []string{
		"http://127.0.0.1:8000/v1/models",
		"http://localhost:8000/v1/models",
	} {
		if _, err := desktop.validateChannelOutboundURL(rawURL, true, false); err != nil {
			t.Fatalf("validateChannelOutboundURL(%q) error = %v", rawURL, err)
		}
	}
}

func TestDesktopLoopbackPolicyRejectsNonExactHostForms(t *testing.T) {
	policy := desktopLoopbackOutboundPolicy(nil)
	for _, rawURL := range []string{
		"http://[::1]:8000/v1/models",
		"http://[::ffff:127.0.0.1]:8000/v1/models",
		"http://0.0.0.0:8000/v1/models",
		"http://127.0.0.2:8000/v1/models",
		"http://127.1:8000/v1/models",
		"http://2130706433:8000/v1/models",
		"http://0x7f000001:8000/v1/models",
		"http://0177.0.0.1:8000/v1/models",
		"http://localhost.:8000/v1/models",
		"http://x.localhost:8000/v1/models",
		"http://127.0.0.1.evil.test:8000/v1/models",
		"http://user:pass@127.0.0.1:8000/v1/models",
		"http://127.0.0.1:8000/v1/models#fragment",
		"http://169.254.169.254/latest/meta-data",
		"http://10.0.0.1:8000/v1/models",
		"http://192.168.1.20:8000/v1/models",
	} {
		if _, err := validateOutboundURLWithPolicy(rawURL, policy); err == nil {
			t.Fatalf("validateOutboundURLWithPolicy(%q) should fail", rawURL)
		}
	}
}

func TestDesktopLocalRelayRequiresConfiguredBaseURLOrigin(t *testing.T) {
	if _, err := ValidateCustomRelayChannelURL("http://127.0.0.1:8000/v1/models", "http://127.0.0.1:8000", true, true); err != nil {
		t.Fatalf("same-origin local relay error = %v", err)
	}
	for _, baseURL := range []string{"", "http://127.0.0.1:8001", "http://localhost:8000"} {
		if _, err := ValidateCustomRelayChannelURL("http://127.0.0.1:8000/v1/models", baseURL, true, true); err == nil {
			t.Fatalf("configured Base URL %q must not authorize a different local origin", baseURL)
		}
	}
}

func TestDesktopLoopbackPolicyRejectsMixedLocalhostResolution(t *testing.T) {
	policy := desktopLoopbackOutboundPolicy(func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("127.0.0.1"), net.ParseIP("10.0.0.8")}, nil
	})
	if _, err := validateOutboundURLWithPolicy("http://localhost:8000/v1/models", policy); err == nil {
		t.Fatal("localhost must fail when any resolved address is not loopback")
	}
}

func TestDesktopLoopbackPolicyFallsBackAcrossValidatedLocalhostAddresses(t *testing.T) {
	listener, err := net.Listen("tcp4", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewUnstartedServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusNoContent)
	}))
	server.Listener = listener
	server.Start()
	defer server.Close()

	_, port, err := net.SplitHostPort(listener.Addr().String())
	if err != nil {
		t.Fatal(err)
	}
	policy := desktopLoopbackOutboundPolicy(func(context.Context, string) ([]net.IP, error) {
		return []net.IP{net.ParseIP("::1"), net.ParseIP("127.0.0.1")}, nil
	})
	request, _ := http.NewRequest(http.MethodGet, "http://localhost:"+port+"/health", nil)
	response, err := outboundHTTPClientWithPolicy(time.Second, policy).Do(request)
	if err != nil {
		t.Fatalf("dual-stack localhost request error = %v", err)
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusNoContent {
		t.Fatalf("status = %d, want %d", response.StatusCode, http.StatusNoContent)
	}
}

func TestDesktopLoopbackPolicyRechecksDNSAtDialTime(t *testing.T) {
	calls := 0
	policy := desktopLoopbackOutboundPolicy(func(context.Context, string) ([]net.IP, error) {
		calls++
		if calls == 1 {
			return []net.IP{net.ParseIP("127.0.0.1")}, nil
		}
		return []net.IP{net.ParseIP("10.0.0.9")}, nil
	})
	const rawURL = "http://localhost:18080/v1/models"
	if _, err := validateOutboundURLWithPolicy(rawURL, policy); err != nil {
		t.Fatalf("initial validation error = %v", err)
	}
	request, _ := http.NewRequest(http.MethodGet, rawURL, nil)
	_, err := outboundHTTPClientWithPolicy(500*time.Millisecond, policy).Do(request)
	if err == nil {
		t.Fatal("dial-time DNS rebinding to a non-loopback address must fail")
	}
	if calls < 2 {
		t.Fatalf("resolver calls = %d, want at least 2", calls)
	}
}

func TestDesktopLoopbackPolicyNeverFollowsRedirects(t *testing.T) {
	reachedTarget := false
	target := httptest.NewServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {
		reachedTarget = true
	}))
	defer target.Close()
	source := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.Header().Set("Location", target.URL+"/secret")
		w.WriteHeader(http.StatusFound)
	}))
	defer source.Close()

	policy := desktopLoopbackOutboundPolicy(nil)
	request, _ := http.NewRequest(http.MethodGet, source.URL+"/start", nil)
	response, err := outboundHTTPClientWithPolicy(time.Second, policy).Do(request)
	if err == nil {
		if response != nil {
			_ = response.Body.Close()
		}
		t.Fatal("desktop loopback client must reject redirects")
	}
	if reachedTarget {
		t.Fatal("redirect target must not receive the request")
	}
	if !strings.Contains(err.Error(), "重定向") {
		t.Fatalf("redirect error = %q", err.Error())
	}
}
