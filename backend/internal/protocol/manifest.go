package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
)

type ManifestOperation struct {
	Method              string             `json:"method"`
	Path                string             `json:"path"`
	PathTemplate        any                `json:"pathTemplate,omitempty"`
	OriginPath          bool               `json:"originPath,omitempty"`
	ContentType         string             `json:"contentType,omitempty"`
	ContentTypeTemplate any                `json:"contentTypeTemplate,omitempty"`
	Headers             map[string]any     `json:"headers,omitempty"`
	Query               map[string]any     `json:"query,omitempty"`
	Body                any                `json:"body,omitempty"`
	Fields              map[string]string  `json:"fields,omitempty"`
	Files               []ManifestFilePart `json:"files,omitempty"`
}

type ManifestFilePart struct {
	Name     string `json:"name"`
	Source   any    `json:"source"`
	Filename any    `json:"filename,omitempty"`
	MIMEType any    `json:"mimeType,omitempty"`
}

type ManifestResponse struct {
	TaskIDPaths     []string `json:"taskIdPaths,omitempty"`
	StatusPaths     []string `json:"statusPaths,omitempty"`
	ErrorPaths      []string `json:"errorPaths,omitempty"`
	MessagePaths    []string `json:"messagePaths,omitempty"`
	TextPaths       []string `json:"textPaths,omitempty"`
	ReasoningPaths  []string `json:"reasoningPaths,omitempty"`
	ResultURLPaths  []string `json:"resultUrlPaths,omitempty"`
	ResultPaths     []string `json:"resultPaths,omitempty"`
	ResultKind      string   `json:"resultKind,omitempty"`
	ResultEphemeral bool     `json:"resultEphemeral,omitempty"`
	// BinaryPayload 表示 create 同步返回二进制媒体（如 /audio/speech 的音频流）。
	// 声明式解析会把整个响应体包装为对应能力的单个媒体结果，不做 JSON 路径提取。
	BinaryPayload bool `json:"binaryPayload,omitempty"`
	// StreamedJSONAudio 表示 create 返回由连续 JSON 对象组成的 HTTP chunked 音频流；
	// 每个对象可携带 data（Base64 音频片段）、code/message 和 usage。
	StreamedJSONAudio bool `json:"streamedJsonAudio,omitempty"`
	TaskID            any  `json:"taskId,omitempty"`
	Status            any  `json:"status,omitempty"`
	Message           any  `json:"message,omitempty"`
	Text              any  `json:"text,omitempty"`
	Reasoning         any  `json:"reasoning,omitempty"`
	Images            any  `json:"images,omitempty"`
	Videos            any  `json:"videos,omitempty"`
	Audios            any  `json:"audios,omitempty"`
	Usage             any  `json:"usage,omitempty"`
}

// ManifestAgentResponse describes the provider response shape for a
// tool-capable text request. Tool call paths are resolved against each item in
// ToolCallsPath.
type ManifestAgentResponse struct {
	TextPaths              []string `json:"textPaths,omitempty"`
	ReasoningPaths         []string `json:"reasoningPaths,omitempty"`
	ToolCallsPath          string   `json:"toolCallsPath,omitempty"`
	ToolCallIDPaths        []string `json:"toolCallIdPaths,omitempty"`
	ToolCallNamePaths      []string `json:"toolCallNamePaths,omitempty"`
	ToolCallArgsPaths      []string `json:"toolCallArgumentsPaths,omitempty"`
	ToolCallSignaturePaths []string `json:"toolCallThoughtSignaturePaths,omitempty"`
}

// AdapterResolver is used by the host to bind a shipped execution engine to a
// manifest. Uploaded plugins must use the declarative path; host bindings are
// reserved for manifests shipped with the application.
type AdapterResolver func(string) (Adapter, bool)

func LoadInstalledPlugin(data []byte, resolve AdapterResolver) (Adapter, error) {
	adapters, err := LoadInstalledProviders(data, resolve)
	if err != nil {
		return nil, err
	}
	if len(adapters) == 0 {
		return nil, fmt.Errorf("plugin does not provide an executable provider")
	}
	return adapters[0], nil
}

// LoadInstalledProviders loads every provider contribution from one plugin
// package. The package remains the lifecycle and permission unit; providers
// are separate execution entries in the runtime index.
func LoadInstalledProviders(data []byte, resolve AdapterResolver) ([]Adapter, error) {
	manifest, err := decodeManifest(data)
	if err != nil {
		return nil, err
	}
	if strings.HasPrefix(strings.TrimSpace(manifest.Runtime.Backend), "host:") {
		if len(manifest.Contributes.Providers) != 1 {
			return nil, fmt.Errorf("host-backed plugin must declare exactly one provider")
		}
		if resolve == nil {
			return nil, fmt.Errorf("plugin %q requires a host execution engine", manifest.Metadata.ID)
		}
		name := strings.TrimPrefix(strings.TrimSpace(manifest.Runtime.Backend), "host:")
		adapter, ok := resolve(name)
		if !ok {
			return nil, fmt.Errorf("plugin host execution %q is unavailable", name)
		}
		if err := ValidateManifest(manifest); err != nil {
			return nil, err
		}
		if err := normalizeManifest(&manifest); err != nil {
			return nil, err
		}
		return []Adapter{metadataAdapter{metadata: manifest.Metadata, delegate: adapter}}, nil
	}
	if len(manifest.Contributes.Providers) == 0 {
		adapter, err := loadDeclarativeManifest(manifest)
		if err != nil {
			return nil, err
		}
		return []Adapter{adapter}, nil
	}
	result := make([]Adapter, 0, len(manifest.Contributes.Providers))
	for index := range manifest.Contributes.Providers {
		adapter, err := loadDeclarativeManifestProvider(manifest, index)
		if err != nil {
			return nil, err
		}
		result = append(result, adapter)
	}
	return result, nil
}

func validatePluginMetadata(metadata Metadata) error {
	if strings.TrimSpace(metadata.ID) == "" || strings.TrimSpace(metadata.Version) == "" || !validManifestIdentifier(metadata.ID) {
		return fmt.Errorf("protocol plugin metadata is invalid")
	}
	if len(metadata.Categories) == 0 || len(metadata.Scopes) == 0 {
		return fmt.Errorf("protocol plugin metadata requires categories and scopes")
	}
	for _, capability := range metadata.Categories {
		if capability != CapabilityText && capability != CapabilityImage && capability != CapabilityVideo && capability != CapabilityAudio {
			return fmt.Errorf("unsupported protocol capability %q", capability)
		}
	}
	for _, scope := range metadata.Scopes {
		switch scope {
		case SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent:
		default:
			return fmt.Errorf("unsupported protocol scope %q", scope)
		}
	}
	return nil
}

type metadataAdapter struct {
	metadata Metadata
	delegate Adapter
}

func (a metadataAdapter) Metadata() Metadata { return a.metadata }

func (a metadataAdapter) AgentAvailable() bool {
	capability, ok := a.delegate.(AgentCapability)
	return ok && capability.AgentAvailable()
}

func (a metadataAdapter) ResultAvailable() bool {
	capability, ok := a.delegate.(ResultCapability)
	return ok && capability.ResultAvailable()
}

func (a metadataAdapter) BuildCreate(ctx context.Context, c RequestContext) (RequestSpec, error) {
	return a.delegate.BuildCreate(ctx, c)
}

func (a metadataAdapter) ParseCreate(ctx context.Context, body []byte) (CreateResult, error) {
	return a.delegate.ParseCreate(ctx, body)
}

func (a metadataAdapter) BuildPoll(ctx context.Context, c PollContext) (RequestSpec, error) {
	return a.delegate.BuildPoll(ctx, c)
}

func (a metadataAdapter) ParsePoll(ctx context.Context, c PollContext, body []byte) (PollResult, error) {
	return a.delegate.ParsePoll(ctx, c, body)
}

func (a metadataAdapter) BuildCancel(ctx context.Context, c PollContext) (RequestSpec, error) {
	return a.delegate.BuildCancel(ctx, c)
}

func (a metadataAdapter) BuildResult(ctx context.Context, c PollContext) (RequestSpec, error) {
	adapter, ok := a.delegate.(ResultAdapter)
	if !ok {
		return RequestSpec{}, unavailable(a.metadata)
	}
	return adapter.BuildResult(ctx, c)
}

func (a metadataAdapter) BuildAgent(ctx context.Context, c AgentRequestContext) (RequestSpec, error) {
	adapter, ok := a.delegate.(AgentAdapter)
	if !ok {
		return RequestSpec{}, unavailable(a.metadata)
	}
	return adapter.BuildAgent(ctx, c)
}

func (a metadataAdapter) ParseAgent(ctx context.Context, body []byte) (AgentResult, error) {
	adapter, ok := a.delegate.(AgentAdapter)
	if !ok {
		return AgentResult{}, unavailable(a.metadata)
	}
	return adapter.ParseAgent(ctx, body)
}

func LoadManifest(data []byte) (Adapter, error) {
	manifest, err := decodeManifest(data)
	if err != nil {
		return nil, err
	}
	return loadDeclarativeManifest(manifest)
}

func decodeManifest(data []byte) (Manifest, error) {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return Manifest{}, fmt.Errorf("decode plugin manifest: %w", err)
	}
	if err := ValidateManifest(manifest); err != nil {
		return Manifest{}, err
	}
	return manifest, nil
}

func loadDeclarativeManifest(manifest Manifest) (Adapter, error) {
	manifest.Runtime.Backend = "declarative"
	if err := normalizeManifest(&manifest); err != nil {
		return nil, err
	}
	return manifestAdapter{manifest: manifest}, nil
}

func loadDeclarativeManifestProvider(manifest Manifest, index int) (Adapter, error) {
	manifest.Runtime.Backend = "declarative"
	if err := normalizeManifestForProvider(&manifest, index); err != nil {
		return nil, err
	}
	return manifestAdapter{manifest: manifest}, nil
}

func ValidateManifest(manifest Manifest) error {
	seenSMS := map[string]bool{}
	for _, provider := range manifest.Contributes.SMSProviders {
		if !validManifestIdentifier(provider.ID) || strings.TrimSpace(provider.Label) == "" || seenSMS[provider.ID] {
			return fmt.Errorf("invalid or duplicate SMS provider contribution")
		}
		seenSMS[provider.ID] = true
	}
	if version := strings.TrimSpace(manifest.APIVersion); version != "yingce.plugin/v1" && version != "yingce.plugin/v2" {
		return fmt.Errorf("unsupported protocol manifest apiVersion %q", manifest.APIVersion)
	}
	if strings.TrimSpace(manifest.Metadata.ID) == "" || strings.TrimSpace(manifest.Metadata.Version) == "" {
		return fmt.Errorf("protocol manifest metadata requires id and version")
	}
	if strings.TrimSpace(manifest.Metadata.Name) == "" {
		return fmt.Errorf("protocol manifest metadata requires name")
	}
	if !validManifestIdentifier(manifest.Metadata.ID) {
		return fmt.Errorf("protocol manifest metadata id is invalid")
	}
	if len(manifest.Metadata.Name) > 160 || len(manifest.Metadata.Vendor) > 120 {
		return fmt.Errorf("protocol manifest metadata name or vendor is too long")
	}
	if len(manifest.Contributes.Providers) == 0 && !hasNonProviderContribution(manifest.Contributes) {
		return fmt.Errorf("plugin must declare at least one contribution")
	}
	if backend := strings.TrimSpace(manifest.Runtime.Backend); backend != "" && backend != "declarative" && backend != "rpc" && backend != "wasm" && backend != "trusted-backend" && !strings.HasPrefix(backend, "host:") {
		return fmt.Errorf("unsupported plugin backend %q", backend)
	}
	if len(manifest.Contributes.Providers) == 0 {
		return validatePaymentProviderContributions(manifest)
	}
	providerIDs := make(map[string]struct{}, len(manifest.Contributes.Providers))
	for index, provider := range manifest.Contributes.Providers {
		if strings.TrimSpace(provider.ID) == "" || strings.TrimSpace(provider.Label) == "" || !validManifestIdentifier(provider.ID) {
			return fmt.Errorf("provider contribution %d requires a valid id and label", index)
		}
		if _, exists := providerIDs[provider.ID]; exists {
			return fmt.Errorf("duplicate provider contribution %q", provider.ID)
		}
		providerIDs[provider.ID] = struct{}{}
		if len(provider.Capabilities) == 0 || len(provider.Scopes) == 0 {
			return fmt.Errorf("provider contribution %q requires capabilities and scopes", provider.ID)
		}
		for _, capability := range provider.Capabilities {
			if capability != CapabilityText && capability != CapabilityImage && capability != CapabilityVideo && capability != CapabilityAudio {
				return fmt.Errorf("unsupported protocol capability %q", capability)
			}
		}
		for _, scope := range provider.Scopes {
			switch scope {
			case SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent:
			default:
				return fmt.Errorf("unsupported protocol scope %q", scope)
			}
		}
		if err := validateManifestOperation(provider.Create); err != nil {
			return fmt.Errorf("provider %q create operation: %w", provider.ID, err)
		}
		if provider.Agent != nil {
			if err := validateManifestOperation(*provider.Agent); err != nil {
				return fmt.Errorf("provider %q agent operation: %w", provider.ID, err)
			}
			if provider.AgentResponse == nil {
				return fmt.Errorf("provider %q agent response mapping is required when agent operation is declared", provider.ID)
			}
		}
		if provider.Poll != nil {
			if err := validateManifestOperation(*provider.Poll); err != nil {
				return fmt.Errorf("provider %q poll operation: %w", provider.ID, err)
			}
		}
		if provider.Cancel != nil {
			if err := validateManifestOperation(*provider.Cancel); err != nil {
				return fmt.Errorf("provider %q cancel operation: %w", provider.ID, err)
			}
		}
		if provider.Result != nil {
			if err := validateManifestOperation(*provider.Result); err != nil {
				return fmt.Errorf("provider %q result operation: %w", provider.ID, err)
			}
		}
		for ruleIndex, rule := range provider.Validations {
			if rule.Assert == nil || strings.TrimSpace(rule.Message) == "" {
				return fmt.Errorf("provider %q validation %d requires assert and message", provider.ID, ruleIndex)
			}
		}
	}
	return validatePaymentProviderContributions(manifest)
}

func validatePaymentProviderContributions(manifest Manifest) error {
	seen := make(map[string]struct{}, len(manifest.Contributes.PaymentProviders))
	for index, provider := range manifest.Contributes.PaymentProviders {
		provider.ID = strings.TrimSpace(provider.ID)
		if provider.ID == "" || strings.TrimSpace(provider.Label) == "" || !validManifestIdentifier(provider.ID) {
			return fmt.Errorf("payment provider contribution %d requires a valid id and label", index)
		}
		if _, exists := seen[provider.ID]; exists {
			return fmt.Errorf("duplicate payment provider contribution %q", provider.ID)
		}
		seen[provider.ID] = struct{}{}
		if strings.TrimSpace(provider.Icon) == "" {
			return fmt.Errorf("payment provider contribution %q requires an icon", provider.ID)
		}
		switch provider.CheckoutMode {
		case "qr_code", "redirect":
		default:
			return fmt.Errorf("payment provider contribution %q has unsupported checkout mode %q", provider.ID, provider.CheckoutMode)
		}
		policy := provider.ExpiryPolicy
		if policy.MinMinutes <= 0 || policy.DefaultMinutes < policy.MinMinutes || policy.MaxMinutes < policy.DefaultMinutes {
			return fmt.Errorf("payment provider contribution %q has invalid expiry policy", provider.ID)
		}
		for _, field := range provider.IdentityFields {
			if strings.TrimSpace(field) == "" || len(field) > 80 {
				return fmt.Errorf("payment provider contribution %q has invalid identity field %q", provider.ID, field)
			}
		}
		for _, response := range []ManifestPaymentResponse{provider.NotificationSuccess, provider.NotificationFailure} {
			if response.Status < 0 || response.Status > 599 {
				return fmt.Errorf("payment provider contribution %q has invalid notification response status", provider.ID)
			}
		}
	}
	return nil
}

func normalizeManifest(manifest *Manifest) error {
	if manifest == nil {
		return fmt.Errorf("plugin manifest is missing")
	}
	if len(manifest.Contributes.Providers) == 0 {
		manifest.Metadata.Execution = manifest.Runtime.Backend
		return nil
	}
	return normalizeManifestForProvider(manifest, 0)
}

func normalizeManifestForProvider(manifest *Manifest, index int) error {
	if manifest == nil || index < 0 || index >= len(manifest.Contributes.Providers) {
		return fmt.Errorf("plugin provider contribution is missing")
	}
	provider := manifest.Contributes.Providers[index]
	manifest.Metadata.ID = provider.ID
	manifest.Metadata.Categories = provider.Capabilities
	manifest.Metadata.Scopes = provider.Scopes
	manifest.Metadata.Parameters = provider.Parameters
	manifest.Metadata.Create = operationSummary(provider.Create)
	manifest.Metadata.Poll = operationSummaryPtr(provider.Poll)
	manifest.Metadata.Cancel = operationSummaryPtr(provider.Cancel)
	manifest.Metadata.ContentType = provider.Create.ContentType
	manifest.Metadata.RequiresPublicMediaURLs = provider.RequiresPublicMediaURLs
	manifest.Metadata.Execution = manifest.Runtime.Backend
	manifest.Create = provider.Create
	manifest.Agent = provider.Agent
	manifest.Poll = provider.Poll
	manifest.Cancel = provider.Cancel
	manifest.ResultOperation = provider.Result
	manifest.Response = provider.Response
	manifest.AgentResponse = provider.AgentResponse
	manifest.Auth = provider.Auth
	manifest.Validations = provider.Validations
	return nil
}

func hasNonProviderContribution(contributes ManifestContributions) bool {
	if len(contributes.SMSProviders) > 0 {
		return true
	}
	return len(contributes.PaymentProviders) > 0 || len(contributes.Workflows) > 0 || len(contributes.CanvasNodes) > 0 || len(contributes.Transforms) > 0 || len(contributes.Commands) > 0 || len(contributes.AssetSources) > 0 || len(contributes.UsageObservers) > 0 || len(contributes.AICapabilities) > 0 || len(contributes.Agents) > 0 || len(contributes.ImportExport) > 0
}

func operationSummary(operation ManifestOperation) string {
	path := strings.ReplaceAll(operation.Path, "{{model}}", "{model}")
	path = strings.ReplaceAll(path, "{{taskId}}", "{task_id}")
	return strings.ToUpper(operation.Method) + " " + path
}

func operationSummaryPtr(operation *ManifestOperation) string {
	if operation == nil {
		return ""
	}
	return operationSummary(*operation)
}

func validateManifestOperation(operation ManifestOperation) error {
	method := strings.ToUpper(strings.TrimSpace(operation.Method))
	if method != http.MethodGet && method != http.MethodPost && method != http.MethodDelete && method != http.MethodPut {
		return fmt.Errorf("unsupported HTTP method %q", operation.Method)
	}
	if operation.PathTemplate == nil && !isRelativePath(operation.Path) {
		return fmt.Errorf("path must be relative: %q", operation.Path)
	}
	contentType := strings.ToLower(strings.TrimSpace(strings.Split(defaultValue(operation.ContentType, "application/json"), ";")[0]))
	switch contentType {
	case "application/json", "multipart/form-data", "application/x-www-form-urlencoded", "application/octet-stream", "":
	default:
		return fmt.Errorf("unsupported content type %q", operation.ContentType)
	}
	if len(operation.Files) > 0 && operation.ContentTypeTemplate == nil && contentType != "multipart/form-data" {
		return fmt.Errorf("file parts require multipart/form-data")
	}
	for _, file := range operation.Files {
		if strings.TrimSpace(file.Name) == "" || file.Source == nil {
			return fmt.Errorf("multipart file part requires name and source")
		}
	}
	return nil
}

func manifestError(payload map[string]any, paths ...string) bool {
	for _, path := range paths {
		value := pathValue(payload, path)
		switch typed := value.(type) {
		case nil:
			continue
		case string:
			switch strings.ToLower(strings.TrimSpace(typed)) {
			case "", "0", "ok", "success", "succeeded", "true":
				continue
			default:
				return true
			}
		case float64:
			if typed == 0 {
				continue
			}
			return true
		case float32:
			if typed == 0 {
				continue
			}
			return true
		case int, int8, int16, int32, int64:
			if reflectValueIsZero(typed) {
				continue
			}
			return true
		case uint, uint8, uint16, uint32, uint64:
			if reflectValueIsZero(typed) {
				continue
			}
			return true
		default:
			return true
		}
	}
	return false
}

func reflectValueIsZero(value any) bool {
	switch typed := value.(type) {
	case int:
		return typed == 0
	case int8:
		return typed == 0
	case int16:
		return typed == 0
	case int32:
		return typed == 0
	case int64:
		return typed == 0
	case uint:
		return typed == 0
	case uint8:
		return typed == 0
	case uint16:
		return typed == 0
	case uint32:
		return typed == 0
	case uint64:
		return typed == 0
	default:
		return false
	}
}

// firstPathJSONValue keeps scalar response fields string-like while allowing
// providers to return tool arguments as an object instead of a JSON string.
// The platform tool contract always stores arguments as JSON text.
func firstPathJSONValue(payload map[string]any, paths ...string) string {
	for _, path := range paths {
		value := pathValue(payload, path)
		switch typed := value.(type) {
		case string:
			if strings.TrimSpace(typed) != "" {
				return strings.TrimSpace(typed)
			}
		case nil:
			continue
		default:
			encoded, err := json.Marshal(typed)
			if err == nil && len(encoded) > 0 {
				return string(encoded)
			}
		}
	}
	return ""
}

func setMapPath(target map[string]any, path string, value any) {
	parts := strings.Split(strings.Trim(path, "."), ".")
	current := target
	for _, part := range parts[:len(parts)-1] {
		next, ok := current[part].(map[string]any)
		if !ok {
			next = map[string]any{}
			current[part] = next
		}
		current = next
	}
	if len(parts) > 0 {
		current[parts[len(parts)-1]] = value
	}
}

func isRelativePath(path string) bool {
	parsed, err := url.Parse(strings.TrimSpace(path))
	return err == nil && parsed.Path != "" && strings.HasPrefix(parsed.Path, "/") && !strings.HasPrefix(parsed.Path, "//") && parsed.Host == "" && parsed.User == nil && parsed.Scheme == ""
}

func validManifestIdentifier(value string) bool {
	if len(value) == 0 || len(value) > 96 {
		return false
	}
	for index, char := range value {
		if (char >= 'a' && char <= 'z') || (char >= '0' && char <= '9') || char == '-' || char == '_' || char == '.' {
			if index == 0 && (char == '-' || char == '_' || char == '.') {
				return false
			}
			continue
		}
		return false
	}
	return true
}
