package platform

import (
	"context"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// goldenAliyunParams 是签名测试向量用的固定参数 —— 特意覆盖三类"最容易编错"的字符：
//   - 中文（签名名）
//   - `+`（E.164 手机号）
//   - `{` `"` `:`（模板参数是 JSON 串）
var goldenAliyunParams = map[string]string{
	"AccessKeyId":      "testid",
	"Action":           "SendSms",
	"Format":           "JSON",
	"RegionId":         "cn-hangzhou",
	"SignatureMethod":  "HMAC-SHA1",
	"SignatureNonce":   "3ee8c1b8-83d3-44af-a94f-4e0ad82fd6cf",
	"SignatureVersion": "1.0",
	"Timestamp":        "2026-09-20T06:00:00Z",
	"Version":          "2017-05-25",
	"PhoneNumbers":     "+8613800138000",
	"SignName":         "测试签名",
	"TemplateCode":     "SMS_153055065",
	"TemplateParam":    `{"code":"123456"}`,
}

// ⚠️ **这条是本次最值钱的测试**：期望值由**另一份独立实现**（Python，按同一份阿里云官方规范）
// 算出，不是拿 Go 这边跑出来的结果反向填的 —— 只有两个独立实现算出同一个串，
// 才能证明签名规范真的被正确实现了（签名错了阿里云只回一句 `SignatureDoesNotMatch`，极难查）。
const goldenAliyunSignature = "UySohUuHPvNRZjx9WkFkbMrYjQ4="

func TestAliyunSmsSignatureMatchesIndependentImplementation(t *testing.T) {
	if got := aliyunSmsSignature(http.MethodGet, goldenAliyunParams, "testsecret"); got != goldenAliyunSignature {
		t.Fatalf("签名与独立实现不一致：\n得到 %s\n期望 %s", got, goldenAliyunSignature)
	}
}

func TestAliyunSmsSignatureIgnoresExistingSignatureParam(t *testing.T) {
	// 签名参数本身不参与计算（规范明文）—— 否则二次签名会算出不同的值。
	withSignature := map[string]string{}
	for key, value := range goldenAliyunParams {
		withSignature[key] = value
	}
	withSignature["Signature"] = "should-be-ignored"
	if got := aliyunSmsSignature(http.MethodGet, withSignature, "testsecret"); got != goldenAliyunSignature {
		t.Fatalf("Signature 参数不该参与签名计算，得到 %s", got)
	}
}

func TestAliyunPercentEncodeFollowsSpec(t *testing.T) {
	cases := map[string]string{
		"abcXYZ0189-_.~": "abcXYZ0189-_.~", // 未保留字符不编码
		"a b":            "a%20b",          // 空格 → %20（不是 +）
		"*":              "%2A",            // 星号必须编码
		"~":              "~",              // 波浪号必须还原
		"+8613800138000": "%2B8613800138000",
		`{"code":"1"}`:   "%7B%22code%22%3A%221%22%7D",
		"测试签名":           "%E6%B5%8B%E8%AF%95%E7%AD%BE%E5%90%8D",
		"/":              "%2F",
	}
	for input, want := range cases {
		if got := percentEncode(input); got != want {
			t.Fatalf("percentEncode(%q) = %q，期望 %q", input, got, want)
		}
	}
}

func TestSendAliyunSmsCodeSendsExpectedShape(t *testing.T) {
	var captured map[string]string
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		captured = map[string]string{}
		for key := range r.URL.Query() {
			captured[key] = r.URL.Query().Get(key)
		}
		_, _ = w.Write([]byte(`{"Code":"OK","Message":"OK","BizId":"123456^0","RequestId":"req-1"}`))
	}))
	defer server.Close()

	cfg := AliyunSmsConfig{AccessKeyId: "testid", AccessKeySecret: "testsecret", SignName: "测试签名", TemplateCode: "SMS_153055065", Endpoint: server.URL}
	bizId, err := SendAliyunSmsCode(context.Background(), cfg, "+8613800138000", "654321")
	if err != nil {
		t.Fatal(err)
	}
	if bizId != "123456^0" {
		t.Fatalf("BizId 没透传：%q", bizId)
	}

	want := map[string]string{
		"AccessKeyId": "testid", "Action": "SendSms", "Version": "2017-05-25",
		"SignatureMethod": "HMAC-SHA1", "SignatureVersion": "1.0", "RegionId": "cn-hangzhou",
		"PhoneNumbers": "+8613800138000", "SignName": "测试签名", "TemplateCode": "SMS_153055065",
		"TemplateParam": `{"code":"654321"}`,
	}
	for key, value := range want {
		if captured[key] != value {
			t.Fatalf("请求参数 %s = %q，期望 %q", key, captured[key], value)
		}
	}
	for _, key := range []string{"Signature", "SignatureNonce", "Timestamp"} {
		if strings.TrimSpace(captured[key]) == "" {
			t.Fatalf("请求缺少 %s", key)
		}
	}
}

func TestSendAliyunSmsCodeNonceChangesPerRequest(t *testing.T) {
	nonces := make([]string, 0, 2)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		nonces = append(nonces, r.URL.Query().Get("SignatureNonce"))
		_, _ = w.Write([]byte(`{"Code":"OK","BizId":"1"}`))
	}))
	defer server.Close()

	cfg := AliyunSmsConfig{AccessKeyId: "testid", AccessKeySecret: "testsecret", SignName: "签名", TemplateCode: "SMS_1", Endpoint: server.URL}
	for i := 0; i < 2; i++ {
		if _, err := SendAliyunSmsCode(context.Background(), cfg, "+8613800138000", "123456"); err != nil {
			t.Fatal(err)
		}
	}
	if len(nonces) != 2 || nonces[0] == nonces[1] {
		t.Fatalf("SignatureNonce 必须每次不同（防重放），实得 %v", nonces)
	}
}

func TestSendAliyunSmsCodeSurfacesUpstreamErrorInChinese(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.WriteHeader(http.StatusBadRequest)
		_, _ = w.Write([]byte(`{"Code":"isv.SMS_SIGNATURE_ILLEGAL","Message":"signature is illegal","RequestId":"req-2"}`))
	}))
	defer server.Close()

	cfg := AliyunSmsConfig{AccessKeyId: "testid", AccessKeySecret: "testsecret", SignName: "签名", TemplateCode: "SMS_1", Endpoint: server.URL}
	_, err := SendAliyunSmsCode(context.Background(), cfg, "+8613800138000", "123456")
	if err == nil {
		t.Fatal("上游返回错误码时应当报错")
	}
	// 文案要能直接给管理员看：中文解释 + 机器码 + 请求号（排查就靠这三样）
	for _, fragment := range []string{"短信签名不合法", "isv.SMS_SIGNATURE_ILLEGAL", "req-2"} {
		if !strings.Contains(err.Error(), fragment) {
			t.Fatalf("错误文案缺少 %q：%s", fragment, err.Error())
		}
	}
}

func TestSendAliyunSmsCodeRejectsIncompleteConfig(t *testing.T) {
	cases := map[string]AliyunSmsConfig{
		"缺 AccessKey": {SignName: "签名", TemplateCode: "SMS_1"},
		"缺签名":         {AccessKeyId: "id", AccessKeySecret: "secret", TemplateCode: "SMS_1"},
		"缺模板":         {AccessKeyId: "id", AccessKeySecret: "secret", SignName: "签名"},
	}
	for name, cfg := range cases {
		if _, err := SendAliyunSmsCode(context.Background(), cfg, "+8613800138000", "123456"); err == nil {
			t.Fatalf("%s 应当报错", name)
		}
	}
}

func TestSendAliyunSmsCodeHandlesUnparsableBody(t *testing.T) {
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		_, _ = w.Write([]byte("<html>502 Bad Gateway</html>"))
	}))
	defer server.Close()

	cfg := AliyunSmsConfig{AccessKeyId: "id", AccessKeySecret: "secret", SignName: "签名", TemplateCode: "SMS_1", Endpoint: server.URL}
	_, err := SendAliyunSmsCode(context.Background(), cfg, "+8613800138000", "123456")
	if err == nil || !strings.Contains(err.Error(), "无法解析") {
		t.Fatalf("非 JSON 响应要给出可读错误，实得 %v", err)
	}
}
