package protocol

import (
	"encoding/json"
	"fmt"
)

// Capability is the kind of model operation handled by a protocol adapter.
type Capability string

const (
	CapabilityText  Capability = "text"
	CapabilityImage Capability = "image"
	CapabilityVideo Capability = "video"
	CapabilityAudio Capability = "audio"
)

// Surface describes where an installed protocol may be selected.
type Surface string

const (
	SurfaceAdminSystemChannel Surface = "admin.system-channel"
	SurfaceUserCustomChannel  Surface = "user.custom-channel"
	SurfaceCanvas             Surface = "canvas"
	SurfaceCreation           Surface = "creation"
	SurfaceAgent              Surface = "agent"
)

type Status string

const (
	StatusPending    Status = "pending"
	StatusProcessing Status = "processing"
	StatusSucceeded  Status = "succeeded"
	StatusFailed     Status = "failed"
	StatusCancelled  Status = "cancelled"
)

type MediaReference struct {
	URL       string `json:"url,omitempty"`
	DataURL   string `json:"dataUrl,omitempty"`
	Kind      string `json:"kind,omitempty"`
	Ephemeral bool   `json:"ephemeral,omitempty"`
}

// GenerationRequest is the platform contract shared by canvas, creation and agent.
// Provider-specific fields belong in Extra and are never interpreted by the host.
type GenerationRequest struct {
	Model         string           `json:"model"`
	Prompt        string           `json:"prompt,omitempty"`
	Images        []MediaReference `json:"images,omitempty"`
	Videos        []MediaReference `json:"videos,omitempty"`
	Audios        []MediaReference `json:"audios,omitempty"`
	Duration      int              `json:"duration,omitempty"`
	AspectRatio   string           `json:"aspectRatio,omitempty"`
	Resolution    string           `json:"resolution,omitempty"`
	Quality       string           `json:"quality,omitempty"`
	GenerateAudio bool             `json:"generateAudio,omitempty"`
	Watermark     bool             `json:"watermark,omitempty"`
	ImageCount    int              `json:"imageCount,omitempty"`
	Operation     string           `json:"operation,omitempty"`
	Extra         map[string]any   `json:"extra,omitempty"`
}

type RequestContext struct {
	BaseURL string
	Request GenerationRequest
}

type PollContext struct {
	BaseURL  string
	Model    string
	Request  GenerationRequest
	TaskID   string
	Metadata map[string]any
}

type RequestSpec struct {
	Method      string            `json:"method"`
	Path        string            `json:"path"`
	ContentType string            `json:"contentType"`
	Headers     map[string]string `json:"headers,omitempty"`
	Body        any               `json:"body,omitempty"`
}

type CreateResult struct {
	TaskID  string  `json:"taskId,omitempty"`
	Status  Status  `json:"status"`
	Result  *Result `json:"result,omitempty"`
	Message string  `json:"message,omitempty"`
}

type PollResult struct {
	TaskID  string  `json:"taskId,omitempty"`
	Status  Status  `json:"status"`
	Result  *Result `json:"result,omitempty"`
	Message string  `json:"message,omitempty"`
}

type Result struct {
	Images    []MediaReference `json:"images,omitempty"`
	Videos    []MediaReference `json:"videos,omitempty"`
	Audios    []MediaReference `json:"audios,omitempty"`
	Text      string           `json:"text,omitempty"`
	Reasoning string           `json:"reasoning,omitempty"`
	Usage     map[string]any   `json:"usage,omitempty"`
}

type Parameter struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Required    bool     `json:"required,omitempty"`
	Description string   `json:"description,omitempty"`
	Values      []string `json:"values,omitempty"`
	Mapping     string   `json:"mapping,omitempty"`
}

type Metadata struct {
	ID                      string       `json:"id"`
	Version                 string       `json:"version"`
	Name                    string       `json:"name"`
	Vendor                  string       `json:"vendor"`
	Description             string       `json:"description,omitempty"`
	Categories              []Capability `json:"categories"`
	Scopes                  []Surface    `json:"scopes"`
	Parameters              []Parameter  `json:"parameters,omitempty"`
	Create                  string       `json:"-"`
	Poll                    string       `json:"-"`
	Cancel                  string       `json:"-"`
	ContentType             string       `json:"-"`
	Documentation           string       `json:"documentation,omitempty"`
	LegacyAliases           []string     `json:"-"`
	Enabled                 bool         `json:"enabled"`
	Installable             bool         `json:"installable"`
	Execution               string       `json:"-"`
	RequiresPublicMediaURLs bool         `json:"-"`
	UnavailableReason       string       `json:"-"`
}

// Manifest is the single plugin contract. A plugin may contribute providers,
// workflows, canvas nodes and other capabilities from the same package; the
// runtime chooses an execution engine per contribution without changing the
// public manifest shape.
type Manifest struct {
	APIVersion    string                `json:"apiVersion"`
	Metadata      Metadata              `json:"-"`
	Entry         string                `json:"entry,omitempty"`
	Surfaces      []string              `json:"surfaces,omitempty"`
	Runtime       ManifestRuntime       `json:"runtime,omitempty"`
	Permissions   []string              `json:"permissions,omitempty"`
	Configuration ManifestConfiguration `json:"configuration,omitempty"`
	Contributes   ManifestContributions `json:"contributes"`
	// These fields are the normalized provider projection used by the runtime.
	// They are never serialized; provider execution is described only under
	// contributes.providers.
	Create        ManifestOperation      `json:"-"`
	Agent         *ManifestOperation     `json:"-"`
	Poll          *ManifestOperation     `json:"-"`
	Cancel        *ManifestOperation     `json:"-"`
	Response      ManifestResponse       `json:"-"`
	AgentResponse *ManifestAgentResponse `json:"-"`
}

// Manifest JSON is the public plugin contract. Metadata is an internal
// execution projection and is deliberately not a second wire format.
func (m Manifest) MarshalJSON() ([]byte, error) {
	type wire struct {
		APIVersion    string                `json:"apiVersion"`
		ID            string                `json:"id"`
		Name          string                `json:"name"`
		Version       string                `json:"version"`
		Author        string                `json:"author,omitempty"`
		Description   string                `json:"description,omitempty"`
		Documentation string                `json:"documentation,omitempty"`
		Entry         string                `json:"entry,omitempty"`
		Surfaces      []string              `json:"surfaces,omitempty"`
		Enabled       bool                  `json:"enabled"`
		Installable   bool                  `json:"installable,omitempty"`
		Runtime       ManifestRuntime       `json:"runtime,omitempty"`
		Permissions   []string              `json:"permissions,omitempty"`
		Configuration ManifestConfiguration `json:"configuration,omitempty"`
		Contributes   ManifestContributions `json:"contributes"`
	}
	return json.Marshal(wire{APIVersion: m.APIVersion, ID: m.Metadata.ID, Name: m.Metadata.Name, Version: m.Metadata.Version, Author: m.Metadata.Vendor, Description: m.Metadata.Description, Documentation: m.Metadata.Documentation, Entry: m.Entry, Surfaces: m.Surfaces, Enabled: m.Metadata.Enabled, Installable: m.Metadata.Installable, Runtime: m.Runtime, Permissions: m.Permissions, Configuration: m.Configuration, Contributes: m.Contributes})
}

func (m *Manifest) UnmarshalJSON(data []byte) error {
	type wire struct {
		APIVersion    string                `json:"apiVersion"`
		ID            string                `json:"id"`
		Name          string                `json:"name"`
		Version       string                `json:"version"`
		Author        string                `json:"author"`
		Description   string                `json:"description"`
		Documentation string                `json:"documentation"`
		Entry         string                `json:"entry"`
		Surfaces      []string              `json:"surfaces"`
		Enabled       *bool                 `json:"enabled"`
		Installable   bool                  `json:"installable"`
		Runtime       ManifestRuntime       `json:"runtime"`
		Permissions   []string              `json:"permissions"`
		Configuration ManifestConfiguration `json:"configuration"`
		Contributes   ManifestContributions `json:"contributes"`
	}
	var value wire
	if err := json.Unmarshal(data, &value); err != nil {
		return err
	}
	enabled := true
	if value.Enabled != nil {
		enabled = *value.Enabled
	}
	m.APIVersion, m.Entry, m.Surfaces, m.Runtime, m.Permissions, m.Configuration, m.Contributes = value.APIVersion, value.Entry, value.Surfaces, value.Runtime, value.Permissions, value.Configuration, value.Contributes
	m.Metadata = Metadata{ID: value.ID, Name: value.Name, Version: value.Version, Vendor: value.Author, Description: value.Description, Documentation: value.Documentation, Enabled: enabled, Installable: value.Installable}
	return nil
}

type ManifestRuntime struct {
	Backend string `json:"backend,omitempty"`
	Web     string `json:"web,omitempty"`
}

type ManifestConfiguration struct {
	Fields []ManifestField `json:"fields,omitempty"`
}

type ManifestField struct {
	Name        string   `json:"name"`
	Type        string   `json:"type"`
	Label       string   `json:"label,omitempty"`
	Required    bool     `json:"required,omitempty"`
	Default     any      `json:"default,omitempty"`
	Description string   `json:"description,omitempty"`
	Values      []string `json:"values,omitempty"`
}

type ManifestContributions struct {
	Providers      []ManifestProvider   `json:"providers,omitempty"`
	Workflows      []ManifestWorkflow   `json:"workflows,omitempty"`
	CanvasNodes    []ManifestCanvasNode `json:"canvasNodes,omitempty"`
	Transforms     []ManifestTransform  `json:"transforms,omitempty"`
	Commands       []ManifestCommand    `json:"commands,omitempty"`
	AssetSources   []string             `json:"assetSources,omitempty"`
	UsageObservers []string             `json:"usageObservers,omitempty"`
	AICapabilities []string             `json:"aiCapabilities,omitempty"`
	Agents         []string             `json:"agents,omitempty"`
	ImportExport   []string             `json:"importExport,omitempty"`
}

type ManifestProvider struct {
	ID                      string                 `json:"id"`
	Label                   string                 `json:"label"`
	Capabilities            []Capability           `json:"capabilities"`
	Scopes                  []Surface              `json:"scopes"`
	BaseURL                 string                 `json:"baseUrl,omitempty"`
	RequiresPublicMediaURLs bool                   `json:"requiresPublicMediaUrls,omitempty"`
	Auth                    ManifestAuth           `json:"auth,omitempty"`
	Parameters              []Parameter            `json:"parameters,omitempty"`
	Create                  ManifestOperation      `json:"create"`
	Agent                   *ManifestOperation     `json:"agent,omitempty"`
	Poll                    *ManifestOperation     `json:"poll,omitempty"`
	Cancel                  *ManifestOperation     `json:"cancel,omitempty"`
	Response                ManifestResponse       `json:"response"`
	AgentResponse           *ManifestAgentResponse `json:"agentResponse,omitempty"`
}

type ManifestAuth struct {
	Type   string `json:"type"`
	Field  string `json:"field"`
	Header string `json:"header,omitempty"`
}

type ManifestWorkflow struct {
	ID         string         `json:"id"`
	Label      string         `json:"label"`
	ProviderID string         `json:"providerId"`
	Capability Capability     `json:"capability"`
	Parameters []Parameter    `json:"parameters"`
	Defaults   map[string]any `json:"defaults,omitempty"`
}

type ManifestCanvasNode struct {
	ID           string         `json:"id"`
	Label        string         `json:"label"`
	DefaultTitle string         `json:"defaultTitle"`
	DefaultSize  map[string]int `json:"defaultSize"`
	Schema       map[string]any `json:"schema"`
	Renderer     string         `json:"renderer"`
}

type ManifestTransform struct {
	ID      string `json:"id"`
	Input   string `json:"input"`
	Output  string `json:"output"`
	Runtime string `json:"runtime"`
}

type ManifestCommand struct {
	ID    string `json:"id"`
	Label string `json:"label"`
}

func (r RequestSpec) Validate() error {
	if r.Method == "" || r.Path == "" {
		return fmt.Errorf("protocol request spec is incomplete")
	}
	return nil
}
