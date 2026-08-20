package service

import (
	"strings"
	"testing"
)

func TestInterceptResponseMessageMatchesCaseInsensitivelyAndStopsAtFirstRule(t *testing.T) {
	setting := ResponseInterceptionSetting{
		Enabled: true,
		Rules: []ResponseInterceptionRule{
			{Contains: "余额不足", Replace: "网络异常，请重试"},
			{Contains: "异常", Replace: "第二条"},
		},
	}
	if got := interceptResponseMessage(setting, "上游返回：余额不足"); got != "网络异常，请重试" {
		t.Fatalf("interceptResponseMessage() = %q", got)
	}
	if got := interceptResponseMessage(setting, "request failed: 429"); got != "request failed: 429" {
		t.Fatalf("unmatched message = %q", got)
	}
	if got := interceptResponseMessage(ResponseInterceptionSetting{Enabled: true, Rules: []ResponseInterceptionRule{{Contains: "429", Replace: "网络异常，请重试"}}}, "HTTP 429 Too Many Requests"); got != "网络异常，请重试" {
		t.Fatalf("case-insensitive match = %q", got)
	}
}

func TestValidateResponseInterceptionSettingRejectsEmptyRuleText(t *testing.T) {
	for name, value := range map[string]ResponseInterceptionSetting{
		"contains": {Rules: []ResponseInterceptionRule{{Contains: " ", Replace: "替换"}}},
		"replace":  {Rules: []ResponseInterceptionRule{{Contains: "429", Replace: " "}}},
	} {
		t.Run(name, func(t *testing.T) {
			if err := validateResponseInterceptionSetting(normalizeResponseInterceptionSetting(value)); err == nil {
				t.Fatal("validateResponseInterceptionSetting() error = nil")
			}
		})
	}
}

func TestNormalizeResponseInterceptionSettingTrimsRules(t *testing.T) {
	value := normalizeResponseInterceptionSetting(ResponseInterceptionSetting{Rules: []ResponseInterceptionRule{{Contains: " 429 ", Replace: " 网络异常，请重试 "}}})
	if value.Rules[0].Contains != "429" || value.Rules[0].Replace != "网络异常，请重试" {
		t.Fatalf("normalized rules = %#v", value.Rules)
	}
	if strings.TrimSpace(value.Rules[0].Contains) != value.Rules[0].Contains {
		t.Fatal("contains was not trimmed")
	}
}
