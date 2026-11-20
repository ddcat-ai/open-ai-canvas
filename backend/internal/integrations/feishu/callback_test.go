package feishuintegration

import (
	"crypto/sha256"
	"encoding/hex"
	"net/http"
	"strconv"
	"strings"
	"testing"
)

func TestParseCallbackURLVerification(t *testing.T) {
	result, err := ParseCallback([]byte(`{"type":"url_verification","token":"verify","challenge":"challenge-value"}`), http.Header{}, Config{VerificationToken: "verify"})
	if err != nil || result.Challenge != "challenge-value" || result.Feedback != nil {
		t.Fatalf("unexpected challenge result: %+v err=%v", result, err)
	}
	if string(ChallengeJSON(result.Challenge)) != `{"challenge":"challenge-value"}` {
		t.Fatalf("unexpected challenge response: %s", ChallengeJSON(result.Challenge))
	}
}

func TestParseCallbackTextMessageAndSignature(t *testing.T) {
	body := []byte(`{"schema":"2.0","header":{"event_id":"evt-1","event_type":"im.message.receive_v1","tenant_key":"tenant-1","token":"verify"},"event":{"sender":{"sender_id":{"open_id":"ou-1"}},"message":{"message_id":"om-1","chat_id":"oc-1","message_type":"text","content":"{\"text\":\"Bug: 页面打不开\"}","create_time":"1700000000"}}}`)
	stamp, nonce, key := "1700000000", "nonce", "encrypt-key"
	h := sha256.Sum256([]byte(stamp + nonce + key + string(body)))
	headers := http.Header{}
	headers.Set("X-Lark-Request-Timestamp", stamp)
	headers.Set("X-Lark-Request-Nonce", nonce)
	headers.Set("X-Lark-Signature", hex.EncodeToString(h[:]))
	result, err := ParseCallback(body, headers, Config{VerificationToken: "verify", EncryptKey: key})
	if err != nil {
		t.Fatal(err)
	}
	if result.Feedback == nil || result.Feedback.EventID != "evt-1" || result.Feedback.Text != "Bug: 页面打不开" || result.Feedback.FeedbackType != "bug" || result.Feedback.SenderOpenID != "ou-1" {
		t.Fatalf("unexpected feedback: %+v", result.Feedback)
	}
	if result.Feedback.CreatedAtUnix != 1700000000 {
		t.Fatalf("unexpected timestamp: %d", result.Feedback.CreatedAtUnix)
	}
}

func TestParseCallbackRejectsBadSignatureAndOversizedText(t *testing.T) {
	body := []byte(`{"header":{"event_id":"evt-1","token":"verify"},"event":{"message":{"message_id":"om-1","chat_id":"oc-1","message_type":"text","content":"{\"text\":\"bug\"}"}}}`)
	headers := http.Header{}
	headers.Set("X-Lark-Request-Timestamp", "1")
	headers.Set("X-Lark-Request-Nonce", "n")
	headers.Set("X-Lark-Signature", "bad")
	if _, err := ParseCallback(body, headers, Config{VerificationToken: "verify", EncryptKey: "key"}); err == nil || !strings.Contains(err.Error(), "签名") {
		t.Fatalf("expected signature error, got %v", err)
	}
	longText := strings.Repeat("a", maxFeedbackRunes+1)
	longBody := []byte(`{"header":{"event_id":"evt-1","token":"verify"},"event":{"message":{"message_id":"om-1","chat_id":"oc-1","message_type":"text","content":"{\"text\":\"` + longText + `\"}"}}}`)
	if _, err := ParseCallback(longBody, http.Header{}, Config{VerificationToken: "verify"}); err == nil || !strings.Contains(err.Error(), "超过") {
		t.Fatalf("expected size error, got %v", err)
	}
}

func TestParseUnixSecondsInvalidValue(t *testing.T) {
	if got := parseUnixSeconds("bad"); got != 0 {
		t.Fatalf("invalid timestamp = %d", got)
	}
	if got := parseUnixSeconds(strconv.FormatInt(-1, 10)); got != 0 {
		t.Fatalf("negative timestamp = %d", got)
	}
}

func TestDeduplicationKeyIncludesTenant(t *testing.T) {
	if got := DeduplicationKey(IncomingFeedback{TenantKey: "tenant", EventID: "event"}); got != "tenant:event" {
		t.Fatalf("deduplication key = %q", got)
	}
	if got := DeduplicationKey(IncomingFeedback{EventID: "event"}); got != "event" {
		t.Fatalf("fallback deduplication key = %q", got)
	}
}
