// 画布 Agent 的画布写操作：把工具参数转换成画布操作（增删节点、连线）并校验。
//
// 连线必须满足节点类型的输入约束（validateCloudAgentConnection），不合法的连线
// 直接拒绝并返回可读原因，由模型自行修正。

package app

import (
	"fmt"
	"strings"
	"unicode"
	"unicode/utf8"

	"infinite-canvas/backend/internal/repository"
)

func cloudAgentSkillPage(version, path, content string, offset int) (any, error) {
	runes := []rune(content)
	if offset < 0 || offset > len(runes) {
		return nil, BadAuthRequest("技能读取偏移超出文件范围")
	}
	end := offset + min(12000, len(runes)-offset)
	return map[string]any{"version": version, "path": path, "content": string(runes[offset:end]), "offset": offset, "nextOffset": end, "hasMore": end < len(runes)}, nil
}

func validateCloudAgentID(value, label string, maxRunes int) error {
	if value == "" || strings.TrimSpace(value) != value || !utf8.ValidString(value) {
		return BadAuthRequest(label + "不能为空、不能包含首尾空白或无效字符")
	}
	if utf8.RuneCountInString(value) > maxRunes {
		return BadAuthRequest(fmt.Sprintf("%s不能超过 %d 个字符", label, maxRunes))
	}
	for _, r := range value {
		if unicode.IsControl(r) {
			return BadAuthRequest(label + "不能包含控制字符")
		}
	}
	return nil
}

type agentCanvasArgs struct {
	SnapshotHash string          `json:"snapshotHash"`
	Ops          []agentCanvasOp `json:"ops"`
}

type agentCanvasOp struct {
	Type     string         `json:"type"`
	ID       string         `json:"id"`
	NodeType string         `json:"nodeType"`
	Title    *string        `json:"title"`
	Content  *string        `json:"content"`
	Patch    map[string]any `json:"patch"`
	// X/Y 为指针：nil 表示模型没有指定坐标，服务端按画布内容自动落位（不再落到原点重叠）。
	// 指针语义与 canvas/capability/builtin.go 的 positionPatchFields 一致（坐标是可选的数字）。
	X          *float64 `json:"x"`
	Y          *float64 `json:"y"`
	FromNodeID string   `json:"fromNodeId"`
	ToNodeID   string   `json:"toNodeId"`
}

// Explicit node creation and edges only; no generic metadata, media URL or deletion.
func applyCloudAgentCanvas(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentCanvasMutation(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	if err = saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{
			UserID:             userID,
			CanvasID:           canvasID,
			StepID:             call.ID,
			Operation:          "canvas_apply_ops",
			BeforeSnapshotHash: plan.BeforeSnapshotHash,
			AfterSnapshotHash:  cloudAgentCanvasHash(plan.Document),
			BeforeJSON:         plan.BeforeJSON,
			Preview:            &plan.Preview,
		}); err != nil {
			return nil, err
		}
	}
	return map[string]any{"canvasId": canvasID, "snapshotHash": cloudAgentCanvasHash(plan.Document), "summary": fmt.Sprintf("已完成 %d 项节点/连线操作", len(plan.Args.Ops)), "preview": plan.Preview}, nil
}

func validateCloudAgentConnection(nodes []map[string]any, fromID, toID string, existingConnections ...[]map[string]any) error {
	if err := validateCloudAgentID(fromID, "来源节点 ID", 80); err != nil {
		return err
	}
	if err := validateCloudAgentID(toID, "目标节点 ID", 80); err != nil {
		return err
	}
	if fromID == toID {
		return BadAuthRequest("连线不能指向自身")
	}
	var from, to map[string]any
	for _, node := range nodes {
		if stringValue(node["id"]) == fromID {
			from = node
		}
		if stringValue(node["id"]) == toID {
			to = node
		}
	}
	if from == nil || to == nil {
		return BadAuthRequest("连线端点不存在")
	}
	fromCapability, fromKnown := cloudAgentNodeCapabilityForType(stringValue(from["type"]))
	toCapability, toKnown := cloudAgentNodeCapabilityForType(stringValue(to["type"]))
	if !fromKnown || !toKnown {
		return BadAuthRequest("连线包含当前 Agent 不支持的节点类型")
	}
	fromKind := fromCapability.InputKind
	if fromKind == "" || !fromCapability.Connection.CanSource {
		return BadAuthRequest(fmt.Sprintf("来源节点类型 %s 不能作为生成输入；引用连线不能用于普通节点关联", fromCapability.Type))
	}
	if !toCapability.Connection.CanTarget {
		return BadAuthRequest(fmt.Sprintf("目标节点类型 %s 不能接收生成输入；无需为文档归档建立引用连线", toCapability.Type))
	}
	connections := []map[string]any{}
	if len(existingConnections) > 0 {
		connections = existingConnections[0]
	}
	for _, edge := range connections {
		if stringValue(edge["toNodeId"]) == toID && stringValue(edge["fromNodeId"]) == fromID {
			return BadAuthRequest("连线重复")
		}
	}
	if err := toCapability.ValidateConnection(fromKind); err != nil {
		return BadAuthRequest(err.Error())
	}
	if maxInputs := toCapability.Connection.MaxInputCount; maxInputs > 0 {
		inputIDs := map[string]bool{}
		for _, edge := range connections {
			if stringValue(edge["toNodeId"]) == toID {
				inputIDs[stringValue(edge["fromNodeId"])] = true
			}
		}
		inputIDs[fromID] = true
		if len(inputIDs) > maxInputs {
			return BadAuthRequest(fmt.Sprintf("%s最多连接 %d 个输入", toCapability.Label, maxInputs))
		}
	}
	return nil
}

func cloudAgentInputKindLabel(kind string) string {
	switch kind {
	case "image":
		return "图片"
	case "video":
		return "视频"
	case "audio":
		return "音频"
	default:
		return "文本"
	}
}

func creationMaps(value any) []map[string]any {
	result := []map[string]any{}
	switch items := value.(type) {
	case []any:
		for _, v := range items {
			if m, ok := v.(map[string]any); ok {
				result = append(result, m)
			}
		}
	case []map[string]any:
		result = items
	}
	return result
}

// Only server-registered canvas capabilities are exposed to the model. UI-only
// renderers are not a persistence or authorization contract.
func cloudAgentNodeTypes() map[string]any {
	types := make([]map[string]any, 0, len(canvasCapabilityRegistry.List()))
	for _, capability := range canvasCapabilityRegistry.List() {
		item := map[string]any{
			"type":        capability.Type,
			"label":       capability.Label,
			"purpose":     capability.Purpose,
			"defaultSize": map[string]any{"width": capability.DefaultWidth, "height": capability.DefaultHeight},
			"canUpdate":   capability.CanUpdate,
		}
		if len(capability.GoodFor) > 0 {
			item["goodFor"] = capability.GoodFor
		}
		if len(capability.NotIdealFor) > 0 {
			item["notIdealFor"] = capability.NotIdealFor
		}
		if len(capability.Tradeoffs) > 0 {
			item["tradeoffs"] = capability.Tradeoffs
		}
		if len(capability.Actions) > 0 {
			item["actions"] = capability.Actions
		}
		if capability.CanUpdate {
			fields := map[string]any{}
			for key, field := range capability.PatchFields {
				definition := map[string]any{"type": field.Kind, "label": field.Label, "displayOrder": field.Order, "maxCharacters": field.MaxRunes}
				if field.Description != "" {
					definition["description"] = field.Description
				}
				fields[key] = definition
			}
			item["updateFields"] = fields
		}
		if capability.InputKind != "" {
			item["inputKind"] = capability.InputKind
		}
		if capability.GenerationMode != "" && cloudAgentGenerationModeSupported(capability.GenerationMode) {
			item["generationMode"] = capability.GenerationMode
		}
		if len(capability.Connection.AcceptedInputKinds) > 0 {
			item["acceptedInputKinds"] = capability.Connection.AcceptedInputKinds
		}
		if len(capability.Connection.RejectedInputKinds) > 0 {
			item["rejectedInputKinds"] = capability.Connection.RejectedInputKinds
		}
		if capability.Connection.MaxInputCount > 0 {
			item["maxInputCount"] = capability.Connection.MaxInputCount
		}
		item["canSource"] = capability.Connection.CanSource
		item["canTarget"] = capability.Connection.CanTarget
		item["canReference"] = capability.Connection.CanReference
		types = append(types, item)
	}
	return map[string]any{"schemaVersion": 2, "nodes": types, "selectionGuide": []string{
		"单个画面、一次性提示词或快速试验通常使用文本/Markdown与媒体节点更轻量。",
		"多镜头、连续性、逐镜审查、逐镜生成或需要后续维护时，分镜脚本通常更合适。",
		"媒体节点只承载单个生成目标，不替代多镜头结构；选择媒体节点后还要用 model_list 按生成模式和本次真实参考节点筛选模型。",
		"节点选择由Agent结合用户目标决定；不要为了形式创建复杂节点，也不要用普通文本伪装成结构化分镜。",
	}}
}
