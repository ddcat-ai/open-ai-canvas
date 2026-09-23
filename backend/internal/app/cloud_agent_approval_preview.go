package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/canvas/capability"
	"infinite-canvas/backend/internal/canvas/layout"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// cloudAgentApprovalPreview is server-authored explanatory data. It never
// grants capabilities: execution still validates the original call, snapshot,
// ownership, node registry, locks and budget after approval.
type cloudAgentApprovalPreview struct {
	Kind        string                          `json:"kind"`
	Title       string                          `json:"title"`
	Description string                          `json:"description"`
	Items       []cloudAgentApprovalPreviewItem `json:"items"`
}

type cloudAgentApprovalPreviewItem struct {
	Operation       string   `json:"operation"`
	NodeID          string   `json:"nodeId,omitempty"`
	NodeTitle       string   `json:"nodeTitle,omitempty"`
	ResultTitle     string   `json:"resultTitle,omitempty"`
	NodeType        string   `json:"nodeType,omitempty"`
	NodeTypeLabel   string   `json:"nodeTypeLabel,omitempty"`
	TargetNodeID    string   `json:"targetNodeId,omitempty"`
	TargetNodeTitle string   `json:"targetNodeTitle,omitempty"`
	TargetNodeType  string   `json:"targetNodeType,omitempty"`
	Fields          []string `json:"fields,omitempty"`
	Details         []string `json:"details,omitempty"`
	Summary         string   `json:"summary"`
}

type cloudAgentCanvasMutationPlan struct {
	Args               agentCanvasArgs
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	Preview            cloudAgentApprovalPreview
}

// prepareCloudAgentCanvasMutation is the single dry-run and execution planner.
// Approval previews and the eventual write therefore share the exact same
// parser, snapshot check and capability validation instead of drifting apart.
func prepareCloudAgentCanvasMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentCanvasMutationPlan, error) {
	args, err := decodeCloudAgentCanvasArgs(call.Function.Arguments)
	if err != nil {
		return nil, err
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if beforeHash != args.SnapshotHash {
		return nil, &cloudAgentFieldArgumentError{error: &cloudAgentArgumentError{creationConflict("画布已变化，本次未写入；请重新读取并重新申请审批")}, Field: "snapshotHash", Issue: "stale_snapshot"}
	}
	items, err := applyCloudAgentCanvasPlan(doc, args.Ops)
	if err != nil {
		return nil, err
	}
	return &cloudAgentCanvasMutationPlan{
		Args:               args,
		Canvas:             canvas,
		Document:           doc,
		BeforeJSON:         canvas.PayloadJSON,
		BeforeSnapshotHash: beforeHash,
		Preview:            cloudAgentCanvasApprovalPreview(items),
	}, nil
}

func applyCloudAgentCanvasPlan(doc map[string]any, ops []agentCanvasOp) ([]cloudAgentApprovalPreviewItem, error) {
	nodes := creationMaps(doc["nodes"])
	edges := creationMaps(doc["connections"])
	items := make([]cloudAgentApprovalPreviewItem, 0, len(ops))
	for opIndex, op := range ops {
		title, content := "", ""
		if op.Title != nil {
			title = *op.Title
		}
		if op.Content != nil {
			content = *op.Content
		}
		if err := validateCloudAgentID(op.ID, "节点或连线 ID", 80); err != nil {
			return nil, err
		}
		if op.Type == "add_node" && (utf8.RuneCountInString(content) > 16000 || utf8.RuneCountInString(title) > 240) {
			return nil, BadAuthRequest("节点标题或正文超出限制")
		}
		index := cloudAgentNodeIndex(nodes, op.ID)
		switch op.Type {
		case "add_node":
			if index >= 0 {
				return nil, BadAuthRequest("新增节点ID重复")
			}
			capability, ok := cloudAgentNodeCapabilityForType(op.NodeType)
			if strings.TrimSpace(op.NodeType) == "" {
				return nil, BadAuthRequest("新增节点缺少 nodeType")
			}
			if !ok {
				return nil, BadAuthRequest("不支持的节点类型")
			}
			x, y := op.X, op.Y
			if x == nil || y == nil {
				// 没有（完整）坐标时不落到原点：按泳道与依赖关系算一个空位，
				// 保证同一批新增的多个节点也不会互相重叠。模型只给了一个轴时保留它。
				pending := cloudAgentLayoutNodes(map[string]any{"nodes": nodes})
				var hint *layout.Position
				if x != nil || y != nil {
					hint = &layout.Position{}
					if x != nil {
						hint.X = *x
					}
					if y != nil {
						hint.Y = *y
					}
				}
				if slot, ok := cloudAgentArrangeAddNodePosition(doc, pending, op, ops, hint); ok {
					if x == nil {
						value := slot.X
						x = &value
					}
					if y == nil {
						value := slot.Y
						y = &value
					}
				}
			}
			node := creationAddedNode(CreationCanvasOp{Type: op.Type, ID: op.ID, NodeType: op.NodeType, Title: title, X: x, Y: y, Metadata: capability.Metadata(content)})
			nodes = append(nodes, node)
			nodeTitle := cloudAgentApprovalNodeTitle(node, capability.Label)
			items = append(items, cloudAgentApprovalPreviewItem{
				Operation: "add_node", NodeID: op.ID, NodeTitle: nodeTitle,
				NodeType: capability.Type, NodeTypeLabel: capability.Label,
				Summary: fmt.Sprintf("新增%s《%s》", capability.Label, nodeTitle),
			})
		case "connect_nodes":
			if err := validateCloudAgentID(op.FromNodeID, "来源节点 ID", 80); err != nil {
				return nil, err
			}
			if err := validateCloudAgentID(op.ToNodeID, "目标节点 ID", 80); err != nil {
				return nil, err
			}
			fromIndex, toIndex := cloudAgentNodeIndex(nodes, op.FromNodeID), cloudAgentNodeIndex(nodes, op.ToNodeID)
			if fromIndex < 0 || toIndex < 0 || op.FromNodeID == op.ToNodeID {
				return nil, BadAuthRequest("连线端点不存在或指向自身")
			}
			if err := validateCloudAgentConnection(nodes, op.FromNodeID, op.ToNodeID, edges); err != nil {
				return nil, cloudAgentFieldError(fmt.Sprintf("ops[%d]", opIndex), "invalid_connection", cloudAgentSafeToolError(err))
			}
			for _, edge := range edges {
				if stringValue(edge["id"]) == op.ID || (stringValue(edge["fromNodeId"]) == op.FromNodeID && stringValue(edge["toNodeId"]) == op.ToNodeID) {
					return nil, BadAuthRequest("连线重复")
				}
			}
			fromCapability, _ := cloudAgentNodeCapabilityForType(stringValue(nodes[fromIndex]["type"]))
			toCapability, _ := cloudAgentNodeCapabilityForType(stringValue(nodes[toIndex]["type"]))
			fromTitle := cloudAgentApprovalNodeTitle(nodes[fromIndex], fromCapability.Label)
			toTitle := cloudAgentApprovalNodeTitle(nodes[toIndex], toCapability.Label)
			edges = append(edges, map[string]any{"id": op.ID, "fromNodeId": op.FromNodeID, "toNodeId": op.ToNodeID})
			items = append(items, cloudAgentApprovalPreviewItem{
				Operation: "connect_nodes", NodeID: op.FromNodeID, NodeTitle: fromTitle,
				NodeType: fromCapability.Type, NodeTypeLabel: fromCapability.Label,
				TargetNodeID: op.ToNodeID, TargetNodeTitle: toTitle, TargetNodeType: toCapability.Type,
				Summary: fmt.Sprintf("建立《%s》→《%s》的引用连线", fromTitle, toTitle),
			})
		case "update_node":
			if len(op.Patch) == 0 {
				// 漏字段是模型照 schema 就能自己修好的参数错误：当成工具结果回给它重试，
				// 而不是判整轮失败（用户只在失败提示里看到一句"必须提供 patch"）。
				// 未知操作类型仍按准入失败终止（cloud_agent_test.go 有用例断言这一行为）。
				return nil, &cloudAgentArgumentError{BadAuthRequest("更新节点必须提供 patch")}
			}
			if index < 0 {
				return nil, BadAuthRequest("只能更新现有且受 Agent 支持的节点")
			}
			capability, ok := cloudAgentNodeCapabilityForType(stringValue(nodes[index]["type"]))
			if !ok || !capability.CanUpdate {
				return nil, BadAuthRequest("该节点类型不支持 Agent 更新")
			}
			metadata, _ := nodes[index]["metadata"].(map[string]any)
			if metadata["locked"] == true {
				return nil, BadAuthRequest("不能修改锁定节点")
			}
			beforeTitle := cloudAgentApprovalNodeTitle(nodes[index], capability.Label)
			fields := cloudAgentApprovalPatchLabels(capability.PatchFields, op.Patch)
			if err := capability.ApplyPatch(nodes[index], op.Patch); err != nil {
				return nil, BadAuthRequest(err.Error())
			}
			afterTitle := cloudAgentApprovalNodeTitle(nodes[index], capability.Label)
			resultTitle := ""
			if afterTitle != beforeTitle {
				resultTitle = afterTitle
			}
			items = append(items, cloudAgentApprovalPreviewItem{
				Operation: "update_node", NodeID: op.ID, NodeTitle: beforeTitle, ResultTitle: resultTitle,
				NodeType: capability.Type, NodeTypeLabel: capability.Label, Fields: fields,
				Summary: fmt.Sprintf("修改%s《%s》的%s", capability.Label, beforeTitle, strings.Join(fields, "、")),
			})
		default:
			return nil, BadAuthRequest("不支持的画布写操作")
		}
	}
	doc["nodes"] = nodes
	doc["connections"] = edges
	return items, nil
}

func cloudAgentCanvasApprovalPreview(items []cloudAgentApprovalPreviewItem) cloudAgentApprovalPreview {
	counts := map[string]int{}
	for _, item := range items {
		counts[item.Operation]++
	}
	parts := make([]string, 0, 3)
	if counts["add_node"] > 0 {
		parts = append(parts, fmt.Sprintf("新增 %d 个节点", counts["add_node"]))
	}
	if counts["update_node"] > 0 {
		parts = append(parts, fmt.Sprintf("修改 %d 个节点", counts["update_node"]))
	}
	if counts["connect_nodes"] > 0 {
		parts = append(parts, fmt.Sprintf("建立 %d 条引用连线", counts["connect_nodes"]))
	}
	return cloudAgentApprovalPreview{
		Kind: "canvas_mutation", Title: "确认画布修改",
		Description: fmt.Sprintf("Agent 准备%s。请确认目标节点和修改字段；批准后才会写入画布。", strings.Join(parts, "，")),
		Items:       items,
	}
}

func cloudAgentMediaApprovalPreview(plan *cloudAgentMediaPlan, modelName string) cloudAgentApprovalPreview {
	args := plan.Args
	descriptor, _ := cloudAgentNodeCapabilityForGenerationMode(args.Mode)
	nodeTitle := truncateRunes(strings.TrimSpace(args.Title), 120)
	if nodeTitle == "" {
		nodeTitle = "未命名" + descriptor.Label
	}
	details := make([]string, 0, 6)
	if modelName != "" {
		details = append(details, "模型："+truncateRunes(modelName, 120))
	}
	if len(args.ReferenceNodeIDs) > 0 {
		details = append(details, fmt.Sprintf("引用 %d 个画布资产并建立连线", len(args.ReferenceNodeIDs)))
	} else {
		details = append(details, "不引用画布媒体资产")
	}
	if args.Duration > 0 {
		details = append(details, fmt.Sprintf("时长：%d 秒", args.Duration))
	}
	if args.Size != "" {
		details = append(details, "画幅："+truncateRunes(args.Size, 40))
	}
	if args.Quality != "" {
		details = append(details, "质量："+truncateRunes(args.Quality, 40))
	}
	if args.VideoGenerateAudio != nil {
		value := "关闭"
		if *args.VideoGenerateAudio {
			value = "开启"
		}
		details = append(details, "音频："+value)
	}
	return cloudAgentApprovalPreview{
		Kind: "media_generation", Title: "确认生成" + descriptor.Label,
		Description: descriptor.Label + "草稿节点和引用连线已创建，尚未提交生成。确认规格后批准才会提交收费任务；拒绝则保留草稿，结果自动回写画布。",
		Items: []cloudAgentApprovalPreviewItem{{
			Operation: "generate_media", NodeID: args.NodeID, NodeTitle: nodeTitle,
			NodeType: descriptor.Type, NodeTypeLabel: descriptor.Label, Details: details,
			Summary: "生成" + descriptor.Label + "《" + nodeTitle + "》",
		}},
	}
}

func cloudAgentApprovalPatchLabels(fields map[string]capability.PatchField, patch map[string]any) []string {
	keys := make([]string, 0, len(patch))
	for key := range patch {
		keys = append(keys, key)
	}
	sort.Slice(keys, func(i, j int) bool {
		left, right := fields[keys[i]], fields[keys[j]]
		if left.Order != right.Order {
			return left.Order < right.Order
		}
		return keys[i] < keys[j]
	})
	labels := make([]string, 0, len(keys))
	for _, key := range keys {
		if field, ok := fields[key]; ok {
			labels = append(labels, field.Label)
		}
	}
	return labels
}

func cloudAgentNodeIndex(nodes []map[string]any, id string) int {
	for index, node := range nodes {
		if stringValue(node["id"]) == id {
			return index
		}
	}
	return -1
}

func cloudAgentApprovalNodeTitle(node map[string]any, typeLabel string) string {
	title := truncateRunes(strings.TrimSpace(stringValue(node["title"])), 120)
	if title != "" {
		return title
	}
	return "未命名" + typeLabel
}

func cloudAgentApprovalCallHash(call cloudAgentCall) string {
	// Tool-call IDs are transport metadata and may be regenerated when the
	// model retries the same approved operation. Hash only the operation
	// payload so approval survives a retry with a different call ID. A media
	// snapshot hash is also a concurrency hint, not generation input: the
	// server revalidates the prepared dependency hash below, which deliberately
	// ignores layout-only edits such as moving a node.
	arguments := call.Function.Arguments
	if call.Function.Name == "generate_media" {
		var object map[string]any
		if err := json.Unmarshal([]byte(arguments), &object); err == nil {
			delete(object, "snapshotHash")
			if raw, err := json.Marshal(object); err == nil {
				arguments = string(raw)
			}
		}
	}
	payload := struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: call.Function.Name, Arguments: arguments}
	raw, _ := json.Marshal(payload)
	sum := sha256.Sum256(raw)
	return hex.EncodeToString(sum[:])
}
