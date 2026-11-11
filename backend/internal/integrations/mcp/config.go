package mcpintegration

import (
	"encoding/json"
	"fmt"
	"net/http"
	"regexp"
	"slices"
	"sort"
	"strings"
	"time"
	"unicode/utf8"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"

	"golang.org/x/net/http/httpguts"
)

type Parameter struct {
	Name         string `json:"name"`
	Label        string `json:"label"`
	Description  string `json:"description"`
	Type         string `json:"type"`
	Required     bool   `json:"required"`
	DefaultValue string `json:"defaultValue,omitempty"`
}

type TemplateInput struct {
	Name        string            `json:"name"`
	Description string            `json:"description"`
	Homepage    string            `json:"homepage"`
	Transport   string            `json:"transport"`
	ServerURL   string            `json:"serverUrl"`
	Headers     map[string]string `json:"headers"`
	Parameters  []Parameter       `json:"parameters"`
	Published   bool              `json:"published"`
}

type TemplateView struct {
	TemplateInput
	ID        string    `json:"id"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

type ConnectionInput struct {
	Name         string            `json:"name"`
	TemplateID   string            `json:"templateId,omitempty"`
	Transport    string            `json:"transport"`
	ServerURL    string            `json:"serverUrl"`
	Parameters   map[string]string `json:"parameters"`
	Enabled      bool              `json:"enabled"`
	AllowedTools []string          `json:"allowedTools"`
}

type ConnectionView struct {
	ID                string            `json:"id"`
	Scope             string            `json:"scope"`
	TemplateID        string            `json:"templateId,omitempty"`
	Name              string            `json:"name"`
	Transport         string            `json:"transport"`
	ServerURL         string            `json:"serverUrl"`
	Enabled           bool              `json:"enabled"`
	Parameters        map[string]string `json:"parameters"`
	ConfiguredSecrets []string          `json:"configuredSecrets"`
	Tools             []Tool            `json:"tools"`
	AllowedTools      []string          `json:"allowedTools"`
	Revision          int64             `json:"revision"`
	LastTestAt        *time.Time        `json:"lastTestAt,omitempty"`
	CreatedAt         time.Time         `json:"createdAt"`
	UpdatedAt         time.Time         `json:"updatedAt"`
}

var parameterName = regexp.MustCompile(`^[a-zA-Z][a-zA-Z0-9_]{0,63}$`)
var placeholders = regexp.MustCompile(`\{\{([a-zA-Z][a-zA-Z0-9_]*)\}\}`)

func validateTransport(transport string) error {
	if transport != "streamable_http" && transport != "sse" {
		return kernel.BadAuthRequest("MCP 仅支持 Streamable HTTP 或 SSE")
	}
	return nil
}

func validateURL(raw string) error {
	parsed, err := outbound.ValidateCustomRelayURL(raw)
	if err != nil {
		return err
	}
	if parsed.RawQuery != "" || parsed.Fragment != "" || strings.Contains(raw, "{{") {
		return kernel.BadAuthRequest("MCP 地址不能携带查询参数、片段或密钥占位符，请通过请求头配置认证")
	}
	return nil
}

func validateTemplate(input *TemplateInput) error {
	input.Name = strings.TrimSpace(input.Name)
	input.ServerURL = strings.TrimSpace(input.ServerURL)
	if input.Name == "" || utf8.RuneCountInString(input.Name) > 100 || utf8.RuneCountInString(input.Description) > 3000 {
		return kernel.BadAuthRequest("MCP 名称不能为空且最多 100 字，描述最多 3000 字")
	}
	if err := validateTransport(input.Transport); err != nil {
		return err
	}
	if input.ServerURL != "" {
		if err := validateURL(input.ServerURL); err != nil {
			return err
		}
	}
	if input.Homepage != "" {
		if err := validateURL(input.Homepage); err != nil {
			return kernel.BadAuthRequest("MCP 官网地址无效")
		}
	}
	if len(input.Parameters) > 24 || len(input.Headers) > 16 {
		return kernel.BadAuthRequest("MCP 参数或请求头数量超过上限")
	}
	definitions := map[string]Parameter{}
	for _, p := range input.Parameters {
		if !parameterName.MatchString(p.Name) || definitions[p.Name].Name != "" || (p.Type != "string" && p.Type != "secret") {
			return kernel.BadAuthRequest("MCP 参数名称重复、格式或类型无效")
		}
		if len(p.Label) > 300 || len(p.Description) > 3000 || len(p.DefaultValue) > 4096 || (p.Type == "secret" && p.DefaultValue != "") {
			return kernel.BadAuthRequest("MCP 参数说明过长，或密钥参数设置了默认值")
		}
		definitions[p.Name] = p
	}
	canonicalHeaders := map[string]bool{}
	for name, value := range input.Headers {
		if !validHeader(name, value) {
			return kernel.BadAuthRequest("MCP 请求头无效或试图覆盖传输协议")
		}
		canonical := http.CanonicalHeaderKey(name)
		if canonicalHeaders[canonical] {
			return kernel.BadAuthRequest("MCP 请求头名称不能重复")
		}
		canonicalHeaders[canonical] = true
		matches := placeholders.FindAllStringSubmatch(value, -1)
		for _, match := range matches {
			if definitions[match[1]].Name == "" {
				return kernel.BadAuthRequest("MCP 请求头引用了未定义的参数")
			}
			if (strings.EqualFold(name, "Authorization") || strings.Contains(strings.ToLower(name), "key") || strings.Contains(strings.ToLower(name), "token")) && definitions[match[1]].Type != "secret" {
				return kernel.BadAuthRequest("认证请求头必须使用 secret 类型参数，避免凭据回显")
			}
		}
		if strings.Contains(placeholders.ReplaceAllString(value, ""), "{{") {
			return kernel.BadAuthRequest("MCP 参数占位符无效")
		}
		if (strings.EqualFold(name, "Authorization") || strings.Contains(strings.ToLower(name), "key") || strings.Contains(strings.ToLower(name), "token")) && len(matches) == 0 {
			return kernel.BadAuthRequest("认证请求头必须引用密钥参数，不能在市场模板中存放密钥")
		}
	}
	if input.Parameters == nil {
		input.Parameters = []Parameter{}
	}
	if input.Headers == nil {
		input.Headers = map[string]string{}
	}
	return nil
}

func validHeader(name, value string) bool {
	if !httpguts.ValidHeaderFieldName(name) || !httpguts.ValidHeaderFieldValue(value) || len(value) > 8192 {
		return false
	}
	switch strings.ToLower(name) {
	case "host", "content-type", "content-length", "accept", "connection", "upgrade", "transfer-encoding", "te", "trailer", "proxy-authorization", "proxy-authenticate", "proxy-connection", "cookie", "set-cookie", "origin", "mcp-session-id", "mcp-protocol-version":
		return false
	}
	return !strings.HasPrefix(strings.ToLower(name), "x-forwarded-")
}

func parseTemplate(row *model.MCPServerTemplate) (TemplateView, error) {
	view := TemplateView{ID: row.ID, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
	if err := json.Unmarshal([]byte(row.Definition), &view.TemplateInput); err != nil {
		return view, fmt.Errorf("decode MCP catalog: %w", err)
	}
	view.Published = row.Published
	if view.Parameters == nil {
		view.Parameters = []Parameter{}
	}
	if view.Headers == nil {
		view.Headers = map[string]string{}
	}
	return view, nil
}

func (s *Service) templateFor(id, scope string) (TemplateInput, error) {
	if id == "" {
		return TemplateInput{Headers: map[string]string{"Authorization": "Bearer {{token}}"}, Parameters: []Parameter{{Name: "token", Label: "访问令牌", Type: "secret"}}}, nil
	}
	row, err := s.repo.MCPTemplate(id)
	if err != nil {
		return TemplateInput{}, notFound(err)
	}
	if scope == "user" && !row.Published {
		return TemplateInput{}, kernel.Forbidden("此 MCP 市场条目已下架")
	}
	view, err := parseTemplate(row)
	return view.TemplateInput, err
}

func (s *Service) parameterValues(row *model.MCPConnection) (map[string]string, error) {
	values := map[string]string{}
	if row.ParametersCiphertext == "" {
		return values, nil
	}
	plain, err := s.decrypt(row.ParametersCiphertext)
	if err != nil {
		return nil, kernel.WrapAppError(500, "MCP 参数解密失败，请检查服务端加密密钥", err)
	}
	if err := json.Unmarshal([]byte(plain), &values); err != nil {
		return nil, kernel.WrapAppError(500, "MCP 参数存储无效", err)
	}
	return values, nil
}

func mergeParameters(definitions []Parameter, prior, input map[string]string) (map[string]string, error) {
	result, known := map[string]string{}, map[string]bool{}
	for _, p := range definitions {
		known[p.Name] = true
		value, supplied := input[p.Name]
		if !supplied || (p.Type == "secret" && value == "") {
			value = prior[p.Name]
			if value == "" {
				value = p.DefaultValue
			}
		}
		if len(value) > 8192 || !httpguts.ValidHeaderFieldValue(value) {
			return nil, kernel.BadAuthRequest("MCP 参数过长或包含非法字符")
		}
		result[p.Name] = value
	}
	for name := range input {
		if !known[name] {
			return nil, kernel.BadAuthRequest("MCP 包含未声明的参数")
		}
	}
	return result, nil
}

func (s *Service) remoteConfig(row *model.MCPConnection) (remoteConfig, []string, error) {
	template, err := s.templateFor(row.TemplateID, row.Scope)
	if err != nil {
		return remoteConfig{}, nil, err
	}
	values, err := s.parameterValues(row)
	if err != nil {
		return remoteConfig{}, nil, err
	}
	secrets := []string{}
	for _, p := range template.Parameters {
		if p.Required && strings.TrimSpace(values[p.Name]) == "" {
			return remoteConfig{}, nil, kernel.BadAuthRequest("请填写 MCP 必填参数：" + p.Name)
		}
		if p.Type == "secret" && values[p.Name] != "" {
			secrets = append(secrets, values[p.Name])
		}
	}
	headers := map[string]string{}
	for name, value := range template.Headers {
		missing := false
		resolved := placeholders.ReplaceAllStringFunc(value, func(match string) string {
			name := placeholders.FindStringSubmatch(match)[1]
			if values[name] == "" {
				missing = true
			}
			return values[name]
		})
		if missing {
			continue
		}
		if !validHeader(name, resolved) {
			return remoteConfig{}, nil, kernel.BadAuthRequest("MCP 参数生成了非法请求头")
		}
		headers[http.CanonicalHeaderKey(name)] = resolved
	}
	return remoteConfig{URL: row.ServerURL, Transport: row.Transport, Headers: headers}, secrets, nil
}

func decodeTools(row *model.MCPConnection) ([]Tool, []string, error) {
	tools, allowed := []Tool{}, []string{}
	if err := json.Unmarshal([]byte(row.ToolsJSON), &tools); err != nil {
		return nil, nil, err
	}
	if err := json.Unmarshal([]byte(row.AllowedToolsJSON), &allowed); err != nil {
		return nil, nil, err
	}
	return tools, allowed, nil
}

func (s *Service) connectionView(row *model.MCPConnection, shared bool) (ConnectionView, error) {
	view := ConnectionView{ID: row.ID, Scope: row.Scope, TemplateID: row.TemplateID, Name: row.Name, Transport: row.Transport, ServerURL: row.ServerURL,
		Enabled: row.Enabled, Parameters: map[string]string{}, ConfiguredSecrets: []string{}, Revision: row.Revision, LastTestAt: row.LastTestAt, CreatedAt: row.CreatedAt, UpdatedAt: row.UpdatedAt}
	var err error
	view.Tools, view.AllowedTools, err = decodeTools(row)
	if err != nil {
		return view, err
	}
	if shared {
		view.Tools = slices.DeleteFunc(view.Tools, func(tool Tool) bool { return !slices.Contains(view.AllowedTools, tool.Name) })
		return view, nil
	}
	// An unpublished template remains editable by its owner, but cannot run.
	template, err := s.templateFor(row.TemplateID, "platform")
	if err != nil {
		return view, err
	}
	values, err := s.parameterValues(row)
	if err != nil {
		return view, err
	}
	for _, p := range template.Parameters {
		if p.Type == "secret" {
			if values[p.Name] != "" {
				view.ConfiguredSecrets = append(view.ConfiguredSecrets, p.Name)
			}
		} else {
			view.Parameters[p.Name] = values[p.Name]
		}
	}
	sort.Strings(view.ConfiguredSecrets)
	return view, nil
}
