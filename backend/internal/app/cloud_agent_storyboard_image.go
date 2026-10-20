package app

import (
	"fmt"
	"strings"
	"unicode/utf8"

	"yingce/backend/internal/repository"
)

type cloudAgentStoryboardImageBinding struct {
	NodeID string `json:"nodeId"`
	Role   string `json:"role"`
}

type cloudAgentStoryboardImageArgs struct {
	SnapshotHash      string                             `json:"snapshotHash"`
	NodeID            string                             `json:"nodeId"`
	RowID             string                             `json:"rowId"`
	ImageNodeID       string                             `json:"imageNodeId"`
	ImageSnapshotHash string                             `json:"imageSnapshotHash"`
	Prompt            string                             `json:"prompt"`
	ReferenceBindings []cloudAgentStoryboardImageBinding `json:"referenceBindings"`
}

func cloudAgentStoryboardImageRole(node map[string]any) string {
	metadata, _ := node["metadata"].(map[string]any)
	if cloudAgentCharacterNode(node) || stringValue(node["type"]) == "image" && stringValue(metadata["workflowKind"]) == "character" {
		return "character"
	}
	role := stringValue(metadata["assetCategory"])
	if cloudAgentStoryboardImageRoleValid(role) {
		return role
	}
	return "style"
}

func cloudAgentStoryboardImageRoleValid(role string) bool {
	switch role {
	case "character", "environment", "wardrobe", "prop", "weapon", "style":
		return true
	default:
		return false
	}
}

func cloudAgentStoryboardImageOutput(nodes map[string]map[string]any, edges []map[string]any, scriptID, rowID, boundID string) (string, []map[string]any, error) {
	if boundID != "" && nodes[boundID] == nil {
		return "", nil, BadAuthRequest("本镜头关联的图片节点已不存在，请先修复关联")
	}
	retained := []map[string]any{}
	outputID := ""
	for _, edge := range edges {
		belongs := stringValue(edge["relation"]) == "storyboard-output" && stringValue(edge["fromNodeId"]) == scriptID && stringValue(edge["fromHandleId"]) == "row:"+rowID && stringValue(edge["storyboardRowId"]) == rowID
		if belongs {
			id := stringValue(edge["toNodeId"])
			if nodes[id] == nil {
				continue
			}
			if outputID != "" {
				if outputID != id {
					return "", nil, creationConflict("本镜头存在多个输出图片，请先明确关联，不会另建节点绕过")
				}
				continue
			}
			outputID = id
		}
		retained = append(retained, edge)
	}
	if boundID != "" && outputID != "" && boundID != outputID {
		return "", nil, creationConflict("镜头行与现有输出连线不一致，请先修复关联")
	}
	if boundID == "" {
		boundID = outputID
	}
	return boundID, retained, nil
}

func cloudAgentStoryboardImageReferences(repo *repository.Repository, userID, projectID string, doc, storyboard, row map[string]any, targetID string, selected []cloudAgentStoryboardImageBinding) ([]map[string]any, map[string]any, error) {
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, nil, err
	}
	bindings := []map[string]any{}
	positions := map[string]int{}
	add := func(id, role string) error {
		if id == "" || id == targetID {
			return BadAuthRequest("分镜参考不能缺少节点ID或引用本镜头的输出图片")
		}
		if nodes[id] == nil || !cloudAgentStoryboardImageRoleValid(role) {
			return BadAuthRequest("分镜参考节点不存在或图片参考职责无效")
		}
		if index, exists := positions[id]; exists {
			bindings[index]["role"] = role
			return nil
		}
		positions[id] = len(bindings)
		bindings = append(bindings, map[string]any{"nodeId": id, "role": role, "priority": float64(100)})
		return nil
	}
	for _, binding := range creationMaps(row["assetBindings"]) {
		role := stringValue(binding["role"])
		if role == "motion" || role == "audio" {
			continue
		}
		if err := add(stringValue(binding["nodeId"]), role); err != nil {
			return nil, nil, err
		}
		if priority, ok := cloudAgentSafeNumber(binding["priority"]); ok {
			bindings[positions[stringValue(binding["nodeId"])]]["priority"] = priority
		}
	}
	for _, character := range creationMaps(row["characters"]) {
		if id := stringValue(character["characterImageNodeId"]); id != "" {
			if err := add(id, "character"); err != nil {
				return nil, nil, err
			}
			continue
		}
		assetID := stringValue(character["characterAssetId"])
		if assetID == "" {
			continue
		}
		candidates := []string{}
		for id, node := range nodes {
			metadata, _ := node["metadata"].(map[string]any)
			if stringValue(metadata["characterAssetId"]) == assetID && (cloudAgentCharacterNode(node) || stringValue(node["type"]) == "image" && cloudAgentStoryboardImageRole(node) == "character") {
				candidates = append(candidates, id)
			}
		}
		if len(candidates) == 0 {
			return nil, nil, BadAuthRequest("角色“" + stringValue(character["characterName"]) + "”缺少对应的角色卡或角色图片，请先绑定项目角色及就绪形象，再准备本镜头图片")
		}
		if len(candidates) > 1 {
			chosen := []string{}
			for _, binding := range selected {
				for _, id := range candidates {
					if binding.NodeID == id && binding.Role == "character" {
						chosen = append(chosen, id)
					}
				}
			}
			if len(chosen) != 1 {
				return nil, nil, BadAuthRequest("角色存在多个画布形象或版本，请明确本镜头采用哪一个，不会自动猜测")
			}
			candidates = chosen
		}
		if len(candidates) == 1 {
			if err := add(candidates[0], "character"); err != nil {
				return nil, nil, err
			}
		}
	}
	for _, id := range toStringSlice(storyboard["referenceNodeIds"]) {
		if nodes[id] == nil {
			return nil, nil, BadAuthRequest("分镜的公共参考节点已不存在，请先修复引用")
		}
		if stringValue(nodes[id]["type"]) == "image" || cloudAgentCharacterNode(nodes[id]) {
			if err := add(id, cloudAgentStoryboardImageRole(nodes[id])); err != nil {
				return nil, nil, err
			}
		}
	}
	for _, edge := range creationMaps(doc["connections"]) {
		id := stringValue(edge["fromNodeId"])
		rowInput := stringValue(edge["toNodeId"]) == stringValue(storyboard["nodeId"]) && stringValue(edge["toHandleId"]) == "row:"+stringValue(row["id"])
		targetInput := stringValue(edge["toNodeId"]) == targetID && stringValue(edge["relation"]) != "storyboard-output" && stringValue(nodes[id]["type"]) != "script"
		if !rowInput && !targetInput {
			continue
		}
		if rowInput && stringValue(nodes[id]["type"]) == "text" && !cloudAgentCharacterNode(nodes[id]) {
			continue
		}
		if err := add(id, cloudAgentStoryboardImageRole(nodes[id])); err != nil {
			return nil, nil, err
		}
	}
	seen := map[string]bool{}
	for _, binding := range selected {
		if seen[binding.NodeID] {
			return nil, nil, BadAuthRequest("同一参考节点不能重复指定职责")
		}
		seen[binding.NodeID] = true
		if err := add(binding.NodeID, binding.Role); err != nil {
			return nil, nil, err
		}
	}
	if len(bindings) > 16 {
		return nil, nil, BadAuthRequest("本镜头图片参考超过16个，请先明确本镜头所需素材")
	}
	refs := map[string]any{"referenceImages": []any{}}
	for _, binding := range bindings {
		ref, field, err := cloudAgentMediaReference(repo, userID, projectID, nodes[stringValue(binding["nodeId"])])
		if err != nil {
			return nil, nil, err
		}
		if field != "referenceImages" {
			return nil, nil, BadAuthRequest("分镜图片只接受图片或有就绪三视图的角色卡；声音、运动参考保留在分镜中")
		}
		refs[field] = append(refs[field].([]any), ref)
	}
	return bindings, refs, nil
}

func prepareCloudAgentStoryboardImage(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentStoryboardMutationPlan, map[string]any, error) {
	var args cloudAgentStoryboardImageArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, nil, storyboardArgumentError("准备图片")
	}
	if validateCloudAgentID(args.NodeID, "分镜节点ID", 80) != nil || validateCloudAgentID(args.RowID, "镜头行ID", 120) != nil {
		return nil, nil, BadAuthRequest("请使用最新读取的真实分镜节点ID和rowId")
	}
	canvas, err := repo.CanvasProjectForUser(userID, canvasID)
	if err != nil {
		return nil, nil, err
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		return nil, nil, err
	}
	beforeHash := cloudAgentCanvasHash(doc)
	if !cloudAgentNodeSnapshotMatches(doc, args.NodeID, args.SnapshotHash) {
		return nil, nil, creationConflict("分镜已变化，请重新读取镜头再准备图片")
	}
	script, storyboard, rows, err := storyboardNodeFromDocument(doc, args.NodeID)
	if err != nil {
		return nil, nil, err
	}
	metadata, _ := script["metadata"].(map[string]any)
	if script["locked"] == true || metadata["locked"] == true {
		return nil, nil, BadAuthRequest("分镜已锁定，不能修改镜头关联")
	}
	var row map[string]any
	for _, candidate := range rows {
		if stringValue(candidate["id"]) == args.RowID {
			row = candidate
		}
	}
	if row == nil {
		return nil, nil, BadAuthRequest("镜头行不存在，请重新读取分镜，不要猜rowId")
	}
	nodes, err := creationObjects(doc["nodes"])
	if err != nil {
		return nil, nil, err
	}
	bound, retained, err := cloudAgentStoryboardImageOutput(nodes, creationMaps(doc["connections"]), args.NodeID, args.RowID, stringValue(row["imageNodeId"]))
	if err != nil {
		return nil, nil, err
	}
	doc["connections"] = retained
	imageID := args.ImageNodeID
	if bound != "" {
		if imageID != "" && imageID != bound {
			return nil, nil, BadAuthRequest("本镜头已关联图片节点，请复用原节点，不要另建节点绕过已有结果或任务")
		}
		imageID = bound
		row["imageNodeId"] = bound
	}
	if imageID == "" {
		imageID = "agent-" + newID()
	}
	if err := validateCloudAgentID(imageID, "图片节点ID", 80); err != nil {
		return nil, nil, err
	}
	image := nodes[imageID]
	if args.ImageNodeID != "" && image == nil {
		return nil, nil, BadAuthRequest("指定的已有图片节点不存在，不能猜测或重建")
	}
	if image != nil {
		if !cloudAgentNodeSnapshotMatches(doc, imageID, args.ImageSnapshotHash) {
			return nil, nil, creationConflict("复用图片节点需要最新imageSnapshotHash；节点已变化时不能覆盖提示词")
		}
		if reason, issue := cloudAgentMediaTargetIssue(image, "image"); reason != "" {
			return nil, nil, &cloudAgentMediaAdmissionError{error: BadAuthRequest(issue), Reason: reason, NodeID: imageID, ErrorClass: cloudAgentToolErrorAdmission, RequiredAction: "inspect_existing_task"}
		}
		imageMeta, _ := image["metadata"].(map[string]any)
		if stringValue(imageMeta["agentDraftRunId"]) != "" {
			return nil, nil, BadAuthRequest("图片节点处于生成审批中，不能修改")
		}
		linkedScript, linkedRow, err := cloudAgentStoryboardImageSource(doc, imageID)
		if err != nil {
			return nil, nil, err
		}
		if linkedRow != nil && (stringValue(linkedScript["id"]) != args.NodeID || stringValue(linkedRow["id"]) != args.RowID) {
			return nil, nil, BadAuthRequest("图片节点属于另一镜头，不能改绑")
		}
		for _, edge := range creationMaps(doc["connections"]) {
			if stringValue(edge["toNodeId"]) == imageID && stringValue(edge["relation"]) == "batch-output" {
				return nil, nil, BadAuthRequest("图片节点属于批量创作输出，不能改绑到分镜")
			}
		}
	}
	context := mergeCreationMaps(storyboard, map[string]any{"nodeId": args.NodeID})
	bindings, refs, err := cloudAgentStoryboardImageReferences(repo, userID, canvas.ProjectID, doc, context, row, imageID, args.ReferenceBindings)
	if err != nil {
		return nil, nil, err
	}
	prompt := strings.TrimSpace(args.Prompt)
	if prompt == "" {
		prompt = strings.TrimSpace(stringValue(row["imageGenerationPrompt"]))
	}
	if prompt == "" {
		prompt = strings.TrimSpace(stringValue(row["plotDescription"]))
	}
	if prompt == "" {
		return nil, nil, BadAuthRequest("镜头缺少画面描述或图片提示词，请先补全分镜")
	}
	prompt = cloudAgentStoryboardImagePrompt(row, prompt, bindings, refs)
	if utf8.RuneCountInString(prompt) > 16000 {
		return nil, nil, BadAuthRequest("完整分镜图片提示词超过16000字符，请明确精简范围，不会自动截断镜头要求")
	}
	title := fmt.Sprintf("镜头 %v · 分镜图", row["shotNumber"])
	if image == nil {
		position, _ := script["position"].(map[string]any)
		x := numberValue(position["x"], 0) + numberValue(script["width"], 920) + 80
		y := numberValue(position["y"], 0)
		image = creationAddedNode(CreationCanvasOp{Type: "add_node", ID: imageID, NodeType: "image", Title: title, X: &x, Y: &y})
		doc["nodes"] = append(creationMaps(doc["nodes"]), image)
	} else {
		title = stringValue(image["title"])
	}
	imageMeta, _ := image["metadata"].(map[string]any)
	imageMeta = mergeCreationMaps(imageMeta, map[string]any{"prompt": cloudAgentMediaComposerPrompt(prompt, refs), "composerContent": cloudAgentMediaComposerPrompt(prompt, refs), "workflowKind": "shot", "workflowTitle": fmt.Sprintf("镜头 %v 分镜图", row["shotNumber"]), "shotIndex": row["shotNumber"]})
	image["metadata"] = imageMeta
	row["imageNodeId"] = imageID
	otherBindings := []map[string]any{}
	for _, binding := range creationMaps(row["assetBindings"]) {
		if role := stringValue(binding["role"]); role == "audio" || role == "motion" {
			otherBindings = append(otherBindings, binding)
		}
	}
	row["assetBindings"] = append(bindings, otherBindings...)
	references := []string{}
	edges := creationMaps(doc["connections"])
	for _, binding := range bindings {
		id := stringValue(binding["nodeId"])
		references = append(references, id)
		edges = cloudAgentStoryboardImageEdge(edges, id, args.NodeID, "", "row:"+args.RowID, "storyboard-asset-reference", args.RowID)
		edges = cloudAgentStoryboardImageEdge(edges, id, imageID, "", "", "storyboard-asset-reference", args.RowID)
	}
	doc["connections"] = cloudAgentStoryboardImageEdge(edges, args.NodeID, imageID, "row:"+args.RowID, "", "storyboard-output", args.RowID)
	details := []string{fmt.Sprintf("分镜：%s · 镜头 %v", stringValue(script["title"]), row["shotNumber"])}
	for index, ref := range creationMaps(refs["referenceImages"]) {
		details = append(details, fmt.Sprintf("参考 %d：%s（%s）", index+1, stringValue(ref["name"]), stringValue(bindings[index]["role"])))
	}
	preview := cloudAgentApprovalPreview{Kind: "canvas_mutation", Title: "确认准备分镜图片", Description: "关联镜头、复用或创建图片草稿并编排参考素材和提示词；本操作不提交生成、不收费。", Items: []cloudAgentApprovalPreviewItem{{Operation: "prepare_storyboard_image", NodeID: imageID, NodeTitle: title, NodeType: "image", NodeTypeLabel: "图片", Details: details, Summary: fmt.Sprintf("准备镜头 %v 的分镜图（%d个图片参考）", row["shotNumber"], len(bindings))}}}
	plan := &cloudAgentStoryboardMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash, Preview: preview}
	result := map[string]any{"nodeId": args.NodeID, "rowId": args.RowID, "imageNodeId": imageID, "title": title, "prompt": prompt, "referenceNodeIds": references, "referenceBindings": bindings, "snapshotHash": cloudAgentNodeHash(doc, args.NodeID), "imageSnapshotHash": cloudAgentNodeHash(doc, imageID), "mediaSnapshotHash": cloudAgentMediaContentHash(doc), "submitted": false, "preview": preview}
	return plan, result, nil
}

func cloudAgentStoryboardImageEdge(edges []map[string]any, fromID, toID, fromHandle, toHandle, relation, rowID string) []map[string]any {
	for _, edge := range edges {
		if stringValue(edge["fromNodeId"]) == fromID && stringValue(edge["toNodeId"]) == toID && stringValue(edge["fromHandleId"]) == fromHandle && stringValue(edge["toHandleId"]) == toHandle {
			edge["relation"], edge["storyboardRowId"] = relation, rowID
			return edges
		}
	}
	return append(edges, map[string]any{"id": "agent-" + newID(), "fromNodeId": fromID, "toNodeId": toID, "fromHandleId": fromHandle, "toHandleId": toHandle, "relation": relation, "storyboardRowId": rowID})
}

func applyCloudAgentStoryboardImage(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder cloudAgentMutationRecorder) (any, error) {
	plan, result, err := prepareCloudAgentStoryboardImage(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	if err := saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	if recorder != nil {
		if err := recorder(repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: call.Function.Name, BeforeSnapshotHash: plan.BeforeSnapshotHash, AfterSnapshotHash: cloudAgentCanvasHash(plan.Document), BeforeJSON: plan.BeforeJSON, Preview: &plan.Preview}); err != nil {
			return nil, err
		}
	}
	return result, nil
}
