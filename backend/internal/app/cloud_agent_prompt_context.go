package app

import "encoding/json"

const (
	cloudAgentMaxToolCalls         = 8
	cloudAgentMaxOutputBytes       = 32000
	cloudAgentRuntimeContextMarker = "【运行状态】"
	cloudAgentContextSourceKey     = "agentContextSource"
)

type cloudAgentRuntimeContextKind string

const (
	cloudAgentContextPlan               cloudAgentRuntimeContextKind = "plan_state"
	cloudAgentContextPendingPlan        cloudAgentRuntimeContextKind = "pending_plan"
	cloudAgentContextEmptyOutput        cloudAgentRuntimeContextKind = "empty_output"
	cloudAgentContextInvalidOutput      cloudAgentRuntimeContextKind = "invalid_output"
	cloudAgentContextTruncatedArguments cloudAgentRuntimeContextKind = "truncated_tool_arguments"
)

// Only serializable fact fields belong here. Behavioral instructions live in
// prompts/agent-system-policy.md and share its version/hash contract.
type cloudAgentRuntimeContext struct {
	Source            string                       `json:"source"`
	Kind              cloudAgentRuntimeContextKind `json:"kind"`
	Items             []cloudAgentPlanItem         `json:"items,omitempty"`
	PendingTitle      string                       `json:"pendingTitle,omitempty"`
	LatestUserMessage string                       `json:"latestUserMessage,omitempty"`
	Detail            string                       `json:"detail,omitempty"`
	MaxToolCalls      int                          `json:"maxToolCalls,omitempty"`
	MaxOutputBytes    int                          `json:"maxOutputBytes,omitempty"`
}

func cloudAgentRuntimeMessage(context cloudAgentRuntimeContext) map[string]any {
	context.Source = "runtime"
	// The closed struct contains only strings, integers and serializable plan items.
	encoded, _ := json.Marshal(context)
	return map[string]any{
		"role": "user", "content": cloudAgentRuntimeContextMarker + string(encoded),
		cloudAgentContextSourceKey: "runtime",
	}
}

func cloudAgentLatestUserInstruction(messages []map[string]any) string {
	for i := len(messages) - 1; i >= 0; i-- {
		message := messages[i]
		source := stringField(message, cloudAgentContextSourceKey)
		if stringField(message, "role") == "user" && (source == "" || source == "user_interjection") {
			return stringField(message, "content")
		}
	}
	return ""
}
