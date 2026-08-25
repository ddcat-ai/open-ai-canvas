package handler

import "testing"

func TestShortSystemProxyPath(t *testing.T) {
	tests := []struct {
		path     string
		channel  string
		provider string
		ok       bool
	}{
		{path: "/api/channel-1/chat/completions", channel: "channel-1", provider: "/chat/completions", ok: true},
		{path: "/api/channel-1/v1/models", channel: "channel-1", provider: "/v1/models", ok: true},
		{path: "/api/tasks/123", ok: false},
		{path: "/api/diagnostics/export", ok: false},
		{path: "/api/channel-1", ok: false},
		{path: "/api//chat/completions", ok: false},
		{path: "/other/channel-1/chat/completions", ok: false},
	}
	for _, test := range tests {
		channel, provider, ok := shortSystemProxyPath(test.path)
		if ok != test.ok || channel != test.channel || provider != test.provider {
			t.Errorf("shortSystemProxyPath(%q) = (%q, %q, %v), want (%q, %q, %v)", test.path, channel, provider, ok, test.channel, test.provider, test.ok)
		}
	}
}
