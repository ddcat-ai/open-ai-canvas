package feishuintegration

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"
	"unicode/utf8"
)

const (
	defaultBaseURL   = "https://open.feishu.cn"
	maxResponseBytes = 1 << 20
	maxSummaryRunes  = 30000
	accessTokenPath  = "/" + "open-apis" + "/auth/v3/tenant_access_token/internal"
	sendMessagePath  = "/open-apis/im/v1/messages"
)

// HTTPDoer allows deterministic tests without coupling the integration to a
// concrete HTTP client. Production callers should use a client with a timeout.
type HTTPDoer interface {
	Do(*http.Request) (*http.Response, error)
}

type Client struct {
	config Config
	http   HTTPDoer
}

func NewClient(config Config, client HTTPDoer) *Client {
	if client == nil {
		client = &http.Client{Timeout: 20 * time.Second}
	}
	if strings.TrimSpace(config.BaseURL) == "" {
		config.BaseURL = defaultBaseURL
	}
	config.BaseURL = strings.TrimRight(strings.TrimSpace(config.BaseURL), "/")
	return &Client{config: config, http: client}
}

type accessTokenResponse struct {
	Code              int    `json:"code"`
	Msg               string `json:"msg"`
	TenantAccessToken string `json:"tenant_access_token"`
	Expire            int    `json:"expire"`
}

type apiErrorResponse struct {
	Code int    `json:"code"`
	Msg  string `json:"msg"`
}

// SendText obtains a tenant token and sends a text message to a chat. It is the
// common daily-digest path; use SendTextTo when the administrator is addressed
// by open_id, user_id or email instead.
func (c *Client) SendText(ctx context.Context, receiveID, text string) error {
	return c.SendTextTo(ctx, "chat_id", receiveID, text)
}

// SendTextTo obtains a tenant token and sends a text message. It does not
// retry: if the network result is uncertain, the caller must keep an outbox
// receipt and reconcile before issuing a second message.
func (c *Client) SendTextTo(ctx context.Context, receiveIDType, receiveID, text string) error {
	if c == nil {
		return errors.New("飞书客户端未初始化")
	}
	if strings.TrimSpace(c.config.AppID) == "" || strings.TrimSpace(c.config.AppSecret) == "" {
		return errors.New("飞书应用凭证未配置")
	}
	receiveID = strings.TrimSpace(receiveID)
	if receiveID == "" {
		return errors.New("飞书消息接收方不能为空")
	}
	if !validReceiveIDType(receiveIDType) {
		return errors.New("飞书消息接收方类型无效")
	}
	text = strings.TrimSpace(text)
	if text == "" {
		return errors.New("飞书消息正文不能为空")
	}
	if utf8.RuneCountInString(text) > maxSummaryRunes {
		return errors.New("飞书消息正文超过大小限制")
	}
	token, err := c.tenantAccessToken(ctx)
	if err != nil {
		return err
	}
	content, err := json.Marshal(map[string]string{"text": text})
	if err != nil {
		return fmt.Errorf("编码飞书消息失败：%w", err)
	}
	body, err := json.Marshal(map[string]any{
		"receive_id": receiveID,
		"msg_type":   "text",
		"content":    string(content),
	})
	if err != nil {
		return fmt.Errorf("编码飞书消息请求失败：%w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.BaseURL+sendMessagePath+"?receive_id_type="+receiveIDType, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+token)
	request.Header.Set("Content-Type", "application/json")
	return c.doAPI(request, "飞书消息发送")
}

func validReceiveIDType(value string) bool {
	switch strings.TrimSpace(value) {
	case "chat_id", "open_id", "user_id", "union_id", "email":
		return true
	default:
		return false
	}
}

func (c *Client) tenantAccessToken(ctx context.Context) (string, error) {
	body, err := json.Marshal(map[string]string{"app_id": c.config.AppID, "app_secret": c.config.AppSecret})
	if err != nil {
		return "", fmt.Errorf("编码飞书鉴权请求失败：%w", err)
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, c.config.BaseURL+accessTokenPath, bytes.NewReader(body))
	if err != nil {
		return "", err
	}
	request.Header.Set("Content-Type", "application/json")
	response, err := c.http.Do(request)
	if err != nil {
		return "", fmt.Errorf("请求飞书鉴权失败：%w", err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return "", fmt.Errorf("读取飞书鉴权响应失败：%w", err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return "", fmt.Errorf("飞书鉴权返回 HTTP %d", response.StatusCode)
	}
	var result accessTokenResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return "", errors.New("飞书鉴权响应格式无效")
	}
	if result.Code != 0 || strings.TrimSpace(result.TenantAccessToken) == "" {
		return "", fmt.Errorf("飞书鉴权失败：code=%d msg=%s", result.Code, truncateForError(result.Msg))
	}
	return result.TenantAccessToken, nil
}

func (c *Client) doAPI(request *http.Request, action string) error {
	response, err := c.http.Do(request)
	if err != nil {
		return fmt.Errorf("%s请求失败：%w", action, err)
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, maxResponseBytes))
	if err != nil {
		return fmt.Errorf("读取%s响应失败：%w", action, err)
	}
	if response.StatusCode < 200 || response.StatusCode >= 300 {
		return fmt.Errorf("%s返回 HTTP %d", action, response.StatusCode)
	}
	var result apiErrorResponse
	if err := json.Unmarshal(data, &result); err != nil {
		return fmt.Errorf("%s响应格式无效", action)
	}
	if result.Code != 0 {
		return fmt.Errorf("%s失败：code=%d msg=%s", action, result.Code, truncateForError(result.Msg))
	}
	return nil
}

func truncateForError(value string) string {
	value = strings.TrimSpace(value)
	if utf8.RuneCountInString(value) > 200 {
		return string([]rune(value)[:200]) + "…"
	}
	return value
}
