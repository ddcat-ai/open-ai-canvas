package app

import (
	"fmt"
	"sort"
	"strings"
	"unicode/utf8"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const (
	maxCloudAgentBatchRows        = 500
	maxCloudAgentBatchReferences  = 10
	maxCloudAgentBatchPromptRunes = 20000
)

const (
	cloudAgentTryOnBatchPrompt    = "参考图1是人物原图，参考图2是目标服装。保持人物身份、五官、姿态和背景不变，将人物服装替换为参考图2中的款式。准确还原服装版型、颜色、材质、纹理和装饰细节，穿着关系自然，光影与原图一致。"
	cloudAgentCreativeBatchPrompt = "基于参考图创作一张新的商业图片，保留主体身份和关键产品细节，画面构图完整，光影自然。"
)

type cloudAgentBatchTableEditArgs struct {
	SnapshotHash string         `json:"snapshotHash"`
	NodeID       string         `json:"nodeId"`
	Action       string         `json:"action"`
	RowID        string         `json:"rowId"`
	Patch        map[string]any `json:"patch"`
	Operation    string         `json:"operation"`
	Concurrency  int            `json:"concurrency"`
	GlobalPrompt string         `json:"globalPrompt"`
}

type cloudAgentBatchTableMutationPlan struct {
	Canvas             *model.CanvasProject
	Document           map[string]any
	BeforeJSON         string
	BeforeSnapshotHash string
	Preview            cloudAgentApprovalPreview
}

func defaultCloudAgentBatchReferenceColumns() []any {
	return []any{
		map[string]any{"id": "reference-1", "label": "参考图 1"},
		map[string]any{"id": "reference-2", "label": "参考图 2"},
		map[string]any{"id": "reference-3", "label": "参考图 3"},
	}
}

func cloudAgentBatchTablePatchSchema() map[string]any {
	return map[string]any{
		"type": "object",
		"properties": map[string]any{
			"enabled":      map[string]any{"type": "boolean"},
			"inputNodeIds": map[string]any{"type": "array", "maxItems": maxCloudAgentBatchReferences, "items": map[string]any{"type": "string"}},
			"prompt":       map[string]any{"type": "string", "maxLength": maxCloudAgentBatchPromptRunes},
		},
		"additionalProperties": false,
	}
}

func batchTableArgumentError() error {
	return &cloudAgentArgumentError{BadAuthRequest("批量创作表工具参数无效：仅允许工具 schema 中声明的字段，请重新读取节点并按结构化参数重试")}
}

func batchTableNodeFromDocument(doc map[string]any, nodeID string) (map[string]any, map[string]any, []map[string]any, []map[string]any, error) {
	for _, node := range creationMaps(doc["nodes"]) {
		if stringValue(node["id"]) != nodeID {
			continue
		}
		if stringValue(node["type"]) != "batch-table" {
			return nil, nil, nil, nil, BadAuthRequest("目标节点不是批量创作表节点")
		}
		metadata, ok := node["metadata"].(map[string]any)
		if !ok {
			return nil, nil, nil, nil, BadAuthRequest("批量创作表节点数据格式无效")
		}
		table, ok := metadata["batchTable"].(map[string]any)
		if !ok {
			return nil, nil, nil, nil, BadAuthRequest("批量创作表节点缺少结构化数据")
		}
		operation := stringValue(table["operation"])
		if operation != "try_on" && operation != "creative" {
			return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效的任务类型")
		}
		concurrency, ok := cloudAgentInteger(table["concurrency"])
		if !ok || !cloudAgentBatchConcurrencyAllowed(concurrency) {
			return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效的并发数")
		}
		if rawPrompt, exists := table["globalPrompt"]; exists {
			globalPrompt, ok := rawPrompt.(string)
			if !ok || utf8.RuneCountInString(globalPrompt) > maxCloudAgentBatchPromptRunes {
				return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效或过长的全局提示词")
			}
		}
		columns := creationMaps(table["referenceColumns"])
		if len(columns) < 1 || len(columns) > maxCloudAgentBatchReferences {
			return nil, nil, nil, nil, BadAuthRequest("批量创作表必须包含 1 到 10 个参考图列")
		}
		columnIDs := map[string]bool{}
		for _, column := range columns {
			id, label := stringValue(column["id"]), stringValue(column["label"])
			if validateCloudAgentID(id, "参考图列ID", 120) != nil || strings.TrimSpace(label) == "" || utf8.RuneCountInString(label) > 120 || columnIDs[id] {
				return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效或重复的参考图列")
			}
			columnIDs[id] = true
		}
		rows := creationMaps(table["rows"])
		if len(rows) > maxCloudAgentBatchRows {
			return nil, nil, nil, nil, BadAuthRequest("单个批量创作表最多500行")
		}
		rowIDs := map[string]bool{}
		for _, row := range rows {
			rowID := stringValue(row["id"])
			if validateCloudAgentID(rowID, "批量创作行ID", 120) != nil || rowIDs[rowID] {
				return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效或重复的行ID")
			}
			rowIDs[rowID] = true
			if _, ok := row["enabled"].(bool); !ok {
				return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效的启用状态")
			}
			prompt, ok := row["prompt"].(string)
			if !ok || utf8.RuneCountInString(prompt) > maxCloudAgentBatchPromptRunes {
				return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效或过长的提示词")
			}
			if _, err := cloudAgentBatchInputNodeIDs(row["inputNodeIds"], len(columns)); err != nil {
				return nil, nil, nil, nil, err
			}
			if outputNodeID := stringValue(row["outputNodeId"]); outputNodeID != "" && validateCloudAgentID(outputNodeID, "输出节点ID", 120) != nil {
				return nil, nil, nil, nil, BadAuthRequest("批量创作表包含无效的输出节点ID")
			}
		}
		return node, table, rows, columns, nil
	}
	return nil, nil, nil, nil, BadAuthRequest("未找到当前画布的批量创作表节点")
}

func cloudAgentBatchInputNodeIDs(value any, maxItems int) ([]string, error) {
	items, ok := value.([]any)
	if !ok {
		if typed, typedOK := value.([]string); typedOK {
			items = make([]any, len(typed))
			for index, item := range typed {
				items[index] = item
			}
		} else {
			return nil, BadAuthRequest("批量创作行的 inputNodeIds 必须是图片节点ID数组")
		}
	}
	if len(items) > maxItems || len(items) > maxCloudAgentBatchReferences {
		return nil, BadAuthRequest("每行参考图数量不能超过当前参考图列数")
	}
	result := make([]string, 0, len(items))
	seen := map[string]bool{}
	for _, item := range items {
		id, ok := item.(string)
		if !ok || validateCloudAgentID(id, "参考图片节点ID", 80) != nil || seen[id] {
			return nil, BadAuthRequest("批量创作行包含无效或重复的图片节点ID")
		}
		seen[id] = true
		result = append(result, id)
	}
	return result, nil
}

func validateCloudAgentBatchInputNodes(doc map[string]any, inputNodeIDs []string) error {
	nodes := map[string]map[string]any{}
	for _, node := range creationMaps(doc["nodes"]) {
		nodes[stringValue(node["id"])] = node
	}
	for _, id := range inputNodeIDs {
		node := nodes[id]
		if node == nil || stringValue(node["type"]) != "image" {
			return BadAuthRequest("批量创作表只能引用当前画布内真实存在的图片节点")
		}
	}
	return nil
}

func prepareCloudAgentBatchTableEdit(repo *repository.Repository, userID, canvasID string, call cloudAgentCall) (*cloudAgentBatchTableMutationPlan, error) {
	var args cloudAgentBatchTableEditArgs
	if err := decodeCloudAgentJSONObject(call.Function.Arguments, &args); err != nil {
		return nil, batchTableArgumentError()
	}
	if args.SnapshotHash == "" || args.NodeID == "" {
		return nil, BadAuthRequest("编辑批量创作表需要最新快照和节点ID")
	}
	if err := validateCloudAgentID(args.NodeID, "批量创作表节点ID", 80); err != nil {
		return nil, err
	}
	allowedActions := map[string]bool{"append": true, "update": true, "remove": true, "set_operation": true, "set_concurrency": true, "add_reference_column": true, "remove_reference_column": true, "set_global_prompt": true}
	if !allowedActions[args.Action] {
		return nil, BadAuthRequest("批量创作表操作无效")
	}
	if args.Action == "append" && args.RowID != "" {
		return nil, BadAuthRequest("追加批量创作行不能指定已有 rowId")
	}
	if (args.Action == "update" || args.Action == "remove") && validateCloudAgentID(args.RowID, "批量创作行ID", 120) != nil {
		return nil, BadAuthRequest("修改或删除必须使用最新读取结果中的真实 rowId")
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
		return nil, creationConflict("画布已变化，本次未写入；请重新读取并重新申请审批")
	}
	node, table, rows, columns, err := batchTableNodeFromDocument(doc, args.NodeID)
	if err != nil {
		return nil, err
	}
	metadata := node["metadata"].(map[string]any)
	if metadata["locked"] == true {
		return nil, BadAuthRequest("不能修改锁定的批量创作表")
	}
	index := -1
	for i, row := range rows {
		if stringValue(row["id"]) == args.RowID {
			index = i
			break
		}
	}
	if (args.Action == "update" || args.Action == "remove") && index < 0 {
		return nil, BadAuthRequest("批量创作行不存在，请先读取真实 rowId")
	}

	fields := []string{}
	summaryVerb := "修改"
	switch args.Action {
	case "append", "update":
		if args.Action == "update" && len(args.Patch) == 0 {
			return nil, BadAuthRequest("修改批量创作行必须提供 patch")
		}
		patch, labels, err := validateCloudAgentBatchRowPatch(doc, args.Patch, len(columns))
		if err != nil {
			return nil, err
		}
		fields = labels
		if args.Action == "append" {
			if len(rows) >= maxCloudAgentBatchRows {
				return nil, BadAuthRequest("单个批量创作表最多500行")
			}
			operation := stringValue(table["operation"])
			prompt := cloudAgentTryOnBatchPrompt
			if operation == "creative" {
				prompt = cloudAgentCreativeBatchPrompt
			}
			inheritedInputNodeIDs := []any{}
			if len(rows) > 0 {
				inheritedInputNodeIDs = append(inheritedInputNodeIDs, cloudAgentBatchInputIDs(rows[len(rows)-1]["inputNodeIds"], len(columns))...)
			}
			row := map[string]any{"id": cloudAgentID(userID, fmt.Sprintf("batch-table:%s:%s:%d", args.NodeID, call.ID, len(rows)+1)), "enabled": true, "inputNodeIds": inheritedInputNodeIDs, "prompt": prompt}
			for key, value := range patch {
				row[key] = value
			}
			rows = append(rows, row)
			summaryVerb = "追加一行到"
			if len(fields) == 0 {
				fields = []string{"任务行"}
			}
		} else {
			for key, value := range patch {
				rows[index][key] = value
			}
			summaryVerb = "修改"
		}
		table["rows"] = mapsAsAny(rows)
	case "remove":
		if len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("删除批量创作行不接受其他修改参数")
		}
		rows = append(rows[:index], rows[index+1:]...)
		table["rows"] = mapsAsAny(rows)
		fields, summaryVerb = []string{"任务行"}, "删除一行自"
	case "set_operation":
		if args.Operation != "try_on" && args.Operation != "creative" {
			return nil, BadAuthRequest("批量任务类型必须是 try_on 或 creative")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Concurrency != 0 {
			return nil, BadAuthRequest("设置批量任务类型不接受行级修改参数")
		}
		table["operation"] = args.Operation
		fields = []string{"任务类型"}
	case "set_concurrency":
		if !cloudAgentBatchConcurrencyAllowed(args.Concurrency) {
			return nil, BadAuthRequest("并发数必须是 1、5 或 10")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" {
			return nil, BadAuthRequest("设置并发数不接受行级修改参数")
		}
		table["concurrency"] = float64(args.Concurrency)
		fields = []string{"并发数"}
	case "add_reference_column":
		if len(columns) >= maxCloudAgentBatchReferences {
			return nil, BadAuthRequest("批量创作表最多支持10组参考图")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("新增参考图列不接受其他修改参数")
		}
		next := len(columns) + 1
		columns = append(columns, map[string]any{"id": cloudAgentID(userID, fmt.Sprintf("batch-column:%s:%s:%d", args.NodeID, call.ID, next)), "label": fmt.Sprintf("参考图 %d", next)})
		table["referenceColumns"] = mapsAsAny(columns)
		fields = []string{"参考图列"}
		summaryVerb = "新增参考图列到"
	case "remove_reference_column":
		if len(columns) <= 1 {
			return nil, BadAuthRequest("批量创作表至少保留1组参考图")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("减少参考图列不接受其他修改参数")
		}
		columns = columns[:len(columns)-1]
		for index, column := range columns {
			column["label"] = fmt.Sprintf("参考图 %d", index+1)
		}
		table["referenceColumns"] = mapsAsAny(columns)
		for _, row := range rows {
			row["inputNodeIds"] = cloudAgentBatchInputIDs(row["inputNodeIds"], len(columns))
		}
		table["rows"] = mapsAsAny(rows)
		fields = []string{"参考图列"}
		summaryVerb = "减少参考图列自"
	case "set_global_prompt":
		if utf8.RuneCountInString(args.GlobalPrompt) > maxCloudAgentBatchPromptRunes {
			return nil, BadAuthRequest("全局提示词必须是不超过20000字的文本")
		}
		if args.RowID != "" || len(args.Patch) != 0 || args.Operation != "" || args.Concurrency != 0 {
			return nil, BadAuthRequest("设置全局提示词不接受其他修改参数")
		}
		if strings.TrimSpace(args.GlobalPrompt) == "" {
			delete(table, "globalPrompt")
		} else {
			table["globalPrompt"] = args.GlobalPrompt
		}
		fields = []string{"全局提示词"}
		summaryVerb = "设置全局提示词到"
	}
	metadata["batchTable"] = table
	title := cloudAgentApprovalNodeTitle(node, "批量创作表")
	preview := cloudAgentApprovalPreview{
		Kind: "canvas_mutation", Title: "确认修改批量创作表", Description: "Agent 准备修改批量创作表的结构化任务数据。批准后才会写入画布；本操作不会提交生成任务。",
		Items: []cloudAgentApprovalPreviewItem{{Operation: "edit_batch_table", NodeID: args.NodeID, NodeTitle: title, NodeType: "batch-table", NodeTypeLabel: "批量创作表", Fields: fields, Summary: fmt.Sprintf("%s批量创作表《%s》", summaryVerb, title)}},
	}
	return &cloudAgentBatchTableMutationPlan{Canvas: canvas, Document: doc, BeforeJSON: canvas.PayloadJSON, BeforeSnapshotHash: beforeHash, Preview: preview}, nil
}

func validateCloudAgentBatchRowPatch(doc map[string]any, input map[string]any, maxInputs int) (map[string]any, []string, error) {
	patch := map[string]any{}
	labels := []string{}
	for key, value := range input {
		switch key {
		case "enabled":
			if _, ok := value.(bool); !ok {
				return nil, nil, BadAuthRequest("enabled 必须是布尔值")
			}
			patch[key], labels = value, append(labels, "启用状态")
		case "prompt":
			text, ok := value.(string)
			if !ok || utf8.RuneCountInString(text) > maxCloudAgentBatchPromptRunes {
				return nil, nil, BadAuthRequest("提示词必须是不超过20000字的文本")
			}
			patch[key], labels = text, append(labels, "提示词")
		case "inputNodeIds":
			ids, err := cloudAgentBatchInputNodeIDs(value, maxInputs)
			if err != nil {
				return nil, nil, err
			}
			if err := validateCloudAgentBatchInputNodes(doc, ids); err != nil {
				return nil, nil, err
			}
			values := make([]any, len(ids))
			for index, id := range ids {
				values[index] = id
			}
			patch[key], labels = values, append(labels, "参考图片")
		default:
			return nil, nil, BadAuthRequest(fmt.Sprintf("不能通过批量创作表工具修改字段 %s", key))
		}
	}
	sort.Strings(labels)
	return patch, labels, nil
}

func cloudAgentBatchConcurrencyAllowed(value int) bool {
	return value == 1 || value == 5 || value == 10
}

func applyCloudAgentBatchTableMutation(repo *repository.Repository, userID, canvasID string, call cloudAgentCall, policy RuntimePolicySetting, recorder ...cloudAgentMutationRecorder) (any, error) {
	plan, err := prepareCloudAgentBatchTableEdit(repo, userID, canvasID, call)
	if err != nil {
		return nil, err
	}
	if err := saveCloudAgentDocument(repo, plan.Canvas, plan.Document, policy); err != nil {
		return nil, err
	}
	if len(recorder) > 0 && recorder[0] != nil {
		if err := recorder[0](repo, cloudAgentMutationInput{UserID: userID, CanvasID: canvasID, StepID: call.ID, Operation: call.Function.Name, BeforeSnapshotHash: plan.BeforeSnapshotHash, AfterSnapshotHash: cloudAgentCanvasHash(plan.Document), BeforeJSON: plan.BeforeJSON, Preview: &plan.Preview}); err != nil {
			return nil, err
		}
	}
	return map[string]any{"canvasId": canvasID, "nodeId": plan.Preview.Items[0].NodeID, "snapshotHash": cloudAgentCanvasHash(plan.Document), "summary": plan.Preview.Description, "preview": plan.Preview}, nil
}

func cloudAgentBatchTableReadResult(view any, nodeID string) (map[string]any, error) {
	state, ok := view.(map[string]any)
	if !ok {
		return nil, BadAuthRequest("批量创作表读取结果无效")
	}
	nodes, _ := state["nodes"].([]any)
	if len(nodes) != 1 {
		return nil, BadAuthRequest("批量创作表读取结果缺少目标节点")
	}
	node, ok := nodes[0].(map[string]any)
	if !ok {
		return nil, BadAuthRequest("批量创作表读取结果格式无效")
	}
	table, ok := node["batchTable"].(map[string]any)
	if !ok {
		return nil, BadAuthRequest("批量创作表读取结果缺少结构化任务行")
	}
	rows, _ := table["rows"].([]any)
	for _, value := range rows {
		if row, ok := value.(map[string]any); ok {
			row["rowId"] = row["id"]
		}
	}
	return map[string]any{"nodeId": nodeID, "title": node["title"], "snapshotHash": state["snapshotHash"], "batchTable": table}, nil
}
