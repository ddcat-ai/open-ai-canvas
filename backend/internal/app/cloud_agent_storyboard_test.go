package app

import (
	"encoding/json"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

func cloudAgentStoryboardCall(t *testing.T, name, callID string, args any) cloudAgentCall {
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

func cloudAgentStoryboardFixture(t *testing.T) (*Service, *model.CanvasProject) {
	t.Helper()
	s, db, _, _ := creationTestService(t)
	canvas := &model.CanvasProject{ID: "agent-canvas", UserID: "user", Title: "分镜测试", PayloadJSON: `{"nodes":[],"connections":[]}`}
	if err := db.Create(canvas).Error; err != nil {
		t.Fatal(err)
	}
	return s, canvas
}

func createCloudAgentStoryboardForTest(t *testing.T, s *Service, canvas *model.CanvasProject) []map[string]any {
	t.Helper()
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	call := cloudAgentStoryboardCall(t, "canvas_create_storyboard", "create-storyboard", map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc),
		"nodeId":       "storyboard-1",
		"title":        "追逐戏分镜",
		"x":            120,
		"y":            80,
		"rows": []map[string]any{
			{"durationSeconds": 4.0, "plotDescription": "主角冲出巷口", "camera": "低机位跟拍"},
			{"durationSeconds": 6.0, "videoMotionPrompt": "反派从屋顶跃下", "continuityOut": "主角转身看向屋顶"},
		},
	})
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if _, err := applyCloudAgentStoryboardMutation(s.repo, "user", canvas.ID, call, policy); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	*canvas = *stored
	storedDoc, err := creationDocument(stored.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	_, _, rows, err := storyboardNodeFromDocument(storedDoc, "storyboard-1")
	if err != nil {
		t.Fatal(err)
	}
	return rows
}

func TestCloudAgentNodeCapabilityCardsExplainStoryboardTradeoffs(t *testing.T) {
	result := cloudAgentNodeTypes()
	if result["schemaVersion"] != 2 {
		t.Fatalf("unexpected capability schema version: %v", result["schemaVersion"])
	}
	nodes := result["nodes"].([]map[string]any)
	byType := map[string]map[string]any{}
	for _, node := range nodes {
		byType[node["type"].(string)] = node
	}
	storyboard := byType["script"]
	for _, nodeType := range []string{"text", "markdown", "image", "video", "audio", "frame", "script"} {
		node := byType[nodeType]
		for _, key := range []string{"purpose", "goodFor", "notIdealFor", "tradeoffs"} {
			if value, exists := node[key]; !exists || value == nil {
				t.Fatalf("%s capability card lacks %s: %+v", nodeType, key, node)
			}
		}
	}
	for _, nodeType := range []string{"image", "video", "audio", "script"} {
		if actions, exists := byType[nodeType]["actions"]; !exists || actions == nil {
			t.Fatalf("%s capability card lacks actions: %+v", nodeType, byType[nodeType])
		}
	}
	if storyboard["purpose"] == byType["text"]["purpose"] || storyboard["purpose"] == byType["markdown"]["purpose"] {
		t.Fatal("storyboard and lightweight nodes expose indistinguishable purposes")
	}
	videoGoodFor := strings.Join(byType["video"]["goodFor"].([]string), "\n")
	if !strings.Contains(videoGoodFor, "多图参考视频") {
		t.Fatalf("video capability card does not explain multi-image video: %s", videoGoodFor)
	}
	guide := strings.Join(result["selectionGuide"].([]string), "\n")
	if !strings.Contains(guide, "多镜头") || !strings.Contains(guide, "model_list") || !strings.Contains(guide, "不要为了形式") {
		t.Fatalf("selection guide does not express soft routing: %s", guide)
	}
}

func TestCloudAgentStoryboardToolsAreScopedAndStructured(t *testing.T) {
	readOnly := agentTestRequest()
	readOnly.ContextScope = []string{"canvas"}
	readNames := map[string]bool{}
	for _, tool := range cloudAgentTools(readOnly) {
		name := tool["function"].(map[string]any)["name"].(string)
		readNames[name] = true
	}
	if !readNames["canvas_read_storyboard"] || readNames["canvas_create_storyboard"] || readNames["canvas_edit_storyboard"] {
		t.Fatalf("read-only storyboard tool scope is wrong: %+v", readNames)
	}

	writable := readOnly
	writable.PermissionMode = "auto"
	functions := map[string]map[string]any{}
	for _, tool := range cloudAgentTools(writable) {
		function := tool["function"].(map[string]any)
		functions[function["name"].(string)] = function
	}
	for _, name := range []string{"canvas_read_storyboard", "canvas_create_storyboard", "canvas_edit_storyboard"} {
		if functions[name] == nil {
			t.Fatalf("missing storyboard tool %s", name)
		}
	}
	createRows := functions["canvas_create_storyboard"]["parameters"].(map[string]any)["properties"].(map[string]any)["rows"].(map[string]any)
	rowProperties := createRows["items"].(map[string]any)["properties"].(map[string]any)
	if _, leaksID := rowProperties["id"]; leaksID {
		t.Fatal("create storyboard schema lets the model forge row IDs")
	}
	editPatch := functions["canvas_edit_storyboard"]["parameters"].(map[string]any)["properties"].(map[string]any)["patch"].(map[string]any)["properties"].(map[string]any)
	for _, protected := range []string{"imageNodeId", "videoNodeId", "assetBindings", "status"} {
		if _, exists := editPatch[protected]; exists {
			t.Fatalf("protected field %s leaked into edit schema", protected)
		}
	}
	if !cloudAgentWrite("canvas_create_storyboard") || !cloudAgentWrite("canvas_edit_storyboard") {
		t.Fatal("storyboard mutations are not classified as writes")
	}
	supported := strings.Join(CloudAgentSupportedToolNames(), ",")
	if !strings.Contains(supported, "canvas_create_storyboard") || !strings.Contains(supported, "canvas_edit_storyboard") {
		t.Fatalf("supported tool list is stale: %s", supported)
	}
}

func TestCloudAgentCreatesAndReadsStructuredStoryboard(t *testing.T) {
	s, canvas := cloudAgentStoryboardFixture(t)
	doc, _ := creationDocument(canvas.PayloadJSON)
	call := cloudAgentStoryboardCall(t, "canvas_create_storyboard", "create-preview", map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc),
		"nodeId":       "storyboard-preview",
		"title":        "预览分镜",
		"rows":         []map[string]any{{"durationSeconds": 3.0, "plotDescription": "雨夜开场"}},
	})
	plan, err := prepareCloudAgentStoryboardCreate(s.repo, "user", canvas.ID, call)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Preview.Items) != 1 || plan.Preview.Items[0].Operation != "create_storyboard" || !strings.Contains(plan.Preview.Description, "1 个镜头") {
		t.Fatalf("approval preview is incomplete: %+v", plan.Preview)
	}

	rows := createCloudAgentStoryboardForTest(t, s, canvas)
	if len(rows) != 2 || stringValue(rows[0]["id"]) == "" || stringValue(rows[0]["id"]) == stringValue(rows[1]["id"]) {
		t.Fatalf("server did not create stable unique row IDs: %+v", rows)
	}
	if rows[0]["shotNumber"] != float64(1) || rows[1]["shotNumber"] != float64(2) {
		t.Fatalf("shot numbers are wrong: %+v", rows)
	}
	if rows[0]["status"] != "idle" || rows[0]["assetBindings"] == nil || rows[0]["characters"] == nil {
		t.Fatalf("created row lacks frontend-safe defaults: %+v", rows[0])
	}

	state := &cloudAgentRuntime{Request: agentTestRequest()}
	readCall := cloudAgentStoryboardCall(t, "canvas_read_storyboard", "read-storyboard", map[string]any{"nodeId": "storyboard-1", "offset": 0})
	result, err := cloudAgentReadTool(s.repo, "user", state, readCall)
	if err != nil {
		t.Fatal(err)
	}
	read := result.(map[string]any)
	storyboard := read["storyboard"].(map[string]any)
	readRows := storyboard["rows"].([]any)
	if len(readRows) != 1 || readRows[0].(map[string]any)["rowId"] != rows[0]["id"] || storyboard["nextOffset"] != 1 {
		t.Fatalf("paged storyboard read lost row ID or pagination: %+v", read)
	}
}

func TestCloudAgentStoryboardEditPreservesRowsAndRenumbers(t *testing.T) {
	s, canvas := cloudAgentStoryboardFixture(t)
	initialRows := createCloudAgentStoryboardForTest(t, s, canvas)
	firstID, secondID := stringValue(initialRows[0]["id"]), stringValue(initialRows[1]["id"])
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}

	apply := func(call cloudAgentCall) []map[string]any {
		t.Helper()
		if _, err := applyCloudAgentStoryboardMutation(s.repo, "user", canvas.ID, call, policy); err != nil {
			t.Fatal(err)
		}
		stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
		if err != nil {
			t.Fatal(err)
		}
		*canvas = *stored
		doc, _ := creationDocument(canvas.PayloadJSON)
		_, _, rows, err := storyboardNodeFromDocument(doc, "storyboard-1")
		if err != nil {
			t.Fatal(err)
		}
		return rows
	}
	currentHash := func() string {
		doc, _ := creationDocument(canvas.PayloadJSON)
		return cloudAgentCanvasHash(doc)
	}

	rows := apply(cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "update-row", map[string]any{
		"snapshotHash": currentHash(), "nodeId": "storyboard-1", "action": "update", "rowId": firstID,
		"patch": map[string]any{"dialogue": "快跑！", "durationSeconds": 5.0},
	}))
	if rows[0]["dialogue"] != "快跑！" || rows[1]["id"] != secondID || rows[1]["videoMotionPrompt"] != "反派从屋顶跃下" {
		t.Fatalf("update did not preserve unrelated rows: %+v", rows)
	}

	rows = apply(cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "append-row", map[string]any{
		"snapshotHash": currentHash(), "nodeId": "storyboard-1", "action": "append",
		"patch": map[string]any{"durationSeconds": 2.0, "plotDescription": "两人在街口对峙"},
	}))
	if len(rows) != 3 || rows[2]["shotNumber"] != float64(3) || stringValue(rows[2]["id"]) == "" {
		t.Fatalf("append failed: %+v", rows)
	}

	rows = apply(cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "remove-row", map[string]any{
		"snapshotHash": currentHash(), "nodeId": "storyboard-1", "action": "remove", "rowId": firstID,
	}))
	if len(rows) != 2 || rows[0]["id"] != secondID || rows[0]["shotNumber"] != float64(1) || rows[1]["shotNumber"] != float64(2) {
		t.Fatalf("remove did not preserve IDs and renumber rows: %+v", rows)
	}
}

func TestCloudAgentStoryboardRejectsUnsafeOrStaleMutations(t *testing.T) {
	s, canvas := cloudAgentStoryboardFixture(t)
	rows := createCloudAgentStoryboardForTest(t, s, canvas)
	doc, _ := creationDocument(canvas.PayloadJSON)
	hash := cloudAgentCanvasHash(doc)
	rowID := stringValue(rows[0]["id"])

	for _, field := range []string{"imageNodeId", "videoNodeId", "assetBindings", "status", "resourceUrl", "unknown"} {
		t.Run(field, func(t *testing.T) {
			call := cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "unsafe-"+field, map[string]any{
				"snapshotHash": hash, "nodeId": "storyboard-1", "action": "update", "rowId": rowID,
				"patch": map[string]any{field: "forbidden"},
			})
			if _, err := prepareCloudAgentStoryboardEdit(s.repo, "user", canvas.ID, call); err == nil {
				t.Fatalf("unsafe field %s was accepted", field)
			}
		})
	}

	stale := cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "stale", map[string]any{
		"snapshotHash": "stale", "nodeId": "storyboard-1", "action": "update", "rowId": rowID,
		"patch": map[string]any{"dialogue": "不应写入"},
	})
	if _, err := prepareCloudAgentStoryboardEdit(s.repo, "user", canvas.ID, stale); err == nil || !strings.Contains(err.Error(), "画布已变化") {
		t.Fatalf("stale snapshot was not rejected: %v", err)
	}

	empty := cloudAgentStoryboardCall(t, "canvas_create_storyboard", "empty", map[string]any{
		"snapshotHash": hash, "nodeId": "empty-storyboard", "title": "空分镜", "rows": []any{},
	})
	if _, err := prepareCloudAgentStoryboardCreate(s.repo, "user", canvas.ID, empty); err == nil {
		t.Fatal("empty storyboard was accepted")
	}

	forged := cloudAgentStoryboardCall(t, "canvas_create_storyboard", "forged", map[string]any{
		"snapshotHash": hash, "nodeId": "forged-storyboard", "title": "伪造分镜",
		"rows": []map[string]any{{"id": "forged-row", "durationSeconds": 3.0, "plotDescription": "测试"}},
	})
	if _, err := prepareCloudAgentStoryboardCreate(s.repo, "user", canvas.ID, forged); err == nil {
		t.Fatal("model-supplied row ID was accepted")
	}

	textDoc := map[string]any{"nodes": []map[string]any{{"id": "text-1", "type": "text", "metadata": map[string]any{"content": "普通文本"}}}, "connections": []any{}}
	raw, _ := json.Marshal(textDoc)
	stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
	before := stored.PayloadJSON
	stored.PayloadJSON = string(raw)
	if err := saveCreationCanvasWithHistory(s.repo, stored, before); err != nil {
		t.Fatal(err)
	}
	wrongType := cloudAgentStoryboardCall(t, "canvas_edit_storyboard", "wrong-type", map[string]any{
		"snapshotHash": cloudAgentCanvasHash(textDoc), "nodeId": "text-1", "action": "update", "rowId": rowID,
		"patch": map[string]any{"dialogue": "不应写入"},
	})
	if _, err := prepareCloudAgentStoryboardEdit(s.repo, "user", canvas.ID, wrongType); err == nil || !strings.Contains(err.Error(), "不是分镜") {
		t.Fatalf("non-storyboard node was accepted: %v", err)
	}
}

func TestCloudAgentStoryboardCreateUsesRuntimeApprovalPath(t *testing.T) {
	s, canvas := cloudAgentStoryboardFixture(t)
	req := agentTestRequest()
	req.PermissionMode = "request_approval"
	req.IdempotencyKey = "storyboard-approval"
	root, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(canvas.PayloadJSON)
	call := cloudAgentStoryboardCall(t, "canvas_create_storyboard", "storyboard-approved-call", map[string]any{
		"snapshotHash": cloudAgentCanvasHash(doc),
		"nodeId":       "approved-storyboard",
		"title":        "待审批分镜",
		"rows":         []map[string]any{{"durationSeconds": 4.0, "plotDescription": "审批后写入的镜头"}},
	})
	run, err := s.repo.CloudAgent("user", root.ID)
	if err != nil {
		t.Fatal(err)
	}
	state, err := cloudAgentDecode(run)
	if err != nil {
		t.Fatal(err)
	}
	state.ActiveTaskID = ""
	state.Calls = []cloudAgentCall{call}
	state.CallIndex = 0
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	run, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(run)
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if waiting.Status != "waiting_approval" || waiting.Approval == nil || waiting.Approval.Preview.Items[0].Operation != "create_storyboard" {
		t.Fatalf("storyboard write bypassed or lost approval preview: %+v", waiting)
	}
	stored, _ := s.repo.CanvasProjectForUser("user", canvas.ID)
	if strings.Contains(stored.PayloadJSON, "approved-storyboard") {
		t.Fatal("storyboard was written before approval")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", "确认创建"); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ = s.repo.CanvasProjectForUser("user", canvas.ID)
	if !strings.Contains(stored.PayloadJSON, "approved-storyboard") || !strings.Contains(stored.PayloadJSON, "审批后写入的镜头") {
		t.Fatalf("approved storyboard was not written: %s", stored.PayloadJSON)
	}
}
