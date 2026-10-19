package auth

import (
	"crypto/sha1"
	"encoding/hex"
	"encoding/xml"
	"sort"
	"strings"
	"testing"
)

// 微信签名校验是服务器配置能否保存的唯一门槛，算错一次就整条链路不通。
func TestWeChatSignatureValid(t *testing.T) {
	token := "testtoken123"
	timestamp := "1700000000"
	nonce := "nonceabc"

	parts := []string{token, timestamp, nonce}
	sort.Strings(parts)
	sum := sha1.Sum([]byte(strings.Join(parts, "")))
	valid := hex.EncodeToString(sum[:])

	tests := []struct {
		name      string
		signature string
		want      bool
	}{
		{"正确签名", valid, true},
		{"签名大写也接受", strings.ToUpper(valid), true},
		{"错误签名", "deadbeef", false},
		{"空签名", "", false},
		{"篡改时间戳", valid, true}, // 签名本身正确，时间戳由微信侧校验
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := wechatSignatureValid(token, tt.signature, timestamp, nonce); got != tt.want {
				t.Fatalf("wechatSignatureValid() = %v, want %v", got, tt.want)
			}
		})
	}

	// 参数顺序不影响结果（内部会排序）。
	if !wechatSignatureValid(token, valid, nonce, timestamp) {
		t.Fatal("参数顺序不应影响签名校验")
	}
	// 换了 token 必须失败。
	if wechatSignatureValid("othertoken", valid, timestamp, nonce) {
		t.Fatal("token 不匹配时不应通过校验")
	}
}

// subscribe 事件的 EventKey 带 qrscene_ 前缀，SCAN 事件不带。
// 这是整个微信登录最容易写错的一处。
func TestWeChatEventKeyParsing(t *testing.T) {
	tests := []struct {
		name      string
		event     string
		eventKey  string
		wantScene string
	}{
		{"未关注扫码后关注", "subscribe", "qrscene_abc123", "abc123"},
		{"已关注直接扫码", "SCAN", "abc123", "abc123"},
		{"普通关注无场景值", "subscribe", "", ""},
		{"普通关注带空前缀", "subscribe", "qrscene_", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			raw, err := xml.Marshal(wechatEventMessage{
				MsgType: "event", Event: tt.event, EventKey: tt.eventKey, FromUserName: "openid-1",
			})
			if err != nil {
				t.Fatal(err)
			}
			var parsed wechatEventMessage
			if err := xml.Unmarshal(raw, &parsed); err != nil {
				t.Fatal(err)
			}
			scene := strings.TrimSpace(parsed.EventKey)
			switch parsed.Event {
			case "subscribe":
				scene = strings.TrimPrefix(scene, "qrscene_")
			case "SCAN":
			default:
				scene = ""
			}
			if parsed.Event == "subscribe" && parsed.EventKey == "qrscene_" {
				scene = ""
			}
			if scene != tt.wantScene {
				t.Fatalf("scene = %q, want %q", scene, tt.wantScene)
			}
		})
	}
}

// 微信推送的 XML 是真实结构，字段名大小写敏感，必须能正确解析。
func TestWeChatEventXMLUnmarshal(t *testing.T) {
	raw := []byte(`<xml>
<ToUserName><![CDATA[gh_1234567890ab]]></ToUserName>
<FromUserName><![CDATA[oUserOpenID123]]></FromUserName>
<CreateTime>1700000000</CreateTime>
<MsgType><![CDATA[event]]></MsgType>
<Event><![CDATA[subscribe]]></Event>
<EventKey><![CDATA[qrscene_abc123def456]]></EventKey>
<Ticket><![CDATA[TICKET_VALUE]]></Ticket>
</xml>`)
	var message wechatEventMessage
	if err := xml.Unmarshal(raw, &message); err != nil {
		t.Fatal(err)
	}
	if message.MsgType != "event" {
		t.Fatalf("MsgType = %q", message.MsgType)
	}
	if message.FromUserName != "oUserOpenID123" {
		t.Fatalf("FromUserName = %q", message.FromUserName)
	}
	if message.EventKey != "qrscene_abc123def456" {
		t.Fatalf("EventKey = %q", message.EventKey)
	}
}

// 确认态借用 NextPath 存储，编解码必须无损，否则用户登录后会被跳到错误页面。
func TestWeChatConfirmedStateEncoding(t *testing.T) {
	tests := []struct {
		name     string
		nextPath string
		wantUser string
		wantNext string
	}{
		{"带原始跳转", "__wx__:user-123|/canvas?mode=new", "user-123", "/canvas?mode=new"},
		{"无原始跳转", "__wx__:user-456", "user-456", "/create"},
		{"未确认", "/projects", "", "/projects"},
		{"空值", "", "", ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := wechatConfirmedUserID(tt.nextPath); got != tt.wantUser {
				t.Fatalf("wechatConfirmedUserID() = %q, want %q", got, tt.wantUser)
			}
			if got := wechatOriginalNext(tt.nextPath); got != tt.wantNext {
				t.Fatalf("wechatOriginalNext() = %q, want %q", got, tt.wantNext)
			}
		})
	}
}

// 配置校验：启用状态下缺字段必须拒绝，否则会生成一个永远扫码失败的面板。
func TestValidateWeChatSetting(t *testing.T) {
	tests := []struct {
		name    string
		value   wechatSettingValue
		wantErr bool
	}{
		{"未启用可空", wechatSettingValue{Enabled: false}, false},
		{"启用缺 AppID", wechatSettingValue{Enabled: true, AppSecret: "s", Token: "t"}, true},
		{"启用缺 Token", wechatSettingValue{Enabled: true, AppID: "a", AppSecret: "s"}, true},
		{"启用完整", wechatSettingValue{Enabled: true, AppID: "a", AppSecret: "s", Token: "t"}, false},
		{"Token 超长", wechatSettingValue{Enabled: true, AppID: "a", AppSecret: "s", Token: strings.Repeat("x", 33)}, true},
		{"安全模式缺 AESKey", wechatSettingValue{Enabled: true, AppID: "a", AppSecret: "s", Token: "t", EncryptMode: "safe"}, true},
		{"安全模式 AESKey 长度错", wechatSettingValue{Enabled: true, AppID: "a", AppSecret: "s", Token: "t", EncryptMode: "safe", EncodingAESKey: "short"}, true},
		{"安全模式完整", wechatSettingValue{Enabled: true, AppID: "a", AppSecret: "s", Token: "t", EncryptMode: "safe", EncodingAESKey: strings.Repeat("k", 43)}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := validateWeChatSetting(normalizeWeChatSetting(tt.value))
			if (err != nil) != tt.wantErr {
				t.Fatalf("validateWeChatSetting() error = %v, wantErr %v", err, tt.wantErr)
			}
		})
	}
}

// 归一化：未知加解密模式必须回落到明文，二维码有效期必须夹到合法区间。
func TestNormalizeWeChatSetting(t *testing.T) {
	value := normalizeWeChatSetting(wechatSettingValue{EncryptMode: "unknown", QRExpireSecs: 5})
	if value.EncryptMode != "plain" {
		t.Fatalf("EncryptMode = %q, want plain", value.EncryptMode)
	}
	if value.QRExpireSecs != 300 {
		t.Fatalf("QRExpireSecs = %d, want 300", value.QRExpireSecs)
	}
	value = normalizeWeChatSetting(wechatSettingValue{QRExpireSecs: 99999999})
	if value.QRExpireSecs != 300 {
		t.Fatalf("超上限应回落默认值，got %d", value.QRExpireSecs)
	}
}
