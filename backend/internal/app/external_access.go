package app

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net/url"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

type IssuedAPIKey struct {
	Key   model.UserAPIKey `json:"key"`
	Token string           `json:"token"`
}

func (s *Service) UserAPIKeys(userID string) ([]model.UserAPIKey, error) {
	return s.repo.UserAPIKeys(userID)
}

func (s *Service) CreateUserAPIKey(userID, name string) (*IssuedAPIKey, error) {
	name = strings.TrimSpace(name)
	if name == "" || utf8.RuneCountInString(name) > 100 {
		return nil, BadAuthRequest("密钥名称必须为 1–100 个字符")
	}
	keys, err := s.repo.UserAPIKeys(userID)
	if err != nil {
		return nil, err
	}
	active := 0
	for _, key := range keys {
		if key.RevokedAt == nil && key.Kind == "manual" {
			active++
		}
	}
	if active >= 20 {
		return nil, BadAuthRequest("最多保留 20 个有效 API Key")
	}
	return s.issueUserAPIKey(userID, name, "manual", "")
}

func (s *Service) issueUserAPIKey(userID, name, kind, clientID string) (*IssuedAPIKey, error) {
	token := "yc_" + randomToken()
	key := model.UserAPIKey{ID: newID(), UserID: userID, Name: name, Kind: kind, TokenHash: hashToken(token), Prefix: token[:min(len(token), 12)], ClientID: clientID, CreatedAt: time.Now()}
	if err := s.repo.CreateUserAPIKey(&key); err != nil {
		return nil, err
	}
	return &IssuedAPIKey{Key: key, Token: token}, nil
}

func (s *Service) RevokeUserAPIKey(userID, keyID string) error {
	count, err := s.repo.RevokeUserAPIKey(userID, keyID)
	if err != nil {
		return err
	}
	if count == 0 {
		return NotFound("API Key 不存在或已撤销")
	}
	return nil
}

func (s *Service) UserForAPIKey(token string) (*model.User, *model.UserAPIKey, error) {
	if !strings.HasPrefix(token, "yc_") || len(token) > 256 {
		return nil, nil, Unauthorized("API Key 无效")
	}
	key, err := s.repo.UserAPIKeyByHash(hashToken(token))
	if err != nil {
		return nil, nil, Unauthorized("API Key 无效")
	}
	user, err := s.repo.User(key.UserID)
	if err != nil || user.Status != model.UserStatusActive {
		return nil, nil, Unauthorized("账号不可用")
	}
	s.repo.TouchUserAPIKey(key.ID)
	return user, key, nil
}

func validMCPRedirectURI(raw string) bool {
	u, err := url.Parse(raw)
	if err != nil || u.Host == "" || u.Fragment != "" || u.User != nil || len(raw) > 2048 {
		return false
	}
	if u.Scheme == "https" {
		return true
	}
	host := strings.ToLower(u.Hostname())
	return u.Scheme == "http" && (host == "localhost" || host == "127.0.0.1" || host == "[::1]" || host == "::1")
}

func (s *Service) RegisterMCPClient(name string, redirectURIs []string) (*model.MCPClient, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		name = "外部 Agent"
	}
	if utf8.RuneCountInString(name) > 100 || len(redirectURIs) == 0 || len(redirectURIs) > 8 {
		return nil, BadAuthRequest("MCP 客户端信息无效")
	}
	for _, redirectURI := range redirectURIs {
		if !validMCPRedirectURI(redirectURI) {
			return nil, BadAuthRequest("MCP 回调地址无效")
		}
	}
	encoded, _ := json.Marshal(redirectURIs)
	client := model.MCPClient{ID: newID(), ClientID: "mcp_" + randomToken(), Name: name, RedirectURIsJSON: string(encoded), CreatedAt: time.Now()}
	if err := s.repo.CreateMCPClient(&client); err != nil {
		return nil, err
	}
	return &client, nil
}

func (s *Service) MCPClient(clientID string) (*model.MCPClient, error) {
	client, err := s.repo.MCPClient(clientID)
	if err != nil {
		return nil, NotFound("MCP 客户端不存在")
	}
	return client, nil
}

func (s *Service) ValidateMCPRedirect(clientID, redirectURI string) error {
	client, err := s.MCPClient(clientID)
	if err != nil {
		return err
	}
	var registered []string
	if json.Unmarshal([]byte(client.RedirectURIsJSON), &registered) != nil {
		return BadAuthRequest("MCP 客户端配置无效")
	}
	for _, candidate := range registered {
		if candidate == redirectURI {
			return nil
		}
	}
	return BadAuthRequest("MCP 回调地址无效")
}

func (s *Service) AuthorizeMCP(userID, clientID, redirectURI, challenge, resource string) (string, error) {
	if err := s.ValidateMCPRedirect(clientID, redirectURI); err != nil {
		return "", err
	}
	if len(challenge) != 43 || strings.TrimSpace(resource) == "" {
		return "", BadAuthRequest("MCP 授权参数无效")
	}
	if _, err := base64.RawURLEncoding.DecodeString(challenge); err != nil {
		return "", BadAuthRequest("PKCE 参数无效")
	}
	codeValue := randomToken()
	code := model.MCPAuthorizationCode{ID: newID(), CodeHash: hashToken(codeValue), UserID: userID, ClientID: clientID, RedirectURI: redirectURI, CodeChallenge: challenge, Resource: resource, ExpiresAt: time.Now().Add(5 * time.Minute), CreatedAt: time.Now()}
	if err := s.repo.CreateMCPAuthorizationCode(&code); err != nil {
		return "", err
	}
	return codeValue, nil
}

func (s *Service) ExchangeMCPCode(codeValue, clientID, redirectURI, verifier, resource string) (*IssuedAPIKey, error) {
	if len(verifier) < 43 || len(verifier) > 128 || codeValue == "" {
		return nil, BadAuthRequest("授权码或 PKCE 参数无效")
	}
	challenge := sha256.Sum256([]byte(verifier))
	expected := base64.RawURLEncoding.EncodeToString(challenge[:])
	var issued *IssuedAPIKey
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		code, err := tx.ConsumeMCPAuthorizationCode(hashToken(codeValue), time.Now())
		if err != nil || code.ClientID != clientID || code.RedirectURI != redirectURI || code.Resource != resource || !hmac.Equal([]byte(code.CodeChallenge), []byte(expected)) {
			return BadAuthRequest("授权码无效或已过期")
		}
		client, err := tx.MCPClient(clientID)
		if err != nil {
			return BadAuthRequest("MCP 客户端不存在")
		}
		user, err := tx.User(code.UserID)
		if err != nil || user.Status != model.UserStatusActive {
			return Unauthorized("账号不可用")
		}
		token := "yc_" + randomToken()
		key := model.UserAPIKey{ID: newID(), UserID: code.UserID, Name: fmt.Sprintf("MCP 授权 · %s", client.Name), Kind: "mcp", TokenHash: hashToken(token), Prefix: token[:min(len(token), 12)], ClientID: clientID, CreatedAt: time.Now()}
		if err := tx.CreateUserAPIKey(&key); err != nil {
			return err
		}
		issued = &IssuedAPIKey{Key: key, Token: token}
		return nil
	})
	return issued, err
}
