package protocol

import "fmt"

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
	URL     string `json:"url,omitempty"`
	DataURL string `json:"dataUrl,omitempty"`
	Kind    string `json:"kind,omitempty"`
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
	ID                string       `json:"id"`
	Version           string       `json:"version"`
	Name              string       `json:"name"`
	Vendor            string       `json:"vendor"`
	Description       string       `json:"description,omitempty"`
	Categories        []Capability `json:"categories"`
	Scopes            []Surface    `json:"scopes"`
	Parameters        []Parameter  `json:"parameters,omitempty"`
	Create            string       `json:"create,omitempty"`
	Poll              string       `json:"poll,omitempty"`
	Cancel            string       `json:"cancel,omitempty"`
	ContentType       string       `json:"contentType,omitempty"`
	Documentation     string       `json:"documentation,omitempty"`
	LegacyAliases     []string     `json:"legacyAliases,omitempty"`
	Enabled           bool         `json:"enabled"`
	Installable       bool         `json:"installable"`
	Execution         string       `json:"execution,omitempty"`
	UnavailableReason string       `json:"unavailableReason,omitempty"`
}

func (r RequestSpec) Validate() error {
	if r.Method == "" || r.Path == "" {
		return fmt.Errorf("protocol request spec is incomplete")
	}
	return nil
}
