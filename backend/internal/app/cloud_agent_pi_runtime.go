package app

import (
	"context"

	agentruntime "infinite-canvas/backend/internal/agent/runtime"
)

// These aliases keep the app coordinator's request shape stable while the
// process lifecycle and loopback bridge live in internal/agent/runtime.
type cloudAgentPiBridge = agentruntime.Bridge

type cloudAgentPiProcessRequest struct {
	BridgeURL     string           `json:"bridgeURL"`
	BridgeToken   string           `json:"bridgeToken"`
	SessionFile   string           `json:"sessionFile,omitempty"`
	SessionJSONL  string           `json:"sessionJSONL,omitempty"`
	SessionDir    string           `json:"sessionDir,omitempty"`
	SessionId     string           `json:"sessionId,omitempty"`
	UserId        string           `json:"userId,omitempty"`
	CanvasId      string           `json:"canvasId,omitempty"`
	RunId         string           `json:"runId,omitempty"`
	Cwd           string           `json:"cwd"`
	AgentDir      string           `json:"agentDir"`
	Prompt        string           `json:"prompt"`
	SystemPrompt  string           `json:"systemPrompt"`
	SkillPaths    []string         `json:"skillPaths,omitempty"`
	EnabledSkills []map[string]any `json:"enabledSkills,omitempty"`
	Profile       map[string]any   `json:"profile,omitempty"`
	Memory        map[string]any   `json:"memory,omitempty"`
	Canvas        map[string]any   `json:"canvas,omitempty"`
	Features      map[string]any   `json:"features,omitempty"`
	Tools         []map[string]any `json:"tools"`
	Compaction    map[string]any   `json:"compaction,omitempty"`
	Permissions   map[string]any   `json:"permissions,omitempty"`
	Model         map[string]any   `json:"model"`
}

func runCloudAgentPi(ctx context.Context, request cloudAgentPiProcessRequest, bridge cloudAgentPiBridge) error {
	return agentruntime.Run(ctx, agentruntime.ProcessRequest{
		BridgeURL: request.BridgeURL, BridgeToken: request.BridgeToken,
		SessionFile: request.SessionFile, SessionJSONL: request.SessionJSONL, SessionDir: request.SessionDir,
		SessionID: request.SessionId, UserID: request.UserId, CanvasID: request.CanvasId, RunID: request.RunId,
		CWD: request.Cwd, AgentDir: request.AgentDir, Prompt: request.Prompt, SystemPrompt: request.SystemPrompt,
		SkillPaths: request.SkillPaths, EnabledSkills: request.EnabledSkills, Profile: request.Profile,
		Memory: request.Memory, Canvas: request.Canvas, Features: request.Features, Tools: request.Tools,
		Compaction: request.Compaction, Permissions: request.Permissions, Model: request.Model,
	}, agentruntime.Bridge(bridge))
}
