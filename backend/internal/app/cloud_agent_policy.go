package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/prompts"
)

const (
	cloudAgentCompilerVersion  = "cloud-agent-policy-compiler/v6"
	cloudAgentDefaultReasoning = "off"
)

type cloudAgentPolicySnapshot struct {
	SystemPolicyID       string `json:"systemPolicyId"`
	SystemPolicyVersion  int    `json:"systemPolicyVersion"`
	SystemPolicyHash     string `json:"systemPolicyHash"`
	MediaPolicyID        string `json:"mediaPolicyId"`
	MediaPolicyVersion   int    `json:"mediaPolicyVersion"`
	MediaPolicyHash      string `json:"mediaPolicyHash"`
	CapabilitySetVersion string `json:"capabilitySetVersion"`
	CapabilitySetHash    string `json:"capabilitySetHash"`
	ReasoningMode        string `json:"reasoningMode"`
	CompilerVersion      string `json:"compilerVersion"`
	ProfileRevision      string `json:"profileRevision,omitempty"`
	ProfileHash          string `json:"profileHash,omitempty"`
}

type cloudAgentProfileSnapshot struct {
	Revision string              `json:"revision"`
	Hash     string              `json:"hash"`
	Layers   []AgentProfileLayer `json:"layers"`
}

func cloudAgentReasoningMode(req CloudAgentRequest) string {
	mode := strings.ToLower(strings.TrimSpace(req.ReasoningMode))
	if mode == "off" || mode == "auto" || mode == "deep" {
		return mode
	}
	return cloudAgentDefaultReasoning
}

func cloudAgentReasoningEnabled(mode string) bool { return mode == "auto" || mode == "deep" }

func cloudAgentCapabilityGuide() string {
	var b strings.Builder
	b.WriteString("节点能力速查（由服务端能力注册表生成，只用于自主路由，不是工具授权）：\n")
	for _, descriptor := range canvasCapabilityRegistry.List() {
		b.WriteString("- ")
		b.WriteString(descriptor.Label)
		b.WriteString("（")
		b.WriteString(descriptor.Type)
		b.WriteString("）：")
		b.WriteString(descriptor.Purpose)
		if variant := descriptor.Variant; variant != nil {
			fmt.Fprintf(&b, " 画布识别：type=%s 且 workflowKind=%s，读取结果 kind=%s；不能用 add_node 新建。", variant.BaseType, variant.WorkflowKind, descriptor.Type)
		}
		if len(descriptor.GoodFor) > 0 {
			b.WriteString(" 适合：")
			b.WriteString(strings.Join(descriptor.GoodFor, "、"))
			b.WriteString("。")
		}
		if len(descriptor.NotIdealFor) > 0 {
			b.WriteString(" 不适合：")
			b.WriteString(strings.Join(descriptor.NotIdealFor, "、"))
			b.WriteString("。")
		}
		if len(descriptor.Tradeoffs) > 0 {
			b.WriteString(" 维护取舍：")
			b.WriteString(strings.Join(descriptor.Tradeoffs, "；"))
			b.WriteString("。")
		}
		connection, _ := json.Marshal(map[string]any{
			"inputKind": descriptor.InputKind, "canSource": descriptor.Connection.CanSource,
			"canTarget": descriptor.Connection.CanTarget, "canReference": descriptor.Connection.CanReference,
			"acceptedInputKinds": descriptor.Connection.AcceptedInputKinds,
			"rejectedInputKinds": descriptor.Connection.RejectedInputKinds,
			"maxInputCount":      descriptor.Connection.MaxInputCount,
		})
		b.WriteString(" 连线能力：")
		b.Write(connection)
		b.WriteString("\n")
	}
	return b.String()
}

// compileCloudAgentPolicies 编译稳定 system：行为合同 + 能力速查 + 本轮执行事实 + 已安装技能目录。
// 技能目录只含名称、短简介和 skillId（有预算），正文由 skill_read_file 按需读取；skillCatalog 为 nil
// 表示本轮不发布目录（隔离的合同测试）。
func compileCloudAgentPolicies(req CloudAgentRequest, agentName string, skillCatalog *cloudAgentSkillCatalog, canvasSummary string, profile cloudAgentProfileSnapshot, anchors ...cloudAgentCreativeAnchor) (string, cloudAgentPolicySnapshot, error) {
	system, media, err := prompts.LoadAgentPolicies()
	if err != nil {
		return "", cloudAgentPolicySnapshot{}, err
	}
	mode := cloudAgentReasoningMode(req)
	capabilityHash := cloudAgentCapabilitySetHash()
	snapshot := cloudAgentPolicySnapshot{
		SystemPolicyID: system.ID, SystemPolicyVersion: system.Version, SystemPolicyHash: system.Hash,
		MediaPolicyID: media.ID, MediaPolicyVersion: media.Version, MediaPolicyHash: media.Hash,
		CapabilitySetVersion: cloudAgentCapabilitySetVersion, CapabilitySetHash: capabilityHash,
		ReasoningMode: mode, CompilerVersion: cloudAgentCompilerVersion,
		ProfileRevision: profile.Revision, ProfileHash: profile.Hash,
	}
	var b strings.Builder
	b.WriteString(system.Text)
	b.WriteString("\n\n")
	b.WriteString(cloudAgentCapabilityGuide())
	// Behavior belongs to versioned policies; the compiler only projects facts.
	context := map[string]any{
		"source": "server_snapshot", "permissionMode": req.PermissionMode,
		"agentIdentity": map[string]string{"name": firstNonEmpty(strings.TrimSpace(agentName), defaultCanvasAppearance().AgentName)},
		"reasoningMode": mode,
		"budget": map[string]any{
			"maxCredits": req.Budget.MaxCredits, "maxSteps": cloudAgentStepLimit(req),
			"maxGenerationTasks": req.Budget.MaxGenerationTasks, "maxVideoSeconds": req.Budget.MaxVideoSeconds,
		},
		"maxToolCalls": cloudAgentMaxToolCalls, "maxOutputBytes": cloudAgentMaxOutputBytes,
	}
	if strings.TrimSpace(canvasSummary) != "" {
		// Callers may provide a catalog for policy-contract tests or other
		// isolated compilation paths. The production run path deliberately
		// passes an empty value and places the catalog in canonical messages so
		// the stable system prefix remains cacheable.
		context["canvasSummary"] = canvasSummary
	}
	if len(anchors) > 0 {
		// User intent remains in user messages, never frozen into system context.
		context["referenceCandidates"] = anchors[0].ReferenceAssets
	}
	if skillCatalog != nil {
		context["skillCatalog"] = map[string]int{"installed": skillCatalog.Installed, "described": skillCatalog.Described, "namesOnly": skillCatalog.NamesOnly, "omitted": skillCatalog.Omitted}
	}
	layers := make([]map[string]any, 0, len(profile.Layers))
	for _, layer := range profile.Layers {
		layers = append(layers, map[string]any{"scope": layer.Scope, "revision": layer.Revision, "hash": layer.Hash, "characters": utf8.RuneCountInString(layer.Content)})
	}
	context["profileLayers"] = layers
	encoded, err := json.Marshal(context)
	if err != nil {
		return "", cloudAgentPolicySnapshot{}, fmt.Errorf("encode Agent execution context: %w", err)
	}
	b.WriteString("\n\n本轮执行上下文：\n")
	b.Write(encoded)
	if skillCatalog != nil && strings.TrimSpace(skillCatalog.Text) != "" {
		b.WriteString("\n\n")
		b.WriteString(skillCatalog.Text)
	}
	text := strings.TrimSpace(b.String())
	if text == "" {
		return "", cloudAgentPolicySnapshot{}, fmt.Errorf("compiled Agent policy is empty")
	}
	return text, snapshot, nil
}
