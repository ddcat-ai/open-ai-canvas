// Package antigravity 通过官方 Antigravity CLI（agy）的 ACP 接口调用 Antigravity 模型。
//
// 画布不直接访问 Google 接口，也不读取 agy 保存的登录凭据：安装、登录、鉴权和模型请求
// 全部交给官方 agy 程序完成。每个系统渠道（Key 分组）对应一个独立的 agy 资料目录，
// 也就是一个独立的 Google 账号或 API Key。
package antigravity

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

// AuthMethod 与 agy ACP initialize 返回的 authMethods 标识一致。
type AuthMethod string

const (
	AuthPersonal      AuthMethod = "oauth-personal"
	AuthBusiness      AuthMethod = "oauth-business"
	AuthGeminiAPIKey  AuthMethod = "gemini-api-key"
	AuthAgentPlatform AuthMethod = "agent-platform"
)

// ParseAuthMethod 只接受 agy 支持的四种登录方式。
func ParseAuthMethod(value string) (AuthMethod, error) {
	switch method := AuthMethod(strings.TrimSpace(value)); method {
	case AuthPersonal, AuthBusiness, AuthGeminiAPIKey, AuthAgentPlatform:
		return method, nil
	}
	return "", fmt.Errorf("不支持的 Antigravity 登录方式：%s", value)
}

// UsesGoogleSignIn 表示该方式需要在浏览器里登录 Google，其余方式使用 API Key 或 ADC。
func (m AuthMethod) UsesGoogleSignIn() bool {
	return m == AuthPersonal || m == AuthBusiness
}

const (
	acpDirectoryName  = "antigravity-acp"
	settingsFileName  = "settings.json"
	runtimeStateFile  = "current.json"
	inspectionTimeout = 2 * time.Minute
)

// Settings 是 agy 资料目录 antigravity-acp/settings.json 的内容，由 agy 自己读取。
type Settings struct {
	Auth struct {
		Type AuthMethod `json:"type"`
	} `json:"auth"`
	GCP *GCPSettings `json:"gcp,omitempty"`
}

type GCPSettings struct {
	Project  string `json:"project,omitempty"`
	Location string `json:"location,omitempty"`
}

// Profile 是一次 agy 调用所需的渠道配置。APIKey 来自渠道加密保存的密钥，只经环境变量交给 agy。
type Profile struct {
	ChannelID string
	APIKey    string
	ProxyURL  string
}

// Manager 管理托管的 agy 程序、各渠道资料目录、登录流程和连接检查结果。
type Manager struct {
	root        string
	httpClient  *http.Client
	installMu   sync.Mutex
	stateMu     sync.Mutex
	logins      map[string]*loginFlow
	inspections map[string]Inspection
}

// New 以画布数据目录下的 antigravity 子目录作为根目录。
func New(dataDir string) *Manager {
	return &Manager{
		root:        filepath.Join(dataDir, "antigravity"),
		httpClient:  &http.Client{Transport: http.DefaultTransport},
		logins:      map[string]*loginFlow{},
		inspections: map[string]Inspection{},
	}
}

func (m *Manager) profileDirectory(channelID string) string {
	return filepath.Join(m.root, "profiles", channelID)
}

func (m *Manager) acpDirectory(channelID string) string {
	return filepath.Join(m.profileDirectory(channelID), acpDirectoryName)
}

// Settings 读取渠道的 agy 设置；尚未保存过时返回个人 Google 账号登录。
func (m *Manager) Settings(channelID string) (Settings, error) {
	var settings Settings
	data, err := os.ReadFile(filepath.Join(m.acpDirectory(channelID), settingsFileName))
	if errors.Is(err, os.ErrNotExist) {
		settings.Auth.Type = AuthPersonal
		return settings, nil
	}
	if err != nil {
		return settings, err
	}
	if err := json.Unmarshal(data, &settings); err != nil {
		return settings, fmt.Errorf("Antigravity 设置文件无效：%w", err)
	}
	if _, err := ParseAuthMethod(string(settings.Auth.Type)); err != nil {
		return settings, err
	}
	return settings, nil
}

// SaveSettings 写入 agy 设置；登录方式或 GCP 项目变化后旧的连接检查结果作废。
func (m *Manager) SaveSettings(channelID string, settings Settings) error {
	if _, err := ParseAuthMethod(string(settings.Auth.Type)); err != nil {
		return err
	}
	if settings.GCP != nil && settings.GCP.Project == "" && settings.GCP.Location == "" {
		settings.GCP = nil
	}
	if err := os.MkdirAll(m.acpDirectory(channelID), 0o700); err != nil {
		return err
	}
	data, err := json.Marshal(settings)
	if err != nil {
		return err
	}
	if err := os.WriteFile(filepath.Join(m.acpDirectory(channelID), settingsFileName), append(data, '\n'), 0o600); err != nil {
		return err
	}
	m.forgetInspection(channelID)
	return nil
}

// RemoveProfile 删除渠道的 agy 资料目录（含 agy 保存的登录凭据）。
func (m *Manager) RemoveProfile(channelID string) error {
	m.CancelLogin(channelID)
	m.forgetInspection(channelID)
	return os.RemoveAll(m.profileDirectory(channelID))
}

// environment 组装 agy 进程环境：继承宿主代理等设置，去掉会改变 agy 鉴权来源的变量。
func (m *Manager) environment(profile Profile, settings Settings, tempDirectory string) []string {
	removed := map[string]bool{
		"GEMINI_API_KEY": true, "GOOGLE_API_KEY": true, "GOOGLE_APPLICATION_CREDENTIALS": true,
		"GOOGLE_CLOUD_PROJECT": true, "GOOGLE_CLOUD_LOCATION": true, "GOOGLE_GENAI_USE_VERTEXAI": true,
		"GEMINI_HOME": true, "AGY_ACP_FORCE_FILE_STORAGE": true, "AGY_CLI_DISABLE_AUTO_UPDATE": true,
		"BROWSER": true, "TMPDIR": true, "SSH_CONNECTION": true, "NO_PROXY": true, "no_proxy": true,
	}
	if profile.ProxyURL != "" {
		for _, key := range []string{"HTTP_PROXY", "HTTPS_PROXY", "ALL_PROXY", "http_proxy", "https_proxy", "all_proxy"} {
			removed[key] = true
		}
	}
	environment := make([]string, 0, len(os.Environ())+12)
	for _, entry := range os.Environ() {
		key, _, _ := strings.Cut(entry, "=")
		if !removed[key] {
			environment = append(environment, entry)
		}
	}
	// 本机 MCP 工具桥监听 127.0.0.1，不能被代理转走。
	noProxy := strings.Trim(strings.Join([]string{os.Getenv("NO_PROXY"), "127.0.0.1,localhost"}, ","), ",")
	environment = append(environment,
		"GEMINI_HOME="+m.profileDirectory(profile.ChannelID),
		"AGY_ACP_FORCE_FILE_STORAGE=1",
		"AGY_CLI_DISABLE_AUTO_UPDATE=true",
		// 服务器上没有可打开的浏览器：按远程终端处理，agy 改为打印登录链接并等待粘贴授权码。
		"SSH_CONNECTION=127.0.0.1 0 127.0.0.1 0",
		"BROWSER=false",
		"TMPDIR="+tempDirectory,
		"NO_PROXY="+noProxy,
		"no_proxy="+noProxy,
	)
	if profile.ProxyURL != "" {
		environment = append(environment, "HTTP_PROXY="+profile.ProxyURL, "HTTPS_PROXY="+profile.ProxyURL, "http_proxy="+profile.ProxyURL, "https_proxy="+profile.ProxyURL)
	}
	switch settings.Auth.Type {
	case AuthGeminiAPIKey:
		environment = append(environment, "GEMINI_API_KEY="+profile.APIKey)
	case AuthAgentPlatform:
		if profile.APIKey != "" {
			environment = append(environment, "GOOGLE_API_KEY="+profile.APIKey)
		}
	}
	return environment
}

// session 是一次性的 agy acp 进程：初始化、鉴权并创建会话，用完即关闭并清理会话文件。
type session struct {
	manager   *Manager
	channelID string
	process   *acpProcess
	init      initializeResult
	created   newSessionResult
	workDir   string
	tempDir   string
}

type sessionOptions struct {
	mcpServers   []map[string]any
	systemPrompt string
	handlers     acpHandlers
}

func (m *Manager) openSession(ctx context.Context, profile Profile, options sessionOptions) (*session, error) {
	executable, err := m.executable()
	if err != nil {
		return nil, err
	}
	settings, err := m.Settings(profile.ChannelID)
	if err != nil {
		return nil, err
	}
	if settings.Auth.Type == AuthGeminiAPIKey && profile.APIKey == "" {
		return nil, errors.New("Gemini API Key 登录方式需要先在渠道里填写 API Key")
	}
	if err := m.SaveSettingsIfMissing(profile.ChannelID, settings); err != nil {
		return nil, err
	}
	tempDir := filepath.Join(m.acpDirectory(profile.ChannelID), "tmp")
	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return nil, err
	}
	workDir, err := os.MkdirTemp(tempDir, "work-")
	if err != nil {
		return nil, err
	}
	process, err := startACP(launchSpec{
		executable: executable,
		args:       []string{"acp", "--gemini-dir", m.profileDirectory(profile.ChannelID), "--app-data-dir", acpDirectoryName, "--process-per-session"},
		env:        m.environment(profile, settings, tempDir),
		dir:        workDir,
	}, options.handlers)
	if err != nil {
		_ = os.RemoveAll(workDir)
		return nil, err
	}
	current := &session{manager: m, channelID: profile.ChannelID, process: process, workDir: workDir, tempDir: tempDir}
	if err := current.start(ctx, settings, options); err != nil {
		current.close()
		return nil, err
	}
	return current, nil
}

func (s *session) start(ctx context.Context, settings Settings, options sessionOptions) error {
	if err := s.process.call(ctx, "initialize", map[string]any{
		"protocolVersion":    acpProtocolVersion,
		"clientCapabilities": map[string]any{"fs": map[string]any{"readTextFile": false, "writeTextFile": false}, "terminal": false},
		"clientInfo":         map[string]any{"name": acpClientName, "title": acpClientTitle, "version": "1"},
	}, &s.init); err != nil {
		return err
	}
	if err := s.process.call(ctx, "authenticate", map[string]any{"methodId": string(settings.Auth.Type)}, nil); err != nil {
		var failure *rpcError
		if errors.As(err, &failure) {
			return fmt.Errorf("Antigravity 鉴权失败：%s", failure.Message)
		}
		return err
	}
	params := map[string]any{"cwd": s.workDir, "mcpServers": options.mcpServers}
	// 不支持追加系统提示词的版本由调用方把系统提示词写进 prompt。
	if options.systemPrompt != "" && s.appendsSystemPrompt() {
		params["_meta"] = map[string]any{"antigravity": map[string]any{"systemPrompt": map[string]any{"append": options.systemPrompt}}}
	}
	return s.process.call(ctx, "session/new", params, &s.created)
}

// appendsSystemPrompt 表示 agy 支持在会话元数据里追加系统提示词。
func (s *session) appendsSystemPrompt() bool {
	return s.init.AgentCapabilities.Meta.Antigravity.SystemPrompt.Append
}

func (s *session) selectModel(ctx context.Context, modelID string) error {
	option, ok := s.created.option("model")
	if !ok {
		return errors.New("Antigravity 会话没有提供模型选项")
	}
	if option.CurrentValue == modelID {
		return nil
	}
	known := false
	for _, value := range option.values() {
		if value.Value == modelID {
			known = true
			break
		}
	}
	if !known {
		return fmt.Errorf("当前 Antigravity 账号不能使用模型 %s，请重新读取模型目录", modelID)
	}
	return s.process.call(ctx, "session/set_config_option", map[string]any{"sessionId": s.created.SessionID, "configId": "model", "value": modelID}, nil)
}

func (s *session) close() {
	s.process.close()
	if s.created.SessionID != "" {
		s.manager.removeSessionFiles(s.channelID, s.created.SessionID)
	}
	_ = os.RemoveAll(s.workDir)
}

// removeSessionFiles 删除 agy 为一次性会话写下的对话库与工作记录；资料目录只给画布使用。
func (m *Manager) removeSessionFiles(channelID, sessionID string) {
	if strings.ContainsAny(sessionID, `/\.`) {
		return
	}
	acp := m.acpDirectory(channelID)
	for _, suffix := range []string{".db", ".db-wal", ".db-shm", ".db-journal", ".meta"} {
		_ = os.Remove(filepath.Join(acp, "conversations", sessionID+suffix))
	}
	_ = os.RemoveAll(filepath.Join(acp, "brain", sessionID))
	_ = os.Remove(filepath.Join(acp, "annotations", sessionID+".pbtxt"))
}

// SaveSettingsIfMissing 让首次调用前也有 agy 能读到的设置文件。
func (m *Manager) SaveSettingsIfMissing(channelID string, settings Settings) error {
	if _, err := os.Stat(filepath.Join(m.acpDirectory(channelID), settingsFileName)); err == nil {
		return nil
	}
	return m.SaveSettings(channelID, settings)
}

// Model 是 agy 为当前账号列出的一个模型。
type Model struct {
	ID          string `json:"id"`
	Name        string `json:"name"`
	Description string `json:"description,omitempty"`
}

// Inspection 是最近一次连接检查的结果，缓存在内存里供后台页面显示。
type Inspection struct {
	CheckedAt    time.Time `json:"checkedAt"`
	SignedIn     bool      `json:"signedIn"`
	Models       []Model   `json:"models"`
	DefaultModel string    `json:"defaultModel,omitempty"`
	AgentVersion string    `json:"agentVersion,omitempty"`
	Error        string    `json:"error,omitempty"`
}

// Inspect 启动一次 agy 会话检查登录状态，并读取当前账号可用的模型。
func (m *Manager) Inspect(ctx context.Context, profile Profile) (Inspection, error) {
	ctx, cancel := context.WithTimeout(ctx, inspectionTimeout)
	defer cancel()
	result := Inspection{CheckedAt: time.Now().UTC(), Models: []Model{}}
	current, err := m.openSession(ctx, profile, sessionOptions{mcpServers: []map[string]any{}, handlers: rejectingHandlers()})
	if errors.Is(err, ErrSignInRequired) {
		m.rememberInspection(profile.ChannelID, result)
		return result, nil
	}
	if err != nil {
		result.Error = err.Error()
		m.rememberInspection(profile.ChannelID, result)
		return result, err
	}
	defer current.close()
	result.SignedIn = true
	result.AgentVersion = current.init.AgentInfo.Version
	if option, ok := current.created.option("model"); ok {
		result.DefaultModel = option.CurrentValue
		for _, value := range option.values() {
			result.Models = append(result.Models, Model{ID: value.Value, Name: firstNonEmpty(value.Name, value.Value), Description: value.Description})
		}
	}
	m.rememberInspection(profile.ChannelID, result)
	return result, nil
}

// CachedInspection 返回最近一次检查结果；没有检查过时 ok 为 false。
func (m *Manager) CachedInspection(channelID string) (Inspection, bool) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	result, ok := m.inspections[channelID]
	return result, ok
}

func (m *Manager) rememberInspection(channelID string, result Inspection) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	m.inspections[channelID] = result
}

func (m *Manager) forgetInspection(channelID string) {
	m.stateMu.Lock()
	defer m.stateMu.Unlock()
	delete(m.inspections, channelID)
}

// Logout 通过 agy 的 ACP logout 清除该渠道保存的 Google 登录凭据。
func (m *Manager) Logout(ctx context.Context, profile Profile) error {
	m.CancelLogin(profile.ChannelID)
	executable, err := m.executable()
	if err != nil {
		return err
	}
	settings, err := m.Settings(profile.ChannelID)
	if err != nil {
		return err
	}
	tempDir := filepath.Join(m.acpDirectory(profile.ChannelID), "tmp")
	if err := os.MkdirAll(tempDir, 0o700); err != nil {
		return err
	}
	process, err := startACP(launchSpec{
		executable: executable,
		args:       []string{"acp", "--gemini-dir", m.profileDirectory(profile.ChannelID), "--app-data-dir", acpDirectoryName},
		env:        m.environment(profile, settings, tempDir),
		dir:        tempDir,
	}, rejectingHandlers())
	if err != nil {
		return err
	}
	defer process.close()
	ctx, cancel := context.WithTimeout(ctx, inspectionTimeout)
	defer cancel()
	var init initializeResult
	if err := process.call(ctx, "initialize", map[string]any{"protocolVersion": acpProtocolVersion, "clientCapabilities": map[string]any{}, "clientInfo": map[string]any{"name": acpClientName, "title": acpClientTitle, "version": "1"}}, &init); err != nil {
		return err
	}
	if init.AgentCapabilities.Auth.Logout == nil {
		return errors.New("当前 Antigravity CLI 版本不支持退出登录，请先更新 CLI")
	}
	if err := process.call(ctx, "logout", map[string]any{}, nil); err != nil {
		return err
	}
	m.rememberInspection(profile.ChannelID, Inspection{CheckedAt: time.Now().UTC(), Models: []Model{}})
	return nil
}

// rejectingHandlers 拒绝 agy 的一切工具授权和客户端能力请求，用于检查和纯文本生成。
func rejectingHandlers() acpHandlers {
	return acpHandlers{request: func(method string, params json.RawMessage) (any, *rpcError) {
		if method == acpRequestPermission {
			var request permissionRequest
			_ = json.Unmarshal(params, &request)
			return permissionOutcome(request, acpPermissionReject), nil
		}
		return nil, &rpcError{Code: acpMethodNotFound, Message: "method not supported by client"}
	}}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
