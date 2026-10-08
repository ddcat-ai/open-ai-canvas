package app

import (
	"context"
	"os"
	"strings"

	agentruntime "infinite-canvas/backend/internal/agent/runtime"
	"infinite-canvas/backend/internal/agent/yingceagent"
)

// These aliases keep the app coordinator's request shape stable while the
// process lifecycle and loopback bridge live in internal/agent/runtime.
type cloudAgentPiBridge = agentruntime.Bridge

type cloudAgentPiProcessRequest struct {
	BridgeURL     string           `json:"bridgeURL"`
	BridgeToken   string           `json:"bridgeToken"`
	SessionJSONL  string           `json:"sessionJSONL,omitempty"`
	SessionId     string           `json:"sessionId,omitempty"`
	UserId        string           `json:"userId,omitempty"`
	CanvasId      string           `json:"canvasId,omitempty"`
	RunId         string           `json:"runId,omitempty"`
	Prompt        string           `json:"prompt"`
	SystemPrompt  string           `json:"systemPrompt"`
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
	runtimeRequest := agentruntime.ProcessRequest{
		BridgeURL: request.BridgeURL, BridgeToken: request.BridgeToken,
		SessionJSONL: request.SessionJSONL,
		SessionID:    request.SessionId, UserID: request.UserId, CanvasID: request.CanvasId, RunID: request.RunId,
		Prompt: request.Prompt, SystemPrompt: request.SystemPrompt,
		EnabledSkills: request.EnabledSkills, Profile: request.Profile,
		Memory: request.Memory, Canvas: request.Canvas, Features: request.Features, Tools: request.Tools,
		Compaction: request.Compaction, Permissions: request.Permissions, Model: request.Model,
	}
	if endpoint := strings.TrimSpace(os.Getenv("YINGCE_AGENT_URL")); endpoint != "" {
		return yingceagent.Run(ctx, endpoint, os.Getenv("YINGCE_AGENT_TOKEN"), os.Getenv("YINGCE_AGENT_BRIDGE_HOST"), runtimeRequest, agentruntime.Bridge(bridge))
	}
	return agentruntime.Run(ctx, runtimeRequest, agentruntime.Bridge(bridge))
}
