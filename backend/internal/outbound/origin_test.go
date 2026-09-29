package outbound

import "testing"

func TestNormalizeOrigin(t *testing.T) {
	for raw, want := range map[string]string{
		"https://API.Example.com":      "https://api.example.com",
		"https://api.example.com/":     "https://api.example.com",
		"https://api.example.com:443":  "https://api.example.com",
		"https://api.example.com:8443": "https://api.example.com:8443",
		"http://gateway.internal:80":   "http://gateway.internal",
		"http://gateway.internal:8080": "http://gateway.internal:8080",
		" https://api.example.com. ":   "https://api.example.com",
		"https://[2001:DB8::1]:443":    "https://[2001:db8::1]",
		"https://[2001:db8::1]:9443":   "https://[2001:db8::1]:9443",
	} {
		got, err := NormalizeOrigin(raw, false)
		if err != nil || got != want {
			t.Fatalf("NormalizeOrigin(%q) = %q, %v; want %q", raw, got, err, want)
		}
	}
	for _, raw := range []string{"api.example.com", "ftp://api.example.com", "https://user:pass@api.example.com", "https://*.example.com", "https://api.example.com/v1", "https://api.example.com?x=1", "https://api.example.com#frag", "https://api.example.com:0", "https://api.example.com:70000"} {
		if got, err := NormalizeOrigin(raw, false); err == nil {
			t.Fatalf("NormalizeOrigin(%q) = %q, want error", raw, got)
		}
	}
	// 请求地址的路径里可能出现 *，只有白名单项本身不允许通配符。
	if got, err := NormalizeOrigin("https://api.example.com/v1/models/*", true); err != nil || got != "https://api.example.com" {
		t.Fatalf("request URL with wildcard path = %q, %v", got, err)
	}
	if got, err := NormalizeOrigin("https://api.example.com:443/v1/chat/completions?stream=true", true); err != nil || got != "https://api.example.com" {
		t.Fatalf("request URL origin = %q, %v", got, err)
	}
}
