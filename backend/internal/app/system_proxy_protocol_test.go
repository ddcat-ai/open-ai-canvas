package app

import (
	"net/http"
	"reflect"
	"testing"

	"yingce/backend/internal/model"
)

func TestSystemProxyDeclaredPostPathsFollowInstalledPlugin(t *testing.T) {
	s := &Service{}
	tests := map[model.ChannelInterfaceType][]string{
		"deepseek-chat":   {"/chat/completions"},
		"a6api-chat":      {"/chat/completions"},
		"openai-response": {"/responses"},
		"claude-api":      {"/messages"},
		// 系统代理不展开模板变量，Azure 的部署路径不会和浏览器的 /chat/completions 相等。
		"azure-openai": {"/openai/deployments/{model}/chat/completions"},
	}
	for protocolID, want := range tests {
		contract, err := s.ResolveSystemProxyContract(protocolID, "")
		if err != nil {
			t.Fatal(err)
		}
		if got := contract.DeclaredPostPaths(); !reflect.DeepEqual(got, want) {
			t.Errorf("SystemProxyDeclaredPostPaths(%s) = %#v, want %#v", protocolID, got, want)
		}
	}
	if _, err := s.ResolveSystemProxyContract("not-installed-protocol", ""); err == nil {
		t.Fatal("uninstalled protocol was accepted")
	}
}

func TestApplySystemProxyAuthFollowsDeclaredAuth(t *testing.T) {
	s := &Service{}
	channel := &model.ModelChannel{APIKey: "api-key-value", SecretKey: "secret-value", APIFormat: "openai"}
	tests := []struct {
		protocol model.ChannelInterfaceType
		header   string
		value    string
		absent   string
	}{
		{"deepseek-chat", "Authorization", "Bearer api-key-value", ""},
		{"azure-openai", "api-key", "api-key-value", "Authorization"},
		{"claude-api", "x-api-key", "api-key-value", "Authorization"},
		{"gemini-generate-content", "x-goog-api-key", "api-key-value", "Authorization"},
		{"ollama-chat", "", "", "Authorization"},
		// GET /models 没有模型协议，继续沿用内置 Bearer。
		{"", "Authorization", "Bearer api-key-value", ""},
	}
	for _, test := range tests {
		req, err := http.NewRequest(http.MethodPost, "https://api.example.com/v1/chat/completions", nil)
		if err != nil {
			t.Fatal(err)
		}
		contract, err := s.ResolveSystemProxyContract(test.protocol, "")
		if err != nil {
			t.Fatal(err)
		}
		if err := contract.ApplyAuth(req, channel); err != nil {
			t.Fatalf("ApplySystemProxyAuth(%q) error = %v", test.protocol, err)
		}
		if test.header != "" && req.Header.Get(test.header) != test.value {
			t.Errorf("%q %s = %q, want %q", test.protocol, test.header, req.Header.Get(test.header), test.value)
		}
		if test.absent != "" && req.Header.Get(test.absent) != "" {
			t.Errorf("%q must not send %s, got %q", test.protocol, test.absent, req.Header.Get(test.absent))
		}
	}
	claude, _ := http.NewRequest(http.MethodPost, "https://api.anthropic.com/v1/messages", nil)
	contract, err := s.ResolveSystemProxyContract("claude-api", "")
	if err != nil {
		t.Fatal(err)
	}
	if err := contract.ApplyAuth(claude, channel); err != nil || claude.Header.Get("anthropic-version") == "" {
		t.Fatalf("claude auth must keep anthropic-version, err = %v, headers = %#v", err, claude.Header)
	}
}

func TestSystemProxyChatCompletionPath(t *testing.T) {
	for path, want := range map[string]bool{"/chat/completions": true, "/v1/chat/completions": true, "/responses": false, "/messages": false, "/images/generations": false} {
		if got := SystemProxyChatCompletionPath(path); got != want {
			t.Errorf("SystemProxyChatCompletionPath(%q) = %v, want %v", path, got, want)
		}
	}
}
