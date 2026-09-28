package app

import (
	"encoding/json"
	"fmt"
	"reflect"
	"strings"
	"testing"

	"infinite-canvas/backend/internal/canvas/capability"
	"infinite-canvas/backend/internal/model"
)

func TestCloudAgentMixedCanvasReadsUnsupportedNodesWithoutGrantingCapabilities(t *testing.T) {
	nodes := []map[string]any{{"id": "text", "type": "text", "metadata": map[string]any{"content": "readable"}}}
	for _, kind := range []string{"ai-art-critique", "config", "drawing", "future-plugin"} {
		nodes = append(nodes, map[string]any{"id": kind, "type": kind, "title": "插件节点", "position": map[string]any{"x": 10.0, "y": 20.0}, "metadata": map[string]any{"content": "PRIVATE_SENTINEL", "apiKey": "PRIVATE_SENTINEL"}})
		if _, supported := cloudAgentNodeCapabilityForType(kind); supported {
			t.Fatalf("unsupported type gained write capability: %s", kind)
		}
		if err := validateCreationOps([]CreationCanvasOp{{Type: "add_node", ID: "new", NodeType: kind}}); err == nil {
			t.Fatalf("unsupported creation accepted: %s", kind)
		}
		if _, _, err := cloudAgentReferenceDescriptor(nodes[len(nodes)-1]); err == nil {
			t.Fatalf("unsupported media reference accepted: %s", kind)
		}
		if err := validateCloudAgentConnection(nodes, kind, "text"); err == nil {
			t.Fatalf("unsupported connection accepted: %s", kind)
		}
	}
	doc := map[string]any{"nodes": nodes, "connections": []map[string]any{{"id": "edge", "fromNodeId": "drawing", "toNodeId": "text"}}}
	raw, _ := json.Marshal(doc)
	summary, err := cloudAgentCanvasSummary(&model.CanvasProject{PayloadJSON: string(raw)})
	if err != nil || strings.Contains(summary, "PRIVATE_SENTINEL") || !strings.Contains(summary, `"agentSupported":false`) {
		t.Fatalf("mixed summary failed or leaked metadata: %v", err)
	}
	for _, ids := range [][]string{nil, {"drawing", "config"}} {
		view, err := cloudAgentCanvasState(nil, "user", "agent-canvas", doc, 0, ids, 0)
		if err != nil {
			t.Fatal(err)
		}
		result := view.(map[string]any)
		encoded, _ := json.Marshal(result)
		if strings.Contains(string(encoded), "PRIVATE_SENTINEL") || result["snapshotHash"] != cloudAgentCanvasHash(doc) || len(result["connections"].([]any)) != 1 {
			t.Fatal("unsafe projection or lost snapshot/connection")
		}
		want := len(nodes)
		if ids != nil {
			want = len(ids)
		}
		if len(result["nodes"].([]any)) != want {
			t.Fatal("nodes silently omitted")
		}
	}
}

func TestCloudAgentCanvasSummaryIsACatalogNotNodeBodies(t *testing.T) {
	body := strings.Repeat("镜", 4000)
	nodes := make([]map[string]any, 0, 200)
	for index := 0; index < 200; index++ {
		nodes = append(nodes, map[string]any{
			"id":    fmt.Sprintf("node-%d", index),
			"type":  "text",
			"title": fmt.Sprintf("镜头 %d %s", index, strings.Repeat("标题", 40)),
			"metadata": map[string]any{
				"content": body, "prompt": "PRIVATE_PROMPT", "apiKey": "PRIVATE_SENTINEL",
			},
		})
	}
	raw, err := json.Marshal(map[string]any{"nodes": nodes})
	if err != nil {
		t.Fatal(err)
	}
	summary, err := cloudAgentCanvasSummary(&model.CanvasProject{Title: "大画布", PayloadJSON: string(raw)})
	if err != nil {
		t.Fatalf("large canvas catalog rejected: %v", err)
	}
	if strings.Contains(summary, body[:40]) || strings.Contains(summary, "PRIVATE_PROMPT") || strings.Contains(summary, "PRIVATE_SENTINEL") || strings.Contains(summary, `"content"`) {
		t.Fatal("catalog leaked node bodies or metadata")
	}
	var parsed map[string]any
	if err := json.Unmarshal([]byte(summary), &parsed); err != nil {
		t.Fatal(err)
	}
	if parsed["kind"] != "node_catalog" || parsed["totalNodes"] != float64(200) {
		t.Fatalf("catalog identity = %+v", parsed)
	}
	included, _ := parsed["includedNodes"].(float64)
	omitted, _ := parsed["omittedNodes"].(float64)
	if included <= 0 || omitted <= 0 || int(included+omitted) != 200 || included > float64(cloudAgentCanvasSummaryMaxNodes) {
		t.Fatalf("expected a bounded catalog, included=%v omitted=%v", included, omitted)
	}
	if len(summary) > cloudAgentCanvasSummaryBudgetBytes+4096 {
		t.Fatalf("catalog still carries canvas-sized payload: %d", len(summary))
	}
}

func TestCloudAgentCanvasSummaryUsesSelectedNodeNeighborhood(t *testing.T) {
	doc := map[string]any{
		"nodes": []map[string]any{
			{"id": "focus", "type": "text", "title": "主体"},
			{"id": "neighbor", "type": "image", "title": "关联素材"},
			{"id": "unrelated", "type": "text", "title": "无关内容"},
		},
		"connections": []map[string]any{{"fromNodeId": "focus", "toNodeId": "neighbor"}},
	}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	summary, err := cloudAgentCanvasSummary(&model.CanvasProject{PayloadJSON: string(raw)}, "focus")
	if err != nil {
		t.Fatal(err)
	}
	var result map[string]any
	if err := json.Unmarshal([]byte(summary), &result); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(result["nodes"])
	if strings.Contains(string(encoded), "unrelated") || !strings.Contains(string(encoded), "focus") || !strings.Contains(string(encoded), "neighbor") {
		t.Fatalf("focused catalog did not include exactly the local graph neighborhood: %s", encoded)
	}
	selection := result["selection"].(map[string]any)
	if selection["includedNeighbors"] != float64(1) || selection["nextReadDepth"] != float64(1) {
		t.Fatalf("focused catalog metadata is incorrect: %+v", selection)
	}
	if _, err := cloudAgentCanvasSummary(&model.CanvasProject{PayloadJSON: string(raw)}, "deleted"); err == nil {
		t.Fatal("stale selected node was accepted")
	}
}

func TestCloudAgentToolsFollowCanvasCapabilityRegistry(t *testing.T) {
	req := agentTestRequest()
	req.PermissionMode = "auto"
	req.ContextScope = []string{"canvas"}
	req.Budget.MaxGenerationTasks = 1
	functions := map[string]map[string]any{}
	for _, tool := range cloudAgentTools(req) {
		function := tool["function"].(map[string]any)
		functions[function["name"].(string)] = function["parameters"].(map[string]any)
	}
	apply := functions["canvas_apply_ops"]
	if apply == nil {
		t.Fatal("canvas write tool is missing")
	}
	ops := apply["properties"].(map[string]any)["ops"].(map[string]any)["items"].(map[string]any)["properties"].(map[string]any)
	if got := ops["nodeType"].(map[string]any)["enum"]; !reflect.DeepEqual(got, canvasCapabilityRegistry.Types()) {
		t.Fatalf("node types differ from registry: %v", got)
	}
	patch := ops["patch"].(map[string]any)["properties"].(map[string]any)
	nodeTypes := cloudAgentNodeTypes()["nodes"].([]map[string]any)
	nodeTypeDefinitions := map[string]map[string]any{}
	for _, item := range nodeTypes {
		nodeTypeDefinitions[item["type"].(string)] = item
	}
	for _, descriptor := range canvasCapabilityRegistry.List() {
		if !descriptor.CanUpdate && len(descriptor.PatchFields) != 0 {
			t.Fatalf("non-updateable capability %s declares dead patch fields", descriptor.Type)
		}
		for key, field := range descriptor.PatchFields {
			property, ok := patch[key].(map[string]any)
			if !ok || property["type"] != field.Kind {
				t.Fatalf("patch field %s (%s) missing from tool schema", key, descriptor.Type)
			}
			definitions, _ := nodeTypeDefinitions[descriptor.Type]["updateFields"].(map[string]any)
			definition, _ := definitions[key].(map[string]any)
			if field.Label == "" || definition["label"] != field.Label {
				t.Fatalf("patch field %s (%s) has no stable user-facing label", key, descriptor.Type)
			}
		}
	}
	if got := functions["generate_media"]["properties"].(map[string]any)["mode"].(map[string]any)["enum"]; !reflect.DeepEqual(got, cloudAgentGenerationModeNames()) {
		t.Fatalf("generation modes differ from implemented adapters: %v", got)
	}
	if got := CloudAgentCapabilitySetInfo(); got.Hash != canvasCapabilityRegistry.Hash() || got.Version != capability.SetVersion || !reflect.DeepEqual(got.Nodes, canvasCapabilityRegistry.Types()) {
		t.Fatalf("capability endpoint info differs from registry: %+v", got)
	}
}

func TestCloudAgentImageEditingToolsRespectPermissionBoundaries(t *testing.T) {
	readOnly := agentTestRequest()
	readOnly.PermissionMode = "read_only"
	readOnly.ContextScope = []string{"canvas"}
	readNames := map[string]bool{}
	for _, tool := range cloudAgentTools(readOnly) {
		readNames[tool["function"].(map[string]any)["name"].(string)] = true
	}
	for _, name := range []string{"image_text_detect", "image_annotation_render"} {
		if !readNames[name] {
			t.Fatalf("read-only tool %s missing", name)
		}
	}
	if readNames["image_layer_split"] {
		t.Fatal("image_layer_split must not be exposed in read-only mode")
	}

	write := readOnly
	write.PermissionMode = "auto"
	write.Budget.MaxGenerationTasks = 1
	writeNames := map[string]bool{}
	for _, tool := range cloudAgentTools(write) {
		writeNames[tool["function"].(map[string]any)["name"].(string)] = true
	}
	if !writeNames["image_layer_split"] || !cloudAgentWrite("image_layer_split") {
		t.Fatal("image_layer_split must be an approved write tool")
	}
	if got := cloudAgentMediaCall(cloudAgentCall{Function: struct {
		Name      string `json:"name"`
		Arguments string `json:"arguments"`
	}{Name: "image_layer_split", Arguments: `{"prompt":"split"}`}}); got.Function.Name != "image_layer_split" || !strings.Contains(got.Function.Arguments, `"mode":"image"`) {
		t.Fatalf("image layer split was not normalized to image media: %+v", got.Function)
	}
}

func TestCloudAgentAnnotationRenderFeedsControlledTransientReference(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	canvas := &model.CanvasProject{ID: "annotation-canvas", UserID: "user", PayloadJSON: `{"nodes":[{"id":"image-1","type":"image","title":"原图","width":640,"height":480,"metadata":{"content":"saved"}}],"connections":[]}`}
	if err := db.Create(canvas).Error; err != nil {
		t.Fatal(err)
	}
	state := &cloudAgentRuntime{RuntimeRunID: "annotation-run", Request: CloudAgentRequest{CanvasID: canvas.ID}, TransientReferences: map[string]cloudAgentTransientReference{}}
	call := cloudAgentCall{ID: "call-annotation"}
	call.Function.Name = "image_annotation_render"
	call.Function.Arguments = `{"nodeId":"image-1","annotations":[{"label":"主体","x":0.5,"y":0.5}]}`
	result, err := cloudAgentReadTool(s.repo, "user", state, call, s)
	if err != nil {
		t.Fatal(err)
	}
	view := result.(map[string]any)
	refID := stringValue(view["referenceTransientId"])
	ref, ok := state.TransientReferences[refID]
	if !ok || ref.ResourceID == "" || ref.ExpiresAt.IsZero() {
		t.Fatalf("annotation transient reference missing or unsafe: %#v", state.TransientReferences)
	}
	resultJSON, _ := json.Marshal(result)
	if !strings.Contains(string(resultJSON), "image/png") {
		t.Fatalf("annotation result must advertise PNG reference: %s", resultJSON)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	args := cloudAgentMediaArgs{Mode: "image", Prompt: "按标注编辑", SnapshotHash: cloudAgentMediaContentHash(doc), NodeID: "result-image", Title: "编辑结果", Size: "1:1", ReferenceTransientIDs: []string{refID}}
	_, _, refs, err := cloudAgentMediaDocument(s.repo, "user", canvas.ID, args, state.TransientReferences)
	if err != nil {
		t.Fatal(err)
	}
	images, ok := refs["referenceImages"].([]any)
	if !ok || len(images) != 1 || stringValue(images[0].(map[string]any)["id"]) != refID {
		t.Fatalf("controlled transient reference was not forwarded: %#v", refs)
	}
}

func TestCloudAgentPolicyPublishesSkillManifestWithoutInliningSkillBody(t *testing.T) {
	skill := cloudAgentSkill{ID: "skill-1", Name: "任务技能", Description: "当用户要写短剧剧本时调用", Version: "v1", Hash: agentProfileHash("skill"), Instruction: "PRIVATE_SKILL_BODY", Files: map[string]string{"references/a.md": "A"}}
	text, _, err := compileCloudAgentPolicies(agentTestRequest(), []cloudAgentSkill{skill}, "", cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, skill.Instruction) || !strings.Contains(text, `"entryPath":"SKILL.md"`) || !strings.Contains(text, `"files":["SKILL.md","references/a.md"]`) || !strings.Contains(text, `"description":"当用户要写短剧剧本时调用"`) {
		t.Fatalf("compiled policy did not publish a safe on-demand skill manifest: %s", text)
	}
}

func TestCloudAgentPolicyTruncatesOversizedSkillDescription(t *testing.T) {
	long := strings.Repeat("描", 600)
	skill := cloudAgentSkill{ID: "skill-2", Name: "长描述技能", Description: long, Version: "v1", Hash: agentProfileHash("skill2")}
	text, _, err := compileCloudAgentPolicies(agentTestRequest(), []cloudAgentSkill{skill}, "", cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")})
	if err != nil {
		t.Fatal(err)
	}
	if strings.Contains(text, long) || !strings.Contains(text, strings.Repeat("描", 500)+"…") {
		t.Fatalf("oversized skill description was not capped at 500 runes: %s", text)
	}
}

func TestCloudAgentPolicyPublishesCapabilityRoutingGuide(t *testing.T) {
	text, _, err := compileCloudAgentPolicies(agentTestRequest(), nil, "", cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{
		"节点能力速查",
		"由服务端能力注册表生成",
		"分镜脚本（script）",
		"多镜头",
		"逐镜审查",
		"后续维护",
		"单画面、一次性说明或快速试验优先轻量节点",
		"普通文本或 Markdown 不能伪装成结构化分镜",
		"不为形式强制使用任何节点",
	} {
		if !strings.Contains(text, expected) {
			t.Fatalf("compiled policy omitted capability routing guidance %q: %s", expected, text)
		}
	}
}

func TestCloudAgentGenerationAdapterRejectsUnimplementedMode(t *testing.T) {
	original := canvasCapabilityRegistry
	defer func() { canvasCapabilityRegistry = original }()
	descriptors := original.List()
	descriptors = append(descriptors, capability.Descriptor{
		Type: "table", Version: "1", Label: "多维表格", DefaultWidth: 640, DefaultHeight: 400,
		InputKind: "table_data", GenerationMode: "table-render",
	})
	registry, err := capability.NewRegistry(descriptors)
	if err != nil {
		t.Fatal(err)
	}
	canvasCapabilityRegistry = registry
	if descriptor, ok := cloudAgentNodeCapabilityForGenerationMode("table-render"); !ok || descriptor.Type != "table" {
		t.Fatal("hypothetical new mode did not resolve its canvas descriptor")
	}
	if cloudAgentGenerationModeSupported("table-render") || cloudAgentMediaOperation("table-render", nil) != "" {
		t.Fatal("unimplemented mode may create a billable task")
	}
	for _, mode := range cloudAgentGenerationModeNames() {
		if mode == "table-render" {
			t.Fatal("unimplemented billing mode appeared in the tool schema")
		}
	}
	if err := validateCloudAgentMediaReferences("table-render", nil); err == nil {
		t.Fatal("unimplemented mode accepted media references")
	}
	for _, mode := range cloudAgentGenerationModeNames() {
		if _, ok := cloudAgentNodeCapabilityForGenerationMode(mode); !ok || cloudAgentMediaOperation(mode, nil) == "" {
			t.Fatalf("exposed mode %s lacks a node or task adapter", mode)
		}
	}
}

func TestCloudAgentProfileProjectScopeDoesNotSilentlyDiscardCanvas(t *testing.T) {
	if err := validateAgentProfileScope(AgentProfileRequest{Scope: "project", ProjectID: "p1", CanvasID: "c1"}); err == nil {
		t.Fatal("project profile accepted a canvas ID that would be silently discarded")
	}
}

func TestCloudAgentProjectionRejectsMissingAdapterAndOpaqueMetadata(t *testing.T) {
	node := map[string]any{"id": "n1", "type": "text", "title": "镜头"}
	meta := map[string]any{"content": "公开正文", "storageKey": "resource:private", "url": "https://private.example/test", "status": "idle"}
	descriptor, _ := cloudAgentNodeCapabilityForType("text")
	projected, err := cloudAgentProjectNodeFields(node, meta, descriptor, descriptor.DetailFields, 16000, true, 0)
	if err != nil || projected["content"] != "公开正文" || projected["storageKey"] != nil || projected["url"] != nil {
		t.Fatalf("unsafe or incomplete projection: %v, %v", projected, err)
	}
	descriptor.ProjectionField = "storyboard"
	descriptor.ProjectionKind = "unregistered-projector"
	descriptor.DetailFields = []string{"storyboard"}
	meta["storyboard"] = map[string]any{"rows": []any{}}
	if _, err := cloudAgentProjectNodeFields(node, meta, descriptor, descriptor.DetailFields, 16000, true, 0); err == nil {
		t.Fatal("unregistered structured projector must fail closed")
	}
}

func TestCloudAgentCanvasStateDoesNotForwardUnknownObjectFields(t *testing.T) {
	doc := map[string]any{"nodes": []map[string]any{{
		"id": "safe", "type": "text", "title": "镜头",
		"position": map[string]any{"x": 10.0, "y": 20.0, "storageKey": "resource:secret"},
		"width":    200.0, "metadata": map[string]any{"status": map[string]any{"url": "https://secret.invalid"}, "content": "画面内容"},
	}}}
	view, err := cloudAgentCanvasState(nil, "user", "agent-canvas", doc, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	item := view.(map[string]any)["nodes"].([]any)[0].(map[string]any)
	if item["status"] != nil || item["position"].(map[string]any)["storageKey"] != nil || item["content"] != "画面内容" {
		t.Fatalf("unsafe object fields leaked into model context: %v", item)
	}
}

func TestCloudAgentDurablePolicySnapshotRejectsMissingOrUnsupportedContracts(t *testing.T) {
	_, snapshot, err := compileCloudAgentPolicies(agentTestRequest(), nil, "", cloudAgentProfileSnapshot{Revision: agentProfileRevision(nil), Hash: agentProfileHash("")})
	if err != nil || validateCloudAgentPolicySnapshot(snapshot) != nil {
		t.Fatalf("valid policy snapshot rejected: %v", err)
	}
	tests := []struct {
		name   string
		mutate func(*cloudAgentPolicySnapshot)
	}{
		{"missing compiler", func(p *cloudAgentPolicySnapshot) { p.CompilerVersion = "" }},
		{"unsupported compiler", func(p *cloudAgentPolicySnapshot) { p.CompilerVersion = "future" }},
		{"missing system id", func(p *cloudAgentPolicySnapshot) { p.SystemPolicyID = "" }},
		{"missing system hash", func(p *cloudAgentPolicySnapshot) { p.SystemPolicyHash = "" }},
		{"missing media id", func(p *cloudAgentPolicySnapshot) { p.MediaPolicyID = "" }},
		{"missing media hash", func(p *cloudAgentPolicySnapshot) { p.MediaPolicyHash = "" }},
		{"missing capability version", func(p *cloudAgentPolicySnapshot) { p.CapabilitySetVersion = "" }},
		{"missing capability hash", func(p *cloudAgentPolicySnapshot) { p.CapabilitySetHash = "" }},
		{"invalid reasoning", func(p *cloudAgentPolicySnapshot) { p.ReasoningMode = "enabled" }},
		{"missing profile revision", func(p *cloudAgentPolicySnapshot) { p.ProfileRevision = "" }},
		{"invalid profile hash", func(p *cloudAgentPolicySnapshot) { p.ProfileHash = "not-sha256" }},
		{"changed system contents", func(p *cloudAgentPolicySnapshot) { p.SystemPolicyHash = agentProfileHash("different system") }},
		{"changed media contents", func(p *cloudAgentPolicySnapshot) { p.MediaPolicyHash = agentProfileHash("different media") }},
		{"changed canvas contract", func(p *cloudAgentPolicySnapshot) { p.CapabilitySetHash = agentProfileHash("different capabilities") }},
	}
	for _, test := range tests {
		t.Run(test.name, func(t *testing.T) {
			corrupt := snapshot
			test.mutate(&corrupt)
			if err := validateCloudAgentPolicySnapshot(corrupt); err == nil {
				t.Fatal("corrupted durable policy snapshot was accepted")
			}
		})
	}
}

func TestCloudAgentCanvasStateIncludesBoundedRelatedComponent(t *testing.T) {
	doc := map[string]any{
		"nodes": []map[string]any{
			{"id": "upstream", "type": "text", "title": "上游"},
			{"id": "focus", "type": "text", "title": "焦点"},
			{"id": "downstream", "type": "text", "title": "下游"},
			{"id": "unrelated", "type": "text", "title": "无关"},
		},
		"connections": []map[string]any{
			{"id": "e1", "fromNodeId": "upstream", "toNodeId": "focus"},
			{"id": "e2", "fromNodeId": "focus", "toNodeId": "downstream"},
		},
	}
	view, err := cloudAgentCanvasStateWithRelated(nil, "user", "canvas", doc, 0, []string{"focus"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	result := view.(map[string]any)
	selection := result["selection"].(map[string]any)
	if selection["relationMode"] != "all" || selection["truncated"] != false || selection["selectedNodes"] != 3.0 && selection["selectedNodes"] != 3 {
		t.Fatalf("unexpected related selection: %#v", selection)
	}
	ids := map[string]bool{}
	for _, raw := range result["nodes"].([]any) {
		ids[raw.(map[string]any)["id"].(string)] = true
	}
	if ids["focus"] == false || ids["upstream"] == false || ids["downstream"] == false || ids["unrelated"] {
		t.Fatalf("related component selected wrong nodes: %#v", ids)
	}
	if len(result["connections"].([]any)) != 2 {
		t.Fatalf("related component lost edges: %#v", result["connections"])
	}
}

func TestCloudAgentCanvasStateRelatedComponentIsBounded(t *testing.T) {
	nodes := make([]map[string]any, 0, cloudAgentRelatedNodeLimit+32)
	edges := make([]map[string]any, 0, cloudAgentRelatedNodeLimit+32)
	nodes = append(nodes, map[string]any{"id": "focus", "type": "text", "title": "焦点"})
	for index := 0; index < cloudAgentRelatedNodeLimit+32; index++ {
		id := fmt.Sprintf("child-%d", index)
		nodes = append(nodes, map[string]any{"id": id, "type": "text", "title": id})
		edges = append(edges, map[string]any{"id": fmt.Sprintf("edge-%d", index), "fromNodeId": "focus", "toNodeId": id})
	}
	view, err := cloudAgentCanvasStateWithRelated(nil, "user", "canvas", map[string]any{"nodes": nodes, "connections": edges}, 0, []string{"focus"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	result := view.(map[string]any)
	selection := result["selection"].(map[string]any)
	if selection["truncated"] != true || selection["selectedNodes"] != float64(cloudAgentRelatedNodeLimit) && selection["selectedNodes"] != cloudAgentRelatedNodeLimit {
		t.Fatalf("related component should be truncated at %d: %#v", cloudAgentRelatedNodeLimit, selection)
	}
	if len(result["nodes"].([]any)) != cloudAgentRelatedNodeLimit {
		t.Fatalf("related component returned too many nodes: %d", len(result["nodes"].([]any)))
	}
}
