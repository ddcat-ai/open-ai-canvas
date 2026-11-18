package app

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"html"
	"io"
	"net"
	"net/http"
	"net/url"
	"strings"
	"time"

	"github.com/coreos/go-oidc/v3/oidc"
	"github.com/google/uuid"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
)

const (
	chatGPTPlanFormat  = "chatgpt-plan"
	chatGPTPlanSetting = "chatgpt_plan_connection"
	chatGPTPlanAPI     = "https://api.openai.com/v1"
	chatGPTPlanIssuer  = "https://auth.openai.com"
	chatGPTPlanToken   = "https://auth.openai.com/api/accounts/oauth/token"
	chatGPTPlanAuth    = "https://auth.openai.com/api/accounts/authorize"
)

type chatGPTPlanCredentials struct {
	OwnerID      string    `json:"ownerId"`
	ChannelID    string    `json:"channelId"`
	HostID       string    `json:"hostId"`
	ClientID     string    `json:"clientId"`
	Subject      string    `json:"subject"`
	Email        string    `json:"email"`
	AccessToken  string    `json:"accessToken"`
	RefreshToken string    `json:"refreshToken"`
	IDToken      string    `json:"idToken"`
	ExpiresAt    time.Time `json:"expiresAt"`
}

type ChatGPTPlanStatus struct {
	Connected bool   `json:"connected"`
	Email     string `json:"email,omitempty"`
	ChannelID string `json:"channelId,omitempty"`
}

type ChatGPTPlanModel struct {
	Slug        string `json:"slug"`
	DisplayName string `json:"displayName"`
}

func (s *Service) readChatGPTPlanCredentials() (*chatGPTPlanCredentials, error) {
	setting, err := s.repo.SystemSettingOptional(chatGPTPlanSetting)
	if err != nil || setting == nil {
		return nil, err
	}
	var record struct {
		Ciphertext string `json:"ciphertext"`
	}
	if err := json.Unmarshal([]byte(setting.ValueJSON), &record); err != nil || record.Ciphertext == "" {
		return nil, errors.New("ChatGPT 授权记录格式无效")
	}
	plain, err := s.decryptSettingSecret(record.Ciphertext)
	if err != nil {
		return nil, err
	}
	var credentials chatGPTPlanCredentials
	if err := json.Unmarshal([]byte(plain), &credentials); err != nil {
		return nil, errors.New("ChatGPT 授权记录无法读取")
	}
	return &credentials, nil
}

func (s *Service) saveChatGPTPlanCredentials(value *chatGPTPlanCredentials) error {
	plain, err := json.Marshal(value)
	if err != nil {
		return err
	}
	ciphertext, err := s.encryptSettingSecret(string(plain))
	if err != nil {
		return err
	}
	encoded, err := json.Marshal(struct {
		Ciphertext string `json:"ciphertext"`
	}{ciphertext})
	if err != nil {
		return err
	}
	return s.repo.SaveSystemSetting(&model.SystemSetting{Key: chatGPTPlanSetting, ValueJSON: string(encoded), UpdatedBy: value.OwnerID})
}

func (s *Service) ChatGPTPlanConnectionStatus(actor *model.User) (*ChatGPTPlanStatus, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	credentials, err := s.readChatGPTPlanCredentials()
	if err != nil || credentials == nil {
		return &ChatGPTPlanStatus{}, err
	}
	if credentials.OwnerID != actor.ID {
		return &ChatGPTPlanStatus{}, nil
	}
	return &ChatGPTPlanStatus{Connected: credentials.AccessToken != "" && credentials.RefreshToken != "", Email: credentials.Email, ChannelID: credentials.ChannelID}, nil
}

func randomChatGPTPlanValue() (string, error) {
	value := make([]byte, 32)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func (s *Service) StartChatGPTPlanConnection(actor *model.User) (string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return "", err
	}
	if actor == nil || actor.ID == "" {
		return "", Unauthorized("请先登录")
	}
	previous, err := s.readChatGPTPlanCredentials()
	if err != nil {
		return "", err
	}
	if previous != nil && previous.OwnerID != actor.ID {
		return "", Forbidden("ChatGPT 方案已由另一个管理员连接")
	}
	hostID := ""
	clientID := "dynamic_agent_client"
	if previous != nil {
		hostID = previous.HostID
		if previous.ClientID != "" {
			clientID = previous.ClientID
		}
	}
	if hostID == "" {
		hostID = "urn:uuid:" + uuid.NewString()
		pending := &chatGPTPlanCredentials{OwnerID: actor.ID, HostID: hostID}
		if err := s.saveChatGPTPlanCredentials(pending); err != nil {
			return "", err
		}
	}
	state, err := randomChatGPTPlanValue()
	if err != nil {
		return "", err
	}
	nonce, err := randomChatGPTPlanValue()
	if err != nil {
		return "", err
	}
	verifier, err := randomChatGPTPlanValue()
	if err != nil {
		return "", err
	}
	listener, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		return "", fmt.Errorf("无法在本机打开 ChatGPT 授权回调：%w", err)
	}
	redirectURI := "http://" + listener.Addr().String() + "/auth/callback"
	challenge := sha256.Sum256([]byte(verifier))
	params := url.Values{
		"client_id": {clientID}, "ext_agent_host_id": {hostID}, "response_type": {"code"},
		"redirect_uri": {redirectURI}, "scope": {"openid profile email offline_access resource.invoke chatgpt.tokens.use.direct"},
		"resource": {chatGPTPlanAPI}, "state": {state}, "nonce": {nonce},
		"code_challenge_method": {"S256"}, "code_challenge": {base64.RawURLEncoding.EncodeToString(challenge[:])},
	}
	if clientID == "dynamic_agent_client" {
		params.Set("agent_name_hint", "Yingce")
	}
	server := &http.Server{ReadHeaderTimeout: 10 * time.Second, MaxHeaderBytes: 8 << 10}
	mux := http.NewServeMux()
	mux.HandleFunc("/auth/callback", func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.Header().Set("Cache-Control", "no-store")
		w.Header().Set("Referrer-Policy", "no-referrer")
		message := "授权失败，请返回影策重试。"
		if r.URL.Query().Get("state") != state {
			http.Error(w, "invalid state", http.StatusBadRequest)
			return
		}
		defer func() { go server.Close() }()
		if r.URL.Query().Get("error") == "" && r.URL.Query().Get("code") != "" {
			ctx, cancel := context.WithTimeout(r.Context(), 30*time.Second)
			defer cancel()
			if completeErr := s.completeChatGPTPlanConnection(ctx, actor, previous, clientID, hostID, nonce, verifier, redirectURI, r.URL.Query()); completeErr == nil {
				message = "ChatGPT 授权成功，请返回影策选择模型。"
			}
		}
		_, _ = io.WriteString(w, "<!doctype html><html lang=\"zh-CN\"><meta charset=\"utf-8\"><title>影策 ChatGPT 授权</title><body><p>"+html.EscapeString(message)+"</p></body></html>")
	})
	server.Handler = mux
	go func() {
		_ = server.Serve(listener)
	}()
	time.AfterFunc(10*time.Minute, func() { _ = server.Close() })
	return chatGPTPlanAuth + "?" + params.Encode(), nil
}

type chatGPTPlanTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	IDToken      string `json:"id_token"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
}

func chatGPTPlanTokenRequest(ctx context.Context, form url.Values) (*chatGPTPlanTokenResponse, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, chatGPTPlanToken, strings.NewReader(form.Encode()))
	if err != nil {
		return nil, err
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	client := outbound.OutboundHTTPClient(30 * time.Second)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("授权接口不允许重定向") }
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("ChatGPT 授权请求失败（HTTP %d）", response.StatusCode)
	}
	var result chatGPTPlanTokenResponse
	if err := json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&result); err != nil {
		return nil, err
	}
	if result.AccessToken == "" || result.RefreshToken == "" || result.ExpiresIn <= 0 {
		return nil, errors.New("ChatGPT 授权结果缺少令牌或有效期")
	}
	return &result, nil
}

func verifyChatGPTPlanIDToken(ctx context.Context, raw, clientID, nonce string) (string, string, error) {
	provider, err := oidc.NewProvider(ctx, chatGPTPlanIssuer)
	if err != nil {
		return "", "", err
	}
	verified, err := provider.Verifier(&oidc.Config{ClientID: clientID}).Verify(ctx, raw)
	if err != nil {
		return "", "", err
	}
	var claims struct {
		Nonce string `json:"nonce"`
		Email string `json:"email"`
	}
	if err := verified.Claims(&claims); err != nil || (nonce != "" && claims.Nonce != nonce) {
		return "", "", errors.New("ChatGPT 身份令牌校验失败")
	}
	return verified.Subject, claims.Email, nil
}

func (s *Service) completeChatGPTPlanConnection(ctx context.Context, actor *model.User, previous *chatGPTPlanCredentials, clientID, hostID, nonce, verifier, redirectURI string, query url.Values) error {
	issued := query.Get("client_id")
	if clientID == "dynamic_agent_client" {
		if issued == "" || issued == clientID {
			return errors.New("ChatGPT 未返回已注册客户端")
		}
		clientID = issued
	} else if issued != "" && issued != clientID {
		return errors.New("ChatGPT 客户端不匹配")
	}
	token, err := chatGPTPlanTokenRequest(ctx, url.Values{
		"grant_type": {"authorization_code"}, "client_id": {clientID}, "code": {query.Get("code")},
		"code_verifier": {verifier}, "redirect_uri": {redirectURI}, "resource": {chatGPTPlanAPI},
	})
	if err != nil {
		return err
	}
	if token.IDToken == "" || !strings.Contains(" "+token.Scope+" ", " chatgpt.tokens.use.direct ") {
		return errors.New("ChatGPT 未授予方案额度使用权限")
	}
	subject, email, err := verifyChatGPTPlanIDToken(ctx, token.IDToken, clientID, nonce)
	if err != nil {
		return err
	}
	if previous != nil && previous.Subject != "" && previous.Subject != subject {
		return errors.New("ChatGPT 授权账号与原账号不一致")
	}
	channelID := ""
	if previous != nil {
		channelID = previous.ChannelID
	}
	if channelID == "" {
		channelID, err = s.createChatGPTPlanChannel(actor)
		if err != nil {
			return err
		}
	}
	credentials := &chatGPTPlanCredentials{OwnerID: actor.ID, ChannelID: channelID, HostID: hostID, ClientID: clientID, Subject: subject, Email: email, AccessToken: token.AccessToken, RefreshToken: token.RefreshToken, IDToken: token.IDToken, ExpiresAt: time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)}
	return s.saveChatGPTPlanCredentials(credentials)
}

func (s *Service) createChatGPTPlanChannel(actor *model.User) (string, error) {
	id, err := s.repo.NextPrefixedID("CHANNEL")
	if err != nil {
		return "", err
	}
	channel, err := s.channelFromRequest(ChannelRequest{Name: "ChatGPT 方案", BaseURL: chatGPTPlanAPI, Models: []string{}}, model.ModelChannel{ID: id, UserID: actor.ID, Scope: model.ChannelScopeSystem, Enabled: true})
	if err != nil {
		return "", err
	}
	channel.APIFormat = chatGPTPlanFormat
	if err := s.saveChannelWithMediaTransport(&channel, actor.ID, nil, true); err != nil {
		return "", err
	}
	s.invalidateUserGroups()
	return id, nil
}

func (s *Service) chatGPTPlanAccessToken(ownerID string) (string, error) {
	s.chatGPTPlanMu.Lock()
	defer s.chatGPTPlanMu.Unlock()
	credentials, err := s.readChatGPTPlanCredentials()
	if err != nil || credentials == nil {
		return "", errors.New("ChatGPT 方案尚未连接")
	}
	if credentials.OwnerID != ownerID {
		return "", Forbidden("只有授权者本人可以使用 ChatGPT 方案")
	}
	if time.Until(credentials.ExpiresAt) > 2*time.Minute {
		return credentials.AccessToken, nil
	}
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	token, err := chatGPTPlanTokenRequest(ctx, url.Values{
		"grant_type": {"refresh_token"}, "client_id": {credentials.ClientID},
		"refresh_token": {credentials.RefreshToken}, "resource": {chatGPTPlanAPI},
	})
	if err != nil {
		return "", err
	}
	credentials.AccessToken = token.AccessToken
	credentials.RefreshToken = token.RefreshToken
	credentials.ExpiresAt = time.Now().Add(time.Duration(token.ExpiresIn) * time.Second)
	if token.IDToken != "" {
		subject, _, verifyErr := verifyChatGPTPlanIDToken(ctx, token.IDToken, credentials.ClientID, "")
		if verifyErr != nil || subject != credentials.Subject {
			return "", errors.New("ChatGPT 刷新令牌账号不匹配")
		}
		credentials.IDToken = token.IDToken
	}
	if err := s.saveChatGPTPlanCredentials(credentials); err != nil {
		return "", err
	}
	return credentials.AccessToken, nil
}

func prepareChatGPTPlanRequest(body map[string]interface{}) error {
	if body == nil {
		return errors.New("ChatGPT 方案请求内容为空")
	}
	for _, field := range []string{"background", "conversation", "max_output_tokens", "max_tool_calls", "metadata", "moderation", "multi_agent", "prompt", "prompt_cache_retention", "safety_identifier", "temperature", "top_logprobs", "top_p", "truncation", "user", "previous_response_id", "prompt_cache_key"} {
		delete(body, field)
	}
	input, exists := body["input"]
	if !exists {
		return errors.New("ChatGPT 方案请求缺少 input")
	}
	if text, ok := input.(string); ok {
		body["input"] = []map[string]interface{}{{"role": "user", "content": text}}
	}
	var items []interface{}
	switch typed := body["input"].(type) {
	case []map[string]interface{}:
		for _, item := range typed {
			items = append(items, item)
		}
	case []interface{}:
		items = typed
	default:
		return errors.New("ChatGPT 方案 input 必须是消息数组")
	}
	if len(items) > 0 {
		cleaned := make([]interface{}, 0, len(items))
		for _, value := range items {
			item, ok := value.(map[string]interface{})
			if !ok {
				return errors.New("ChatGPT 方案 input 项格式无效")
			}
			if stringField(item, "role") == "system" {
				if prompt := strings.TrimSpace(stringField(item, "content")); prompt != "" {
					body["instructions"] = prompt
				}
				continue
			}
			if stringField(item, "type") == "function_call" {
				item["namespace"] = "yingce"
			}
			cleaned = append(cleaned, item)
		}
		body["input"] = cleaned
	}
	if tools, ok := body["tools"].([]interface{}); ok && len(tools) > 0 {
		for _, tool := range tools {
			definition, ok := tool.(map[string]interface{})
			if !ok || stringField(definition, "type") != "function" {
				return errors.New("ChatGPT 方案仅支持函数工具")
			}
		}
		body["tools"] = []interface{}{map[string]interface{}{
			"type": "namespace", "name": "yingce", "description": "Yingce canvas tools", "tools": tools,
		}}
		if choice, ok := body["tool_choice"].(map[string]interface{}); ok && stringField(choice, "type") == "function" {
			choice["namespace"] = "yingce"
		}
	}
	body["store"] = false
	body["stream"] = true
	return nil
}

func (s *Service) ListChatGPTPlanModels(ctx context.Context, actor *model.User) ([]ChatGPTPlanModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	token, err := s.chatGPTPlanAccessToken(actor.ID)
	if err != nil {
		return nil, err
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, chatGPTPlanAPI+"/models", nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("Authorization", "Bearer "+token)
	client := outbound.OutboundHTTPClient(30 * time.Second)
	client.CheckRedirect = func(*http.Request, []*http.Request) error { return errors.New("模型目录不允许重定向") }
	response, err := client.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("读取 ChatGPT 模型目录失败（HTTP %d）", response.StatusCode)
	}
	var payload struct {
		Models []struct {
			Slug        string `json:"slug"`
			DisplayName string `json:"display_name"`
			Visibility  string `json:"visibility"`
		} `json:"models"`
	}
	if err := json.NewDecoder(io.LimitReader(response.Body, 2<<20)).Decode(&payload); err != nil {
		return nil, err
	}
	result := make([]ChatGPTPlanModel, 0, len(payload.Models))
	for _, item := range payload.Models {
		if item.Visibility == "list" && item.Slug != "" {
			result = append(result, ChatGPTPlanModel{Slug: item.Slug, DisplayName: item.DisplayName})
		}
	}
	return result, nil
}

func (s *Service) AddChatGPTPlanModel(ctx context.Context, actor *model.User, slug string) (*model.ChannelModel, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	credentials, err := s.readChatGPTPlanCredentials()
	if err != nil || credentials == nil || credentials.OwnerID != actor.ID || credentials.ChannelID == "" {
		return nil, Forbidden("请先连接自己的 ChatGPT 账号")
	}
	models, err := s.ListChatGPTPlanModels(ctx, actor)
	if err != nil {
		return nil, err
	}
	var selected *ChatGPTPlanModel
	for index := range models {
		if models[index].Slug == slug {
			selected = &models[index]
			break
		}
	}
	if selected == nil {
		return nil, BadAuthRequest("该模型不在当前 ChatGPT 账号可用目录中")
	}
	enabled := true
	return s.SaveAdminChannelModel(actor, credentials.ChannelID, "", ChannelModelRequest{
		ModelKey: slug, ProviderModelKey: slug, DisplayName: firstNonEmpty(selected.DisplayName, slug),
		Capability: "text", Protocol: string(model.ChannelInterfaceOpenAIResponse),
		CapabilityConfig: DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceOpenAIResponse), slug),
		BillingMode:      "fixed_request", PriceConfigured: true, Enabled: &enabled,
	})
}

func (s *Service) DisconnectChatGPTPlan(actor *model.User) (bool, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return false, err
	}
	s.chatGPTPlanMu.Lock()
	defer s.chatGPTPlanMu.Unlock()
	credentials, err := s.readChatGPTPlanCredentials()
	if err != nil || credentials == nil {
		return false, err
	}
	if credentials.OwnerID != actor.ID {
		return false, Forbidden("只有授权者本人可以断开 ChatGPT 方案")
	}
	confirmed := false
	if credentials.RefreshToken != "" {
		ctx, cancel := context.WithTimeout(context.Background(), 15*time.Second)
		defer cancel()
		confirmed = revokeChatGPTPlanSession(ctx, credentials.ClientID, credentials.RefreshToken)
	}
	credentials.AccessToken = ""
	credentials.RefreshToken = ""
	credentials.IDToken = ""
	credentials.ExpiresAt = time.Time{}
	if err := s.saveChatGPTPlanCredentials(credentials); err != nil {
		return confirmed, err
	}
	if credentials.ChannelID != "" {
		if err := s.repo.DeleteSystemChannel(credentials.ChannelID); err != nil {
			return confirmed, err
		}
		s.invalidateUserGroups()
		s.invalidateRouteCatalog()
	}
	credentials.ChannelID = ""
	if err := s.saveChatGPTPlanCredentials(credentials); err != nil {
		return confirmed, err
	}
	return confirmed, nil
}

func revokeChatGPTPlanSession(ctx context.Context, clientID, refreshToken string) bool {
	client := outbound.OutboundHTTPClient(15 * time.Second)
	discovery, err := http.NewRequestWithContext(ctx, http.MethodGet, chatGPTPlanIssuer+"/.well-known/openid-configuration", nil)
	if err != nil {
		return false
	}
	response, err := client.Do(discovery)
	if err != nil {
		return false
	}
	var metadata struct {
		RevocationEndpoint string `json:"revocation_endpoint"`
	}
	if response.StatusCode == http.StatusOK {
		err = json.NewDecoder(io.LimitReader(response.Body, 1<<20)).Decode(&metadata)
	}
	_ = response.Body.Close()
	if err != nil || !strings.HasPrefix(metadata.RevocationEndpoint, chatGPTPlanIssuer+"/") {
		return false
	}
	form := url.Values{"token": {refreshToken}, "token_type_hint": {"refresh_token"}, "client_id": {clientID}}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, metadata.RevocationEndpoint, strings.NewReader(form.Encode()))
	if err != nil {
		return false
	}
	req.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	revoked, err := client.Do(req)
	if err != nil {
		return false
	}
	defer revoked.Body.Close()
	return revoked.StatusCode == http.StatusOK
}
