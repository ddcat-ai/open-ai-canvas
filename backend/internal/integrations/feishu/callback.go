// Package feishu contains the server-side boundary for a Feishu/Lark feedback
// connector. It deliberately has no dependency on app or the database so the
// HTTP callback can be tested and composed with the existing feedback service.
package feishuintegration

import (
	"bytes"
	"crypto/hmac"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"unicode/utf8"
)

const (
	maxCallbackBytes = 1 << 20
	maxFeedbackRunes = 10000
)

// Config contains the credentials required by a Feishu app. Secrets should be
// loaded by the app layer from encrypted settings; this package never persists
// or logs them.
type Config struct {
	AppID             string
	AppSecret         string
	VerificationToken string
	EncryptKey        string
	BaseURL           string
}

// IncomingFeedback is the normalized subset of a Feishu message used by the
// feedback domain. EventID is the durable deduplication key.
type IncomingFeedback struct {
	EventID       string
	TenantKey     string
	MessageID     string
	ChatID        string
	SenderOpenID  string
	SenderName    string
	MessageType   string
	Text          string
	FeedbackType  string
	CreatedAtUnix int64
}

type CallbackResult struct {
	Challenge string
	Feedback  *IncomingFeedback
}

// DeduplicationKey is the value the repository should put under a unique
// constraint before creating a feedback row. TenantKey is included because a
// self-hosted deployment may receive callbacks from more than one Feishu app.
func DeduplicationKey(feedback IncomingFeedback) string {
	if tenant := strings.TrimSpace(feedback.TenantKey); tenant != "" {
		return tenant + ":" + strings.TrimSpace(feedback.EventID)
	}
	return strings.TrimSpace(feedback.EventID)
}

type callbackEnvelope struct {
	Challenge string         `json:"challenge"`
	Encrypt   string         `json:"encrypt"`
	Token     string         `json:"token"`
	Type      string         `json:"type"`
	Header    callbackHeader `json:"header"`
	Event     callbackEvent  `json:"event"`
}

type callbackHeader struct {
	EventID   string `json:"event_id"`
	EventType string `json:"event_type"`
	TenantKey string `json:"tenant_key"`
	Token     string `json:"token"`
}

type callbackEvent struct {
	Sender  callbackSender  `json:"sender"`
	Message callbackMessage `json:"message"`
}

type callbackSender struct {
	SenderID callbackSenderID `json:"sender_id"`
}

type callbackSenderID struct {
	OpenID  string `json:"open_id"`
	UserID  string `json:"user_id"`
	UnionID string `json:"union_id"`
}

type callbackMessage struct {
	MessageID   string `json:"message_id"`
	ChatID      string `json:"chat_id"`
	MessageType string `json:"message_type"`
	Content     string `json:"content"`
	CreateTime  string `json:"create_time"`
}

// ParseCallback validates a Feishu callback and extracts text messages. A URL
// verification request returns Challenge and no Feedback. Non-text messages
// are acknowledged by returning an empty result, allowing the webhook to stay
// healthy while the product only promises text feedback in the first version.
func ParseCallback(body []byte, headers http.Header, cfg Config) (CallbackResult, error) {
	if len(body) == 0 || len(body) > maxCallbackBytes {
		return CallbackResult{}, errors.New("飞书回调正文为空或超过大小限制")
	}
	if strings.TrimSpace(cfg.VerificationToken) == "" {
		return CallbackResult{}, errors.New("飞书回调未配置 verification token")
	}
	if cfg.EncryptKey != "" {
		if !verifySignature(body, headers, cfg.EncryptKey) {
			return CallbackResult{}, errors.New("飞书回调签名无效")
		}
	}

	var envelope callbackEnvelope
	if err := json.Unmarshal(body, &envelope); err != nil {
		return CallbackResult{}, fmt.Errorf("飞书回调 JSON 无效：%w", err)
	}
	if strings.TrimSpace(envelope.Encrypt) != "" {
		return CallbackResult{}, errors.New("飞书加密事件暂不支持，请在飞书事件订阅中关闭事件加密")
	}
	token := strings.TrimSpace(envelope.Token)
	if token == "" {
		token = strings.TrimSpace(envelope.Header.Token)
	}
	if token != strings.TrimSpace(cfg.VerificationToken) {
		return CallbackResult{}, errors.New("飞书回调 token 无效")
	}
	if envelope.Type == "url_verification" || envelope.Challenge != "" {
		if strings.TrimSpace(envelope.Challenge) == "" {
			return CallbackResult{}, errors.New("飞书回调 challenge 为空")
		}
		return CallbackResult{Challenge: envelope.Challenge}, nil
	}

	message := envelope.Event.Message
	if message.MessageType != "text" {
		return CallbackResult{}, nil
	}
	text, err := messageText(message.Content)
	if err != nil {
		return CallbackResult{}, err
	}
	if text == "" {
		return CallbackResult{}, nil
	}
	eventID := strings.TrimSpace(envelope.Header.EventID)
	if eventID == "" {
		eventID = strings.TrimSpace(message.MessageID)
	}
	if eventID == "" || strings.TrimSpace(message.MessageID) == "" || strings.TrimSpace(message.ChatID) == "" {
		return CallbackResult{}, errors.New("飞书消息缺少可去重的事件、消息或会话 ID")
	}
	sender := envelope.Event.Sender.SenderID
	return CallbackResult{Feedback: &IncomingFeedback{
		EventID:       eventID,
		TenantKey:     firstNonEmpty(envelope.Header.TenantKey, senderTenantKey(envelope)),
		MessageID:     strings.TrimSpace(message.MessageID),
		ChatID:        strings.TrimSpace(message.ChatID),
		SenderOpenID:  firstNonEmpty(sender.OpenID, sender.UserID, sender.UnionID),
		MessageType:   message.MessageType,
		Text:          text,
		FeedbackType:  classifyFeedback(text),
		CreatedAtUnix: parseUnixSeconds(message.CreateTime),
	}}, nil
}

func verifySignature(body []byte, headers http.Header, encryptKey string) bool {
	timestamp := strings.TrimSpace(headers.Get("X-Lark-Request-Timestamp"))
	nonce := strings.TrimSpace(headers.Get("X-Lark-Request-Nonce"))
	provided := strings.TrimSpace(headers.Get("X-Lark-Signature"))
	if timestamp == "" || nonce == "" || provided == "" {
		return false
	}
	h := sha256.New()
	_, _ = h.Write([]byte(timestamp))
	_, _ = h.Write([]byte(nonce))
	_, _ = h.Write([]byte(encryptKey))
	_, _ = h.Write(body)
	computed := hex.EncodeToString(h.Sum(nil))
	return hmac.Equal([]byte(strings.ToLower(provided)), []byte(computed))
}

func messageText(content string) (string, error) {
	var payload struct {
		Text string `json:"text"`
	}
	if err := json.Unmarshal([]byte(content), &payload); err != nil {
		return "", errors.New("飞书文本消息内容无效")
	}
	text := strings.TrimSpace(payload.Text)
	if utf8.RuneCountInString(text) > maxFeedbackRunes {
		return "", errors.New("飞书反馈内容超过大小限制")
	}
	return text, nil
}

func classifyFeedback(text string) string {
	lower := strings.ToLower(strings.TrimSpace(text))
	for _, prefix := range []string{"bug", "问题", "缺陷", "故障", "报错"} {
		if strings.HasPrefix(lower, prefix) {
			return "bug"
		}
	}
	for _, prefix := range []string{"feature", "需求", "功能", "希望", "建议"} {
		if strings.HasPrefix(lower, prefix) {
			return "feature"
		}
	}
	return "other"
}

func parseUnixSeconds(value string) int64 {
	var unix int64
	if _, err := fmt.Sscan(strings.TrimSpace(value), &unix); err != nil || unix < 0 {
		return 0
	}
	return unix
}

func senderTenantKey(envelope callbackEnvelope) string {
	// Feishu currently puts tenant_key in header. Keeping this helper makes the
	// parser tolerant of future event payloads without exposing raw JSON.
	return ""
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

// ChallengeJSON is the exact response shape expected by Feishu URL
// verification. It is kept here so handlers do not duplicate protocol logic.
func ChallengeJSON(challenge string) []byte {
	encoded, _ := json.Marshal(map[string]string{"challenge": challenge})
	return bytes.Clone(encoded)
}
