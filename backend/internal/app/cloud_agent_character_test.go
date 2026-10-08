package app

import (
	"encoding/json"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func seedCloudAgentCharacter(t *testing.T, db *gorm.DB, canvasID string) map[string]any {
	t.Helper()
	node := map[string]any{
		"id": "character-card", "type": "text", "title": "扶颦",
		"metadata": map[string]any{
			"workflowKind": "character", "characterAssetId": "character-asset",
			"characterVersionPolicy": "current", "characterDefinition": map[string]any{"appearance": "UNTRUSTED_METADATA"},
		},
	}
	for _, item := range []any{
		&model.Project{ID: "character-project", UserID: "user", Name: "短剧"},
		&model.Asset{ID: "character-asset", UserID: "user", Category: model.AssetCategoryCharacter, Kind: "entity", Title: "扶颦", Status: model.AssetVersionStatusConfirmed, PrimaryVersionID: "character-v2"},
		&model.ProjectAssetLink{ID: "character-link", ProjectID: "character-project", AssetID: "character-asset"},
		&model.AssetVersion{ID: "character-v1", AssetID: "character-asset", Version: 1, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"appearance":"第一版红衣"}`},
		&model.AssetVersion{ID: "character-v2", AssetID: "character-asset", Version: 2, Status: model.AssetVersionStatusConfirmed, DefinitionJSON: `{"role":"女主角","appearance":"三岁幼童，乌黑大眼睛","clothing":"黑红小裙","voiceTimbre":"稚嫩童声"}`},
		&model.AssetRepresentation{ID: "character-representation", AssetVersionID: "character-v2", ResourceID: "character-image", MediaType: "image", Role: "turnaround_sheet"},
		&model.Resource{ID: "character-image", UserID: "user", Kind: "image", Status: model.ResourceStatusReady, MimeType: "image/png", Size: 123, Width: 720, Height: 720},
		&model.VoiceProfile{ID: "character-voice", UserID: "user", Name: "扶颦声音", Provider: "openai_compatible", VoiceKey: "test-voice", Status: "active", Timbre: "稚嫩童声", CompatibleModelsJSON: `[]`},
		&model.CharacterVoiceBinding{ID: "character-voice-binding", AssetVersionID: "character-v2", VoiceProfileID: "character-voice", Instructions: "轻声说话"},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvasID).Update("project_id", "character-project").Error; err != nil {
		t.Fatal(err)
	}
	return node
}

func TestCloudAgentCharacterReadUsesAuthorizedAssetNotEmptyTextContent(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	node := seedCloudAgentCharacter(t, db, "agent-canvas")
	doc := map[string]any{"nodes": []any{node}, "connections": []any{}}
	view, err := cloudAgentCanvasState(service.repo, "user", "agent-canvas", doc, 0, []string{"character-card"}, 0)
	if err != nil {
		t.Fatal(err)
	}
	character := view.(map[string]any)["nodes"].([]any)[0].(map[string]any)["character"].(map[string]any)
	definition := character["definition"].(map[string]any)
	if character["versionId"] != "character-v2" || character["visualStatus"] != "ready" || character["voiceStatus"] != "ready" || definition["appearance"] != "三岁幼童，乌黑大眼睛" {
		t.Fatalf("character read missed project asset: %#v", character)
	}
	if character["imageReference"].(map[string]any)["ready"] != true || character["audioReference"].(map[string]any)["ready"] != true {
		t.Fatalf("character media references are not ready: %#v", character)
	}
	representations := character["representations"].([]map[string]any)
	if len(representations) != 1 || representations[0]["resourceId"] != "character-image" {
		t.Fatalf("character representation details missing: %#v", representations)
	}
	encoded, _ := json.Marshal(view)
	if strings.Contains(string(encoded), "UNTRUSTED_METADATA") {
		t.Fatal("read exposed untrusted canvas metadata")
	}
	meta := node["metadata"].(map[string]any)
	meta["characterVersionPolicy"], meta["characterVersionId"] = "pinned", "character-v1"
	pinned, err := cloudAgentResolveCharacter(service.repo, "user", "character-project", node)
	if err != nil || pinned.Card.VersionID != "character-v1" || pinned.Card.Definition["appearance"] != "第一版红衣" {
		t.Fatalf("pinned read = %#v, %v", pinned, err)
	}
	meta["characterVersionId"] = "foreign-v1"
	if err := db.Create(&model.AssetVersion{ID: "foreign-v1", AssetID: "other-asset", Version: 1, DefinitionJSON: `{}`}).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := cloudAgentResolveCharacter(service.repo, "user", "character-project", node); err == nil {
		t.Fatal("cross-asset pinned version accepted")
	}
	meta["characterVersionPolicy"] = "current"
	if _, err := cloudAgentResolveCharacter(service.repo, "other-user", "character-project", node); err == nil {
		t.Fatal("cross-user read accepted")
	}
}

func TestCloudAgentCharacterDraftUsesCanvasRolesAndProviderImageSlots(t *testing.T) {
	service, db, args := agentMediaFixture(t)
	node := seedCloudAgentCharacter(t, db, "agent-canvas")
	canvas, err := service.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	doc["nodes"] = append(doc["nodes"].([]any), node)
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	args.ReferenceNodeIDs = []string{"character-card"}
	args.Prompt = "Keep the face and clothing consistent with @图片1."
	args.SnapshotHash = cloudAgentCanvasHash(doc)
	run, state := agentMediaRun(t, service, args, "request_approval")
	request, _, err := service.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	if err := service.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, err := service.repo.CanvasProjectForUser("user", canvas.ID)
	if err != nil {
		t.Fatal(err)
	}
	storedDoc, _ := creationDocument(stored.PayloadJSON)
	nodes, _ := creationObjects(storedDoc["nodes"])
	metadata := nodes[args.NodeID]["metadata"].(map[string]any)
	if !strings.Contains(stringValue(metadata["composerContent"]), "@角色1") || strings.Contains(stringValue(metadata["composerContent"]), "@图片1") {
		t.Fatalf("character draft kept provider slot labels: %#v", metadata["composerContent"])
	}
	if !strings.Contains(request.Prompt, "@图片1") || strings.Contains(request.Prompt, "@角色1") {
		t.Fatalf("provider slot labels changed: %q", request.Prompt)
	}
	approveAgentMediaDraft(t, service, run.ID)
	storedRun, err := service.repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	approvedState, err := cloudAgentDecode(storedRun)
	if err != nil {
		t.Fatal(err)
	}
	task, err := service.repo.TaskForUser("user", approvedState.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	if !strings.Contains(task.Prompt, "@图片1") || strings.Contains(task.Prompt, "@角色1") {
		t.Fatalf("approved task lost provider image slots: %q", task.Prompt)
	}
}

func TestCloudAgentCharacterReferenceUsesDefinitionAndTurnaround(t *testing.T) {
	service, db, args := agentMediaFixture(t)
	node := seedCloudAgentCharacter(t, db, "agent-canvas")
	canvas, err := service.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	doc["nodes"] = append(doc["nodes"].([]any), node)
	raw, _ := json.Marshal(doc)
	if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	args.ReferenceNodeIDs = []string{"character-card"}
	args.SnapshotHash = cloudAgentCanvasHash(doc)
	run, state := agentMediaRun(t, service, args, "request_approval")
	request, plan, err := service.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	images := creationMaps(request.Input["referenceImages"])
	if len(images) != 1 || images[0]["storageKey"] != "resource:character-image" || images[0]["id"] != "character-card" {
		t.Fatalf("missing real image reference: %#v", images)
	}
	if !strings.Contains(request.Prompt, "三岁幼童，乌黑大眼睛") || strings.Contains(request.Prompt, "UNTRUSTED_METADATA") || plan.Args.CharacterVersions["character-card"] != "character-v2" {
		t.Fatalf("missing real character definition or version: %q %#v", request.Prompt, plan.Args.CharacterVersions)
	}
	if intent, err := service.cloudAgentModelIntent("user", canvas.ID, `{"mode":"video","referenceNodeIds":["character-card"]}`); err != nil || intent == nil {
		t.Fatalf("model list did not recognize character image: %#v, %v", intent, err)
	}
	textOnly := args
	textOnly.ReferenceNodeIDs = nil
	textOnly.SourceNodeID = "character-card"
	textRequest, _, err := service.prepareCloudAgentMedia(run, &state, agentMediaCall(textOnly))
	if err != nil || !strings.Contains(textRequest.Prompt, "三岁幼童，乌黑大眼睛") || len(creationMaps(textRequest.Input["referenceImages"])) != 0 {
		t.Fatalf("text-only character reference = %q, %v", textRequest.Prompt, err)
	}
	prepared := &cloudAgentPreparedMedia{Version: 1, Hash: "test", DependencyHash: "", CharacterVersions: plan.Args.CharacterVersions, Quote: cloudAgentMediaQuote{ExpiresAt: time.Now().Add(time.Minute)}}
	prepared.DependencyHash, err = cloudAgentMediaDependencyHash(doc, plan.Args)
	if err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Asset{}).Where("id = ?", "character-asset").Update("primary_version_id", "character-v1").Error; err != nil {
		t.Fatal(err)
	}
	if err := validateCloudAgentPreparedAdmission(service.repo, "user", prepared, &model.Task{ProjectID: canvas.ID}, nil, doc, plan.Args); err == nil || !strings.Contains(err.Error(), "角色卡版本已变化") {
		t.Fatalf("approved character version drift not rejected: %v", err)
	}
}

func TestCloudAgentCharacterCardIsRegisteredCapability(t *testing.T) {
	node := map[string]any{"id": "hero", "type": "text", "title": "扶颦", "metadata": map[string]any{"workflowKind": "character", "characterAssetId": "character-asset"}}
	descriptor, ok := cloudAgentNodeCapabilityForNode(node)
	if !ok || descriptor.Type != "character" || descriptor.InputKind != "character" || !descriptor.Connection.CanReference {
		t.Fatalf("character node did not resolve to character capability: %#v, %v", descriptor, ok)
	}
	if plain, _ := cloudAgentNodeCapabilityForNode(map[string]any{"id": "note", "type": "text"}); plain.Type != "text" {
		t.Fatalf("plain text node resolved to %q", plain.Type)
	}
	if _, creatable := cloudAgentNodeCapabilityForType("character"); creatable {
		t.Fatal("character variant must not be resolvable as a creatable node type")
	}
	if err := validateCreationOps([]CreationCanvasOp{{Type: "add_node", ID: "new", NodeType: "character"}}); err == nil {
		t.Fatal("agent must not create character cards from nothing")
	}

	nodes := []map[string]any{node, {"id": "video", "type": "video"}, {"id": "image", "type": "image"}, {"id": "audio", "type": "audio"}, {"id": "note", "type": "text"}}
	for _, target := range []string{"video", "image", "audio"} {
		if err := validateCloudAgentConnection(nodes, "hero", target); err != nil {
			t.Fatalf("character card cannot feed %s: %v", target, err)
		}
	}
	if err := validateCloudAgentConnection(nodes, "hero", "note"); err == nil {
		t.Fatal("character card connected to a non-generation text node")
	}
	// 角色卡设定只随角色资产版本变化，Agent 不能把节点正文或标题当成角色设定改写。
	if err := descriptor.ValidatePatch(map[string]any{"content": "改写设定"}); err == nil {
		t.Fatal("character card accepted content patch")
	}
	if err := descriptor.ValidatePatch(map[string]any{"x": 10.0, "y": 20.0}); err != nil {
		t.Fatalf("character card cannot move: %v", err)
	}

	guide := cloudAgentCapabilityGuide()
	if !strings.Contains(guide, "角色卡（character）") || !strings.Contains(guide, "workflowKind=character") {
		t.Fatalf("capability guide does not introduce character cards: %s", guide)
	}
	view, err := cloudAgentCanvasState(nil, "user", "agent-canvas", map[string]any{"nodes": []any{node}, "connections": []any{}}, 0, nil, 0)
	if err != nil {
		t.Fatal(err)
	}
	item := view.(map[string]any)["nodes"].([]any)[0].(map[string]any)
	if item["kind"] != "character" || item["agentSupported"] == false {
		t.Fatalf("canvas read does not expose character kind: %#v", item)
	}
}
