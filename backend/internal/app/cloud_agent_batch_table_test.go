package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentBatchTableReferenceLimit(t *testing.T) {
	for _, count := range []int{10, 11} {
		t.Run(fmt.Sprint(count), func(t *testing.T) {
			columns := make([]any, count)
			for i := range columns {
				columns[i] = map[string]any{"id": fmt.Sprintf("reference-%d", i+1), "label": fmt.Sprintf("参考图 %d", i+1)}
			}
			doc := map[string]any{"nodes": []any{map[string]any{"id": "batch", "type": "batch-table", "metadata": map[string]any{"batchTable": map[string]any{"operation": "creative", "concurrency": float64(1), "referenceColumns": columns, "rows": []any{}}}}}}
			_, _, _, _, err := batchTableNodeFromDocument(doc, "batch")
			if (err == nil) != (count == 10) {
				t.Fatalf("reference count %d: unexpected validation result %v", count, err)
			}
		})
	}
}

func cloudAgentBatchTableCall(t *testing.T, name, callID string, args any) cloudAgentCall {
	t.Helper()
	raw, err := json.Marshal(args)
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentCall{ID: callID}
	call.Function.Name = name
	call.Function.Arguments = string(raw)
	return call
}

func cloudAgentBatchTableFixture(t *testing.T) (*Service, *model.CanvasProject) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	descriptor, ok := cloudAgentNodeCapabilityForType("batch-table")
	if !ok {
		t.Fatal("batch-table capability is not registered")
	}
	nodes := []any{
		map[string]any{"id": "image-1", "type": "image", "title": "模特", "position": map[string]any{"x": 0.0, "y": 0.0}, "width": 320.0, "height": 320.0, "metadata": map[string]any{"content": "data:image/png;base64,AA", "status": "success"}},
		map[string]any{"id": "image-2", "type": "image", "title": "服装", "position": map[string]any{"x": 360.0, "y": 0.0}, "width": 320.0, "height": 320.0, "metadata": map[string]any{"storageKey": "asset:test", "status": "success"}},
		map[string]any{"id": "batch-1", "type": "batch-table", "title": "电商换装批次", "position": map[string]any{"x": 720.0, "y": 0.0}, "width": descriptor.DefaultWidth, "height": descriptor.DefaultHeight, "metadata": descriptor.Metadata("")},
	}
	payload, err := json.Marshal(map[string]any{"nodes": nodes, "connections": []any{}})
	if err != nil {
		t.Fatal(err)
	}
	canvas := &model.CanvasProject{ID: "batch-agent-canvas", UserID: "user", Title: "批量表测试", PayloadJSON: string(payload)}
	if err := db.Create(canvas).Error; err != nil {
		t.Fatal(err)
	}
	return s, canvas
}

func TestCloudAgentBatchTableCapabilityMatchesCanvasComponent(t *testing.T) {
	descriptor, ok := cloudAgentNodeCapabilityForType("batch-table")
	if !ok {
		t.Fatal("batch-table capability missing")
	}
	if descriptor.Label != "批量创作表" || descriptor.DefaultWidth != 1280 || descriptor.DefaultHeight != 560 || descriptor.InputKind != "text" || descriptor.ProjectionKind != "batch_table" || descriptor.ProjectionField != "batchTable" {
		t.Fatalf("batch-table capability differs from component contract: %+v", descriptor)
	}
	if err := descriptor.ValidateConnection("image"); err != nil {
		t.Fatalf("batch table rejected image reference: %v", err)
	}
	if err := descriptor.ValidateConnection("text"); err == nil {
		t.Fatal("batch table accepted a non-image reference")
	}
	metadata := descriptor.Metadata("")
	table := metadata["batchTable"].(map[string]any)
	if table["operation"] != "try_on" || table["concurrency"] != float64(10) || len(creationMaps(table["referenceColumns"])) != 3 || len(creationMaps(table["rows"])) != 0 {
		t.Fatalf("unexpected batch-table defaults: %+v", table)
	}
	if _, allowsOpaqueRewrite := descriptor.PatchFields["batchTable"]; allowsOpaqueRewrite {
		t.Fatal("generic canvas patch may not replace the whole batch table")
	}
}

func TestCloudAgentBatchTableToolsAreScopedAndStructured(t *testing.T) {
	readOnly := agentTestRequest()
	readOnly.ContextScope = []string{"canvas"}
	readNames := map[string]bool{}
	for _, tool := range cloudAgentTools(readOnly) {
		name := tool["function"].(map[string]any)["name"].(string)
		readNames[name] = true
	}
	if !readNames["canvas_read_batch_table"] || readNames["canvas_edit_batch_table"] || readNames["canvas_table_plan"] {
		t.Fatalf("read-only batch table tool scope is wrong: %+v", readNames)
	}

	writable := readOnly
	writable.PermissionMode = "auto"
	functions := map[string]map[string]any{}
	for _, tool := range cloudAgentTools(writable) {
		function := tool["function"].(map[string]any)
		functions[function["name"].(string)] = function
	}
	if functions["canvas_edit_batch_table"] == nil || !cloudAgentWrite("canvas_edit_batch_table") {
		t.Fatal("batch table edit tool is not registered as an approved write")
	}
	parameters := functions["canvas_edit_batch_table"]["parameters"].(map[string]any)
	properties := parameters["properties"].(map[string]any)
	patch := properties["patch"].(map[string]any)["properties"].(map[string]any)
	for _, field := range []string{"enabled", "inputNodeIds", "prompt"} {
		if patch[field] == nil {
			t.Fatalf("batch row patch schema missing %s", field)
		}
	}
	if properties["globalPrompt"] == nil {
		t.Fatal("batch table edit schema missing globalPrompt")
	}
	actionEnum, _ := properties["action"].(map[string]any)["enum"].([]string)
	foundGlobalPrompt := false
	for _, action := range actionEnum {
		if action == "set_global_prompt" {
			foundGlobalPrompt = true
			break
		}
	}
	if !foundGlobalPrompt {
		t.Fatalf("batch table edit schema missing set_global_prompt: %+v", actionEnum)
	}
	for _, forbidden := range []string{"outputNodeId", "taskId", "url", "storageKey", "metadata"} {
		if patch[forbidden] != nil {
			t.Fatalf("batch row patch schema exposes forbidden field %s", forbidden)
		}
	}
}

func TestCloudAgentCanReadAndEditBatchTableRows(t *testing.T) {
	s, canvas := cloudAgentBatchTableFixture(t)
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "append-row", map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc), "nodeId": "batch-1", "action": "append",
		"patch": map[string]any{"inputNodeIds": []string{"image-1", "image-2"}, "prompt": "保持模特身份，替换为参考服装"},
	})
	plan, err := prepareCloudAgentBatchTableEdit(s.repo, "user", canvas.ID, call)
	if err != nil {
		t.Fatal(err)
	}
	if plan.Preview.Title != "确认修改批量创作表" || strings.Contains(plan.Preview.Description, "生成任务已提交") {
		t.Fatalf("unexpected approval preview: %+v", plan.Preview)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	result, err := applyCloudAgentBatchTableMutation(s.repo, "user", canvas.ID, call, policy)
	if err != nil {
		t.Fatal(err)
	}
	resultMap := result.(map[string]any)
	if resultMap["snapshotHash"] == "" {
		t.Fatal("batch table edit did not return a new snapshot")
	}

	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvas.ID}}
	readCall := cloudAgentBatchTableCall(t, "canvas_read_batch_table", "read-batch", map[string]any{"nodeId": "batch-1", "offset": 0})
	readResult, err := cloudAgentReadTool(s.repo, "user", state, readCall)
	if err != nil {
		t.Fatal(err)
	}
	read := readResult.(map[string]any)
	table := read["batchTable"].(map[string]any)
	columns := table["referenceColumns"].([]any)
	if columns[0].(map[string]any)["mentionToken"] != "@参考图1" || columns[1].(map[string]any)["mentionToken"] != "@参考图2" {
		t.Fatalf("batch table did not expose positional prompt mentions: %+v", columns)
	}
	rows := table["rows"].([]any)
	if len(rows) != 1 {
		t.Fatalf("expected one batch row, got %+v", table)
	}
	row := rows[0].(map[string]any)
	rowID := stringValue(row["rowId"])
	if rowID == "" || row["prompt"] != "保持模特身份，替换为参考服装" {
		t.Fatalf("batch row was not projected with a real rowId: %+v", row)
	}
	preview := table["generationPreview"].(map[string]any)
	if preview["readyRows"] != 1 {
		t.Fatalf("batch generation preview did not recognize ready try-on row: %+v", preview)
	}

	appendInheritedCall := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "append-inherited-row", map[string]any{
		"snapshotHash": read["snapshotHash"], "nodeId": "batch-1", "action": "append",
		"patch": map[string]any{"prompt": "沿用上一行参考图生成另一版"},
	})
	appendInheritedResult, err := applyCloudAgentBatchTableMutation(s.repo, "user", canvas.ID, appendInheritedCall, policy)
	if err != nil {
		t.Fatal(err)
	}
	appendInheritedSnapshot := appendInheritedResult.(map[string]any)["snapshotHash"]
	readInherited, err := cloudAgentReadTool(s.repo, "user", state, readCall)
	if err != nil {
		t.Fatal(err)
	}
	inheritedRows := readInherited.(map[string]any)["batchTable"].(map[string]any)["rows"].([]any)
	if len(inheritedRows) != 2 || len(inheritedRows[1].(map[string]any)["inputNodeIds"].([]any)) != 2 {
		t.Fatalf("agent append did not inherit the previous row references: %+v", inheritedRows)
	}

	updateCall := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "update-row", map[string]any{
		"snapshotHash": appendInheritedSnapshot, "nodeId": "batch-1", "action": "update", "rowId": rowID,
		"patch": map[string]any{"enabled": false, "prompt": "暂停这条任务"},
	})
	if _, err := applyCloudAgentBatchTableMutation(s.repo, "user", canvas.ID, updateCall, policy); err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentCanSetBatchTableGlobalPrompt(t *testing.T) {
	s, canvas := cloudAgentBatchTableFixture(t)
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	appendCall := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "append-empty-prompt", map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc), "nodeId": "batch-1", "action": "append",
		"patch": map[string]any{"inputNodeIds": []string{"image-1", "image-2"}, "prompt": " "},
	})
	appendResult, err := applyCloudAgentBatchTableMutation(s.repo, "user", canvas.ID, appendCall, policy)
	if err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: canvas.ID}}
	readCall := cloudAgentBatchTableCall(t, "canvas_read_batch_table", "read-before-global", map[string]any{"nodeId": "batch-1", "offset": 0})
	before, err := cloudAgentReadTool(s.repo, "user", state, readCall)
	if err != nil {
		t.Fatal(err)
	}
	beforePreview := before.(map[string]any)["batchTable"].(map[string]any)["generationPreview"].(map[string]any)
	if beforePreview["readyRows"] != 0 || beforePreview["missingPromptRows"] != 1 {
		t.Fatalf("empty row prompt should not be ready before global prompt: %+v", beforePreview)
	}

	setCall := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "set-global", map[string]any{
		"snapshotHash": appendResult.(map[string]any)["snapshotHash"], "nodeId": "batch-1", "action": "set_global_prompt",
		"globalPrompt": " 全局换装提示词 ",
	})
	setResult, err := applyCloudAgentBatchTableMutation(s.repo, "user", canvas.ID, setCall, policy)
	if err != nil {
		t.Fatal(err)
	}
	after, err := cloudAgentReadTool(s.repo, "user", state, readCall)
	if err != nil {
		t.Fatal(err)
	}
	table := after.(map[string]any)["batchTable"].(map[string]any)
	if table["globalPrompt"] != "全局换装提示词" && table["globalPrompt"] != " 全局换装提示词 " {
		t.Fatalf("global prompt was not projected: %+v", table)
	}
	preview := table["generationPreview"].(map[string]any)
	if preview["readyRows"] != 1 || preview["missingPromptRows"] != 0 {
		t.Fatalf("global prompt should make the row ready: %+v", preview)
	}

	clearCall := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "clear-global", map[string]any{
		"snapshotHash": setResult.(map[string]any)["snapshotHash"], "nodeId": "batch-1", "action": "set_global_prompt",
		"globalPrompt": "   ",
	})
	if _, err := applyCloudAgentBatchTableMutation(s.repo, "user", canvas.ID, clearCall, policy); err != nil {
		t.Fatal(err)
	}
	cleared, err := cloudAgentReadTool(s.repo, "user", state, readCall)
	if err != nil {
		t.Fatal(err)
	}
	clearedTable := cleared.(map[string]any)["batchTable"].(map[string]any)
	if _, exists := clearedTable["globalPrompt"]; exists {
		t.Fatalf("empty global prompt should be cleared: %+v", clearedTable)
	}
	clearedPreview := clearedTable["generationPreview"].(map[string]any)
	if clearedPreview["readyRows"] != 0 {
		t.Fatalf("cleared global prompt should restore missing prompt: %+v", clearedPreview)
	}

	reject := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "reject-global-row", map[string]any{
		"snapshotHash": cleared.(map[string]any)["snapshotHash"], "nodeId": "batch-1", "action": "set_global_prompt",
		"rowId": "row-should-not-be-accepted", "globalPrompt": "x",
	})
	if _, err := prepareCloudAgentBatchTableEdit(s.repo, "user", canvas.ID, reject); err == nil || !strings.Contains(err.Error(), "不接受其他修改参数") {
		t.Fatalf("set_global_prompt should reject row-level parameters: %v", err)
	}
}

func TestCloudAgentBatchTableRejectsUnsafeAndStaleEdits(t *testing.T) {
	s, canvas := cloudAgentBatchTableFixture(t)
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	hash := cloudAgentCanvasHash(doc)
	unsafe := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "unsafe-row", map[string]any{
		"snapshotHash": hash, "nodeId": "batch-1", "action": "append",
		"patch": map[string]any{"inputNodeIds": []string{"image-1"}, "outputNodeId": "forged-output"},
	})
	if _, err := prepareCloudAgentBatchTableEdit(s.repo, "user", canvas.ID, unsafe); err == nil || !strings.Contains(err.Error(), "outputNodeId") {
		t.Fatalf("unsafe output binding was not rejected: %v", err)
	}
	nonImage := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "bad-reference", map[string]any{
		"snapshotHash": hash, "nodeId": "batch-1", "action": "append",
		"patch": map[string]any{"inputNodeIds": []string{"batch-1"}},
	})
	if _, err := prepareCloudAgentBatchTableEdit(s.repo, "user", canvas.ID, nonImage); err == nil || !strings.Contains(err.Error(), "图片节点") {
		t.Fatalf("non-image reference was not rejected: %v", err)
	}
	stale := cloudAgentBatchTableCall(t, "canvas_edit_batch_table", "stale-row", map[string]any{
		"snapshotHash": "stale", "nodeId": "batch-1", "action": "set_concurrency", "concurrency": 5,
	})
	if _, err := prepareCloudAgentBatchTableEdit(s.repo, "user", canvas.ID, stale); err == nil || !strings.Contains(err.Error(), "画布已变化") {
		t.Fatalf("stale snapshot was not rejected: %v", err)
	}
}
