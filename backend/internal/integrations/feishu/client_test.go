package feishuintegration

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

func TestClientSendTextGetsTenantTokenAndSendsMessage(t *testing.T) {
	var calls []string
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		calls = append(calls, request.URL.Path)
		body, _ := io.ReadAll(request.Body)
		if request.URL.Path == accessTokenPath {
			var input map[string]string
			if err := json.Unmarshal(body, &input); err != nil || input["app_id"] != "app" || input["app_secret"] != "secret" {
				t.Fatalf("bad token request: %s", body)
			}
			writer.Header().Set("Content-Type", "application/json")
			_, _ = writer.Write([]byte(`{"code":0,"tenant_access_token":"tenant-token","expire":7200}`))
			return
		}
		if request.URL.Path != "/open-apis/im/v1/messages" || request.Header.Get("Authorization") != "Bearer tenant-token" || request.URL.Query().Get("receive_id_type") != "chat_id" {
			t.Fatalf("bad message request: %s %s auth=%s", request.URL.String(), body, request.Header.Get("Authorization"))
		}
		var input struct {
			ReceiveID string `json:"receive_id"`
			MsgType   string `json:"msg_type"`
			Content   string `json:"content"`
		}
		if err := json.Unmarshal(body, &input); err != nil || input.ReceiveID != "oc-admin" || input.MsgType != "text" || input.Content != `{"text":"日报"}` {
			t.Fatalf("bad message body: %s", body)
		}
		_, _ = writer.Write([]byte(`{"code":0,"msg":"ok"}`))
	}))
	defer server.Close()

	client := NewClient(Config{AppID: "app", AppSecret: "secret", BaseURL: server.URL}, nil)
	if err := client.SendText(context.Background(), "oc-admin", "日报"); err != nil {
		t.Fatal(err)
	}
	if strings.Join(calls, ",") != accessTokenPath+",/open-apis/im/v1/messages" {
		t.Fatalf("unexpected call order: %v", calls)
	}
}

func TestClientDoesNotRetryUncertainSend(t *testing.T) {
	var messageCalls int
	server := httptest.NewServer(http.HandlerFunc(func(writer http.ResponseWriter, request *http.Request) {
		if request.URL.Path == accessTokenPath {
			_, _ = writer.Write([]byte(`{"code":0,"tenant_access_token":"tenant-token"}`))
			return
		}
		messageCalls++
		writer.WriteHeader(http.StatusGatewayTimeout)
	}))
	defer server.Close()
	client := NewClient(Config{AppID: "app", AppSecret: "secret", BaseURL: server.URL}, nil)
	if err := client.SendText(context.Background(), "oc-admin", "日报"); err == nil {
		t.Fatal("expected send failure")
	}
	if messageCalls != 1 {
		t.Fatalf("message was retried: %d", messageCalls)
	}
}

func TestClientRejectsInvalidInputBeforeNetwork(t *testing.T) {
	client := NewClient(Config{}, nil)
	for _, test := range []struct {
		name      string
		receiveID string
		text      string
	}{
		{name: "missing recipient", text: "日报"},
		{name: "missing text", receiveID: "oc-admin"},
	} {
		t.Run(test.name, func(t *testing.T) {
			if err := client.SendText(context.Background(), test.receiveID, test.text); err == nil {
				t.Fatal("expected validation error")
			}
		})
	}
	client = NewClient(Config{AppID: "app", AppSecret: "secret"}, nil)
	if err := client.SendTextTo(context.Background(), "unknown", "receiver", "日报"); err == nil {
		t.Fatal("expected invalid receiver type")
	}
}
