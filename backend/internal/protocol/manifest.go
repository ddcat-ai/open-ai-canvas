package protocol

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"strings"
)

// Manifest is the declarative format used by future protocol packages. It is
// intentionally limited to relative HTTP paths and JSON field mappings; a
// plugin cannot inject code or bypass the host outbound policy.
type Manifest struct {
	APIVersion    string                 `json:"apiVersion"`
	Metadata      Metadata               `json:"metadata"`
	Create        ManifestOperation      `json:"create"`
	Agent         *ManifestOperation     `json:"agent,omitempty"`
	Poll          *ManifestOperation     `json:"poll,omitempty"`
	Cancel        *ManifestOperation     `json:"cancel,omitempty"`
	Response      ManifestResponse       `json:"response"`
	AgentResponse *ManifestAgentResponse `json:"agentResponse,omitempty"`
}

type ManifestOperation struct {
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	ContentType string            `json:"contentType,omitempty"`
	Fields      map[string]string `json:"fields,omitempty"`
}

type ManifestResponse struct {
	TaskIDPaths    []string `json:"taskIdPaths,omitempty"`
	StatusPaths    []string `json:"statusPaths,omitempty"`
	MessagePaths   []string `json:"messagePaths,omitempty"`
	TextPaths      []string `json:"textPaths,omitempty"`
	ReasoningPaths []string `json:"reasoningPaths,omitempty"`
	ResultURLPaths []string `json:"resultUrlPaths,omitempty"`
	ResultKind     string   `json:"resultKind,omitempty"`
}

// ManifestAgentResponse describes the provider response shape for a
// tool-capable text request. Tool call paths are resolved against each item in
// ToolCallsPath.
type ManifestAgentResponse struct {
	TextPaths         []string `json:"textPaths,omitempty"`
	ReasoningPaths    []string `json:"reasoningPaths,omitempty"`
	ToolCallsPath     string   `json:"toolCallsPath,omitempty"`
	ToolCallIDPaths   []string `json:"toolCallIdPaths,omitempty"`
	ToolCallNamePaths []string `json:"toolCallNamePaths,omitempty"`
	ToolCallArgsPaths []string `json:"toolCallArgumentsPaths,omitempty"`
}

// AdapterResolver is used by the host to bind a shipped execution engine to a
// manifest. Uploaded plugins must use the declarative path; host bindings are
// reserved for manifests shipped with the application.
type AdapterResolver func(string) (Adapter, bool)

func LoadInstalledPlugin(data []byte, resolve AdapterResolver) (Adapter, error) {
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("decode protocol plugin: %w", err)
	}
	if strings.HasPrefix(strings.TrimSpace(manifest.Metadata.Execution), "host:") {
		if resolve == nil {
			return nil, fmt.Errorf("protocol plugin %q requires a host execution engine", manifest.Metadata.ID)
		}
		name := strings.TrimPrefix(strings.TrimSpace(manifest.Metadata.Execution), "host:")
		adapter, ok := resolve(name)
		if !ok {
			return nil, fmt.Errorf("protocol plugin host execution %q is unavailable", name)
		}
		if err := validatePluginMetadata(manifest.Metadata); err != nil {
			return nil, err
		}
		return metadataAdapter{metadata: manifest.Metadata, delegate: adapter}, nil
	}
	return LoadManifest(data)
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
	var manifest Manifest
	if err := json.Unmarshal(data, &manifest); err != nil {
		return nil, fmt.Errorf("decode protocol manifest: %w", err)
	}
	if err := ValidateManifest(manifest); err != nil {
		return nil, err
	}
	if strings.TrimSpace(manifest.Metadata.Execution) == "" {
		manifest.Metadata.Execution = "declarative"
	}
	return manifestAdapter{manifest: manifest}, nil
}

func ValidateManifest(manifest Manifest) error {
	if strings.TrimSpace(manifest.APIVersion) != "v1" {
		return fmt.Errorf("unsupported protocol manifest apiVersion %q", manifest.APIVersion)
	}
	if strings.TrimSpace(manifest.Metadata.ID) == "" || strings.TrimSpace(manifest.Metadata.Version) == "" {
		return fmt.Errorf("protocol manifest metadata requires id and version")
	}
	if strings.TrimSpace(manifest.Metadata.Name) == "" {
		return fmt.Errorf("protocol manifest metadata requires name")
	}
	if strings.TrimSpace(manifest.Metadata.Documentation) == "" {
		return fmt.Errorf("protocol manifest metadata requires Markdown documentation")
	}
	if !validManifestIdentifier(manifest.Metadata.ID) {
		return fmt.Errorf("protocol manifest metadata id is invalid")
	}
	if len(manifest.Metadata.Name) > 160 || len(manifest.Metadata.Vendor) > 120 {
		return fmt.Errorf("protocol manifest metadata name or vendor is too long")
	}
	if len(manifest.Metadata.Categories) == 0 || len(manifest.Metadata.Scopes) == 0 {
		return fmt.Errorf("protocol manifest metadata requires categories and scopes")
	}
	for _, capability := range manifest.Metadata.Categories {
		if capability != CapabilityText && capability != CapabilityImage && capability != CapabilityVideo && capability != CapabilityAudio {
			return fmt.Errorf("unsupported protocol capability %q", capability)
		}
	}
	for _, scope := range manifest.Metadata.Scopes {
		switch scope {
		case SurfaceAdminSystemChannel, SurfaceUserCustomChannel, SurfaceCanvas, SurfaceCreation, SurfaceAgent:
		default:
			return fmt.Errorf("unsupported protocol scope %q", scope)
		}
	}
	if err := validateManifestOperation(manifest.Create); err != nil {
		return fmt.Errorf("create operation: %w", err)
	}
	if manifest.Agent != nil {
		if err := validateManifestOperation(*manifest.Agent); err != nil {
			return fmt.Errorf("agent operation: %w", err)
		}
		if manifest.AgentResponse == nil {
			return fmt.Errorf("agent response mapping is required when agent operation is declared")
		}
	}
	if manifest.Poll != nil {
		if err := validateManifestOperation(*manifest.Poll); err != nil {
			return fmt.Errorf("poll operation: %w", err)
		}
	}
	if manifest.Cancel != nil {
		if err := validateManifestOperation(*manifest.Cancel); err != nil {
			return fmt.Errorf("cancel operation: %w", err)
		}
	}
	return nil
}

func validateManifestOperation(operation ManifestOperation) error {
	method := strings.ToUpper(strings.TrimSpace(operation.Method))
	if method != http.MethodGet && method != http.MethodPost && method != http.MethodDelete && method != http.MethodPut {
		return fmt.Errorf("unsupported HTTP method %q", operation.Method)
	}
	if !isRelativePath(operation.Path) {
		return fmt.Errorf("path must be relative: %q", operation.Path)
	}
	return nil
}

type manifestAdapter struct{ manifest Manifest }

func (a manifestAdapter) Metadata() Metadata { return a.manifest.Metadata }
func (a manifestAdapter) BuildCreate(_ context.Context, c RequestContext) (RequestSpec, error) {
	return buildManifestOperation(a.manifest.Create, c.Request, ""), nil
}
func (a manifestAdapter) BuildAgent(_ context.Context, c AgentRequestContext) (RequestSpec, error) {
	if a.manifest.Agent == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s has no agent operation", a.manifest.Metadata.ID)
	}
	request := GenerationRequest{Model: c.Model, Extra: map[string]any{"agent": c.Request}}
	return buildManifestOperation(*a.manifest.Agent, request, ""), nil
}
func (a manifestAdapter) ParseAgent(_ context.Context, body []byte) (AgentResult, error) {
	if a.manifest.AgentResponse == nil {
		return AgentResult{}, fmt.Errorf("protocol %s has no agent response mapping", a.manifest.Metadata.ID)
	}
	payload, err := decodeObject(body)
	if err != nil {
		return AgentResult{}, err
	}
	response := a.manifest.AgentResponse
	result := AgentResult{Text: firstPathValue(payload, response.TextPaths...), Reasoning: firstPathValue(payload, response.ReasoningPaths...)}
	if response.ToolCallsPath == "" {
		return result, nil
	}
	for _, item := range arrayValue(pathValue(payload, response.ToolCallsPath)) {
		object, ok := item.(map[string]any)
		if !ok {
			continue
		}
		result.ToolCalls = append(result.ToolCalls, AgentToolCall{
			ID:        firstPathValue(object, response.ToolCallIDPaths...),
			Name:      firstPathValue(object, response.ToolCallNamePaths...),
			Arguments: firstPathJSONValue(object, response.ToolCallArgsPaths...),
		})
	}
	return result, nil
}
func (a manifestAdapter) ParseCreate(_ context.Context, body []byte) (CreateResult, error) {
	payload, err := decodeObject(body)
	if err != nil {
		return CreateResult{}, err
	}
	return a.parse(payload, PollContext{}), nil
}
func (a manifestAdapter) BuildPoll(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.manifest.Poll == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s has no poll operation", a.manifest.Metadata.ID)
	}
	request := c.Request
	request.Model = c.Model
	return buildManifestOperation(*a.manifest.Poll, request, c.TaskID), nil
}
func (a manifestAdapter) ParsePoll(_ context.Context, c PollContext, body []byte) (PollResult, error) {
	payload, err := decodeObject(body)
	if err != nil {
		return PollResult{}, err
	}
	result := a.parse(payload, c)
	return PollResult{TaskID: result.TaskID, Status: result.Status, Result: result.Result, Message: result.Message}, nil
}
func (a manifestAdapter) BuildCancel(_ context.Context, c PollContext) (RequestSpec, error) {
	if a.manifest.Cancel == nil {
		return RequestSpec{}, fmt.Errorf("protocol %s does not support cancellation", a.manifest.Metadata.ID)
	}
	request := c.Request
	request.Model = c.Model
	return buildManifestOperation(*a.manifest.Cancel, request, c.TaskID), nil
}

func (a manifestAdapter) parse(payload map[string]any, c PollContext) CreateResult {
	id := firstPathValue(payload, a.manifest.Response.TaskIDPaths...)
	if id == "" {
		id = c.TaskID
	}
	status := normalizeStatus(firstPathValue(payload, a.manifest.Response.StatusPaths...))
	if status == "" {
		status = StatusPending
	}
	message := firstPathValue(payload, a.manifest.Response.MessagePaths...)
	result := &Result{
		Text:      firstPathValue(payload, a.manifest.Response.TextPaths...),
		Reasoning: firstPathValue(payload, a.manifest.Response.ReasoningPaths...),
	}
	for _, path := range a.manifest.Response.ResultURLPaths {
		if value := firstPathValue(payload, path); value != "" {
			item := MediaReference{URL: value, Kind: a.manifest.Response.ResultKind}
			switch a.manifest.Response.ResultKind {
			case "image":
				result.Images = append(result.Images, item)
			case "audio":
				result.Audios = append(result.Audios, item)
			default:
				result.Videos = append(result.Videos, item)
			}
		}
	}
	if status == StatusPending && (result.Text != "" || len(result.Images) > 0 || len(result.Videos) > 0 || len(result.Audios) > 0) {
		status = StatusSucceeded
	}
	if result.Text == "" && result.Reasoning == "" && len(result.Images) == 0 && len(result.Videos) == 0 && len(result.Audios) == 0 {
		result = nil
	}
	return CreateResult{TaskID: id, Status: status, Result: result, Message: message}
}

func buildManifestOperation(operation ManifestOperation, request GenerationRequest, taskID string) RequestSpec {
	var body map[string]any
	if len(operation.Fields) > 0 {
		body = make(map[string]any, len(operation.Fields))
	}
	for key, expression := range operation.Fields {
		setMapPath(body, key, manifestExpressionValue(expression, request, taskID))
	}
	path := strings.ReplaceAll(operation.Path, "{{taskId}}", url.PathEscape(taskID))
	path = strings.ReplaceAll(path, "{{model}}", url.PathEscape(request.Model))
	return RequestSpec{Method: strings.ToUpper(operation.Method), Path: path, ContentType: defaultValue(operation.ContentType, "application/json"), Body: body}
}

func manifestExpressionValue(expression string, request GenerationRequest, taskID string) any {
	expression = strings.TrimSpace(expression)
	switch expression {
	case "request.model":
		return request.Model
	case "request.prompt":
		return request.Prompt
	case "request.images":
		return request.Images
	case "request.videos":
		return request.Videos
	case "request.audios":
		return request.Audios
	case "request.imageCount":
		return request.ImageCount
	case "request.duration":
		return request.Duration
	case "request.aspectRatio":
		return request.AspectRatio
	case "request.resolution":
		return request.Resolution
	case "request.quality":
		return request.Quality
	case "request.generateAudio":
		return request.GenerateAudio
	case "request.watermark":
		return request.Watermark
	case "request.operation":
		return request.Operation
	case "taskId":
		return taskID
	}
	if strings.HasPrefix(expression, "request.extra.") {
		return pathValue(request.Extra, strings.TrimPrefix(expression, "request.extra."))
	}
	return expression
}

func pathValue(payload map[string]any, path string) any {
	var value any = payload
	for _, part := range strings.Split(strings.Trim(path, "."), ".") {
		switch current := value.(type) {
		case map[string]any:
			value = current[part]
		case []any:
			index, err := strconv.Atoi(part)
			if err != nil || index < 0 || index >= len(current) {
				return nil
			}
			value = current[index]
		default:
			return nil
		}
	}
	return value
}

func arrayValue(value any) []any {
	items, _ := value.([]any)
	return items
}

func firstPathValue(payload map[string]any, paths ...string) string {
	for _, path := range paths {
		value := pathValue(payload, path)
		if text, ok := value.(string); ok && strings.TrimSpace(text) != "" {
			return strings.TrimSpace(text)
		}
	}
	return ""
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
