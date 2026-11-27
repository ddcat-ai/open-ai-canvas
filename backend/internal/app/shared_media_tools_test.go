package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/canvas/contract"
	"yingce/backend/internal/canvas/mediatool"
	"yingce/backend/internal/model"
)

func sharedMediaToolFixture(t *testing.T, operation string) (*Service, *gorm.DB, cloudAgentMediaArgs, *ModelCapabilityConfig) {
	t.Helper()
	s, db, a := agentMediaFixture(t)
	protocolID := map[string]string{"enhance": VolcengineMediaKitEnhanceVideoProtocol, "depth": VolcengineMediaKitVideoDepthProtocol, "upscale": "starrouter-comfly-video-upscale", "remove_subtitles": "starrouter-comfly-video-subtitle-removal"}[operation]
	profile := DefaultModelCapabilityConfigForModel(protocolID, "processing")
	if operation == "enhance" {
		profile.Video.Processing.FPSPolicy = VideoProcessingFPSUserSelect
		profile.Video.Processing.FPSOptions = []int{30, 60}
	}
	center, err := newPluginRuntime(s.dataDir)
	if err != nil {
		t.Fatal(err)
	}
	s.pluginRuntime = center
	for _, plugin := range center.list() {
		if strings.HasPrefix(plugin.Manifest.ID, "volcengine-mediakit") {
			if _, err := center.setEnabled(plugin.Manifest.ID, true); err != nil {
				t.Fatal(err)
			}
		}
	}
	cm := model.ChannelModel{ID: "processing-cm", ChannelID: "channel", ModelKey: "processing", DisplayName: "处理模型", Capability: "video", Protocol: model.ChannelInterfaceType(protocolID), CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: "per_second", PriceConfigured: true, Enabled: true}
	selector := `{"operation":"` + operation + `"}`
	if operation == "enhance" {
		selector = `{"operation":"enhance","vquality":"1080p","fpsBand":"le60"}`
	}
	tier := newSelectionPriceTier("processing-tier", selector, "", "per_second")
	tier.ChannelModelID = cm.ID
	for _, row := range []any{&cm, &tier, &model.Resource{ID: "source-video", UserID: "user", Kind: "video", Status: model.ResourceStatusReady, MimeType: "video/mp4", Width: 1280, Height: 720, Size: 2048, DurationMs: 12_500}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
	if err != nil {
		t.Fatal(err)
	}
	doc, _ := creationDocument(canvas.PayloadJSON)
	doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": "source-video-node", "type": "video", "title": "源视频", "metadata": map[string]any{"storageKey": "resource:source-video", "status": "success"}})
	raw, _ := json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	a = cloudAgentMediaArgs{Mode: "video", Operation: operation, ChannelID: "channel", ChannelModelKey: "processing", Title: "处理结果", NodeID: "processing-output", ReferenceNodeIDs: []string{"source-video-node"}, SnapshotHash: cloudAgentMediaContentHash(doc)}
	if operation == "enhance" {
		fps, bitrate, level := 60, 8000, "high"
		a.Quality = "1080p"
		a.ProcessingParameters = &mediatool.Parameters{FPS: &fps, Bitrate: &bitrate, BitrateLevel: &level}
	}
	return s, db, a, profile
}

func TestSharedMediaToolsPublicAdmissionChannelAndLogical(t *testing.T) {
	for _, operation := range mediatool.Operations() {
		for _, logical := range []bool{false, true} {
			t.Run(operation+map[bool]string{false: "/channel", true: "/logical"}[logical], func(t *testing.T) {
				s, db, args, profile := sharedMediaToolFixture(t, operation)
				if logical {
					spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
					if err != nil {
						t.Fatal(err)
					}
					encoded, _ := json.Marshal(spec)
					logicalModel := model.LogicalModel{ID: "processing-logical", Code: "processing-logical", Capability: "video", Enabled: true, ActiveRevisionID: "processing-revision", PricePolicy: "channel"}
					for _, row := range []any{&logicalModel, &model.LogicalModelRevision{ID: logicalModel.ActiveRevisionID, LogicalModelID: logicalModel.ID, Version: 1, CapabilitySpecJSON: string(encoded), DefaultOptionsJSON: `{}`}, &model.LogicalModelRoute{ID: "processing-route", LogicalModelRevisionID: logicalModel.ActiveRevisionID, ChannelModelID: "processing-cm", Enabled: true, Weight: 1}} {
						if err := db.Create(row).Error; err != nil {
							t.Fatal(err)
						}
					}
					features := defaultFeatureAvailability()
					features.FrontendModelsEnabled = true
					if _, err := s.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, features); err != nil {
						t.Fatal(err)
					}
					args.LogicalModelID, args.ChannelID, args.ChannelModelKey = logicalModel.ID, "", ""
				}
				run, state := agentMediaRun(t, s, args, "auto")
				req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
				if err != nil {
					t.Fatal(err)
				}
				req.creationPrepare = &creationTaskPreparation{}
				task, err := s.CreateTask("user", req)
				if err != nil {
					t.Fatal(err)
				}
				if err := applyCloudAgentResolvedMediaDefaults(&req, plan, task); err != nil {
					t.Fatal(err)
				}
				if task.Operation != operation || plan.Args.Duration != 13 {
					t.Fatalf("operation=%s duration=%d", task.Operation, plan.Args.Duration)
				}
				metadata := req.Input["metadata"].(map[string]any)
				if metadata[videoProcessingMetadataKey] != true {
					t.Fatalf("processing admission skipped: %#v", req.Input)
				}
				if operation == "enhance" {
					config := req.Input["config"].(map[string]any)
					if config["fpsBand"] != "le60" || plan.Args.ProcessingParameters.FPS == nil || *plan.Args.ProcessingParameters.FPS != 60 {
						t.Fatalf("lost processing parameters: %#v", req.Input)
					}
				}
				spec, err := cloudAgentGenerationSpec(plan.Args, req.Input, req.Input["config"].(map[string]any))
				if err != nil {
					t.Fatal(err)
				}
				encoded, _ := json.Marshal(spec)
				recovered, err := contract.Decode(encoded)
				if err != nil || recovered.Operation != operation || !reflect.DeepEqual(recovered.ProcessingParameters, plan.Args.ProcessingParameters) {
					t.Fatalf("spec recovery lost operation: %s %v", encoded, err)
				}
				if context := taskClientContext(task.InputJSON); context == nil || context.Operation != operation {
					t.Fatalf("public context lost operation: %#v", context)
				}
				var count int64
				db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
				if count != 0 {
					t.Fatal("dry admission submitted task")
				}
			})
		}
	}
}

func TestSharedMediaToolsLogicalOmittedFPSUsesSelectedModelDefault(t *testing.T) {
	s, db, args, profile := sharedMediaToolFixture(t, "enhance")
	profile.Video.Processing.FPSOptions = []int{60}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "processing-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
		t.Fatal(err)
	}
	spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "video")
	if err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(spec)
	logicalModel := model.LogicalModel{ID: "processing-logical", Code: "processing-logical", Capability: "video", Enabled: true, ActiveRevisionID: "processing-revision", PricePolicy: "channel"}
	for _, row := range []any{&logicalModel, &model.LogicalModelRevision{ID: logicalModel.ActiveRevisionID, LogicalModelID: logicalModel.ID, Version: 1, CapabilitySpecJSON: string(encoded), DefaultOptionsJSON: `{}`}, &model.LogicalModelRoute{ID: "processing-route", LogicalModelRevisionID: logicalModel.ActiveRevisionID, ChannelModelID: "processing-cm", Enabled: true, Weight: 1}} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	features := defaultFeatureAvailability()
	features.FrontendModelsEnabled = true
	if _, err := s.UpdateFeatureAvailability(&model.User{ID: "admin", Role: model.UserRoleAdmin}, features); err != nil {
		t.Fatal(err)
	}
	args.LogicalModelID, args.ChannelID, args.ChannelModelKey = logicalModel.ID, "", ""
	args.ProcessingParameters.FPS = nil
	run, state := agentMediaRun(t, s, args, "auto")
	req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	req.creationPrepare = &creationTaskPreparation{}
	task, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyCloudAgentResolvedMediaDefaults(&req, plan, task); err != nil {
		t.Fatal(err)
	}
	if req.Input["config"].(map[string]any)["fpsBand"] != "le60" || plan.Args.ProcessingParameters.FPS == nil || *plan.Args.ProcessingParameters.FPS != 60 {
		t.Fatalf("missing selected model fps default: %#v", req.Input)
	}
}

func TestSharedMediaToolsRestoreDraftProcessingFieldsBeforeSourceSelection(t *testing.T) {
	s, _, args, _ := sharedMediaToolFixture(t, "enhance")
	run, state := agentMediaRun(t, s, args, "auto")
	_, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if err := createCloudAgentMediaNode(s.repo, "user", "agent-canvas", plan, nil, policy); err != nil {
		t.Fatal(err)
	}
	args.Operation, args.ProcessingParameters, args.ReferenceNodeIDs, args.SnapshotHash, args.Prompt = "", nil, nil, "", ""
	_, restored, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	if restored.Args.Operation != "enhance" || !reflect.DeepEqual(restored.Args.ProcessingParameters, plan.Args.ProcessingParameters) || !reflect.DeepEqual(restored.Args.ReferenceNodeIDs, plan.Args.ReferenceNodeIDs) {
		t.Fatalf("lost draft processing fields: %+v", restored.Args)
	}
	fps := 30
	args.ProcessingParameters = &mediatool.Parameters{FPS: &fps}
	_, edited, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	if edited.Args.ProcessingParameters.FPS == nil || *edited.Args.ProcessingParameters.FPS != 30 {
		t.Fatal("explicit processing edit was overwritten")
	}
}

func TestSharedMediaToolsRejectPublicBypassesAndFreezeParameters(t *testing.T) {
	s, db, args, _ := sharedMediaToolFixture(t, "enhance")
	run, state := agentMediaRun(t, s, args, "auto")
	req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	req.creationPrepare = &creationTaskPreparation{}
	task, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyCloudAgentResolvedMediaDefaults(&req, plan, task); err != nil {
		t.Fatal(err)
	}
	state.Request.Budget.MaxVideoSeconds = 12
	if err := validateCloudAgentMediaBudget(plan.Args, &state); err == nil {
		t.Fatal("trusted source duration did not enforce budget")
	}
	before, err := cloudAgentResolvedMediaHash(task)
	if err != nil {
		t.Fatal(err)
	}
	var changed map[string]any
	_ = json.Unmarshal([]byte(task.InputJSON), &changed)
	changed["metadata"].(map[string]any)["providerOptions"] = map[string]any{"changed": map[string]any{"fps": 120}}
	encoded, _ := json.Marshal(changed)
	copyTask := *task
	copyTask.InputJSON = string(encoded)
	after, _ := cloudAgentResolvedMediaHash(&copyTask)
	if before == after {
		t.Fatal("provider execution options missing from approval hash")
	}
	for _, test := range []struct {
		name   string
		mutate func(map[string]any)
	}{
		{"foreign resource", func(input map[string]any) {
			input["referenceVideos"].([]any)[0].(map[string]any)["storageKey"] = "resource:private"
		}},
		{"invalid bitrate", func(input map[string]any) {
			input["metadata"].(map[string]any)["processingParameters"] = map[string]any{"bitrate": 0}
		}},
		{"unknown parameter", func(input map[string]any) {
			input["metadata"].(map[string]any)["processingParameters"] = map[string]any{"url": "https://invalid.example"}
		}},
		{"ordinary audio flag", func(input map[string]any) { input["config"].(map[string]any)["videoGenerateAudio"] = false }},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw, _ := json.Marshal(req.Input)
			var input map[string]any
			_ = json.Unmarshal(raw, &input)
			test.mutate(input)
			rejected := req
			rejected.Input = input
			if _, err := s.CreateTask("user", rejected); err == nil {
				t.Fatal("unsafe processing request admitted")
			}
		})
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("rejected request created a task")
	}
}

func TestSharedMediaToolsAutoApprovalRecoveryAndIdempotency(t *testing.T) {
	s, db, args, _ := sharedMediaToolFixture(t, "enhance")
	run, state := agentMediaRun(t, s, args, "auto")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("auto processing must request independent approval: %#v %v", waiting, err)
	}
	var count int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 0 {
		t.Fatal("processing submitted before approval")
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	recovered, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	var restored cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(recovered.Approval.Call.Function.Arguments), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.Operation != "enhance" || restored.ProcessingParameters == nil || *restored.ProcessingParameters.FPS != 60 {
		t.Fatal("approval checkpoint lost processing contract")
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&count)
	if count != 1 {
		t.Fatalf("approval replay submitted %d tasks", count)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	nodes, _ := creationObjects(doc["nodes"])
	if nodes["source-video-node"] == nil || nodes[args.NodeID] == nil || len(creationMaps(doc["connections"])) != 1 {
		t.Fatalf("source/result graph not preserved: %s", canvas.PayloadJSON)
	}
	metadata := nodes[args.NodeID]["metadata"].(map[string]any)
	encoded, _ := json.Marshal(metadata["generationSpec"])
	spec, err := contract.Decode(encoded)
	if err != nil || spec.Operation != "enhance" || spec.ProcessingParameters == nil || *spec.ProcessingParameters.FPS != 60 {
		t.Fatalf("result node lost processing spec: %s %v", encoded, err)
	}
}

func TestSharedMediaToolsApprovalEditRequotesAndKeepsOperation(t *testing.T) {
	s, db, args, _ := sharedMediaToolFixture(t, "enhance")
	tier := newSelectionPriceTier("processing-tier-low", `{"operation":"enhance","vquality":"1080p","fpsBand":"le30"}`, "", "per_second")
	tier.ChannelModelID = "processing-cm"
	tier.UnitPriceMicrocredits = 1
	if err := db.Create(&tier).Error; err != nil {
		t.Fatal(err)
	}
	run, state := agentMediaRun(t, s, args, "auto")
	if err := s.advanceCloudAgentTool(run, &state); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("missing approval: %v", err)
	}
	fps, bitrate := 30, 16000
	settings := CloudAgentMediaSettings{ChannelID: args.ChannelID, ChannelModelKey: args.ChannelModelKey, Quality: args.Quality, ProcessingParameters: &mediatool.Parameters{FPS: &fps, Bitrate: &bitrate}}
	if err := s.DecideCloudAgentApproval("user", run.ID, waiting.Approval.ID, "approve", "", &settings); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.CloudAgent("user", run.ID)
	recovered, err := cloudAgentDecode(stored)
	if err != nil {
		t.Fatal(err)
	}
	task, err := s.repo.TaskForUser("user", recovered.MediaTaskID)
	if err != nil {
		t.Fatalf("missing edited task: %v; %s", err, stored.StateJSON)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	metadata := input["metadata"].(map[string]any)
	if task.Operation != "enhance" || input["config"].(map[string]any)["fpsBand"] != "le30" {
		t.Fatalf("edited processing contract lost: %#v", input)
	}
	encoded, _ := json.Marshal(metadata["processingParameters"])
	var parameters mediatool.Parameters
	_ = json.Unmarshal(encoded, &parameters)
	if parameters.FPS == nil || *parameters.FPS != 30 || parameters.Bitrate == nil || *parameters.Bitrate != 16000 {
		t.Fatalf("edited public parameters lost: %s", encoded)
	}
	var order model.BillingOrder
	if err := db.Where("task_id = ?", task.ID).First(&order).Error; err != nil {
		t.Fatal(err)
	}
	if order.AmountMicrocredits != 13 {
		t.Fatalf("edited fps did not reprice trusted 13-second source: %#v", order)
	}
}

func TestSharedMediaToolsModelDiscoveryAndReadOnlyPolicy(t *testing.T) {
	s, _, args, _ := sharedMediaToolFixture(t, "depth")
	intent, err := s.cloudAgentModelIntent("user", "agent-canvas", `{"mode":"video","operation":"depth","referenceNodeIds":["source-video-node"]}`)
	if err != nil {
		t.Fatal(err)
	}
	result, err := s.cloudAgentModelList("user", intent)
	if err != nil {
		t.Fatal(err)
	}
	items := creationMaps(result.(map[string]any)["models"])
	if len(items) != 1 {
		t.Fatalf("processing discovery returned wrong candidates: %#v", result)
	}
	arguments := items[0]["generationArguments"].(map[string]any)
	if arguments["operation"] != "depth" || arguments["channelModelKey"] != "processing" || items[0]["tool"] == nil {
		t.Fatalf("missing public processing contract: %#v", items[0])
	}
	request := agentTestRequest()
	request.PermissionMode = "read_only"
	if cloudAgentToolAllowed(request, "generate_media") {
		t.Fatal("read-only mode allowed media processing")
	}
	args.Operation = "unknown-tool"
	run, state := agentMediaRun(t, s, args, "auto")
	if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args)); err == nil {
		t.Fatal("unknown operation fell back to generation")
	}
}
