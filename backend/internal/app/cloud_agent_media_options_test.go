package app

import (
	"encoding/json"
	"errors"
	"testing"

	"yingce/backend/internal/canvas/contract"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCloudAgentImageApprovalTreatsAutomaticQualityAsUnspecified(t *testing.T) {
	for _, quality := range []string{"auto", "any", "AUTO"} {
		resolved := map[string]any{"mode": "image", "config": map[string]any{"size": "16:9", "quality": "auto"}, "capabilityOptions": map[string]any{"size": "16:9"}}
		if err := validateCloudAgentResolvedMediaOptions(map[string]any{"quality": quality, "imageResolution": "any"}, resolved); err != nil {
			t.Fatalf("automatic options caused false admission failure: %v", err)
		}
		if err := validateCloudAgentResolvedMediaOptions(map[string]any{"quality": "high"}, resolved); err == nil {
			t.Fatal("explicit unsupported user quality was accepted")
		}
	}
}

func TestCloudAgentImageIgnoresUndeclaredModelQualityBeforeApproval(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGeminiImage), "nano-banana-pro")
	profile.Image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
	profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"1k", "2k"}, Default: "2k"}
	for _, row := range []any{
		&model.ChannelModel{ID: "image-cm", ChannelID: "channel", ModelKey: "nano-banana-pro", Capability: "image", Protocol: model.ChannelInterfaceGeminiImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
		&model.ChannelModelPriceTier{ID: "image-tier", ChannelModelID: "image-cm", SelectorKey: "{}", SelectorJSON: "{}", BillingMode: "fixed_request", UnitPriceMicrocredits: 1, PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	a.Mode, a.ChannelModelKey, a.Duration, a.VideoGenerateAudio = "image", "nano-banana-pro", 0, nil
	a.Size, a.Quality, a.NodeID = "16:9", "high", "image-shot-1"
	a.ReferenceNodeIDs = []string{"cat"}
	run, _ := agentMediaRun(t, s, a, "auto")
	_, state := agentInterjectionState(t, s, run.ID)
	request, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	if quality := stringValue(request.Input["config"].(map[string]any)["quality"]); quality != "" {
		t.Fatalf("undeclared quality crossed Agent admission: %q", quality)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, run.ID)
	if run.Status != "waiting_approval" || state.Approval == nil {
		t.Fatalf("model-only quality noise stopped creation: status=%s failure=%s", run.Status, run.FailureMessage)
	}
	var resolved cloudAgentMediaArgs
	if err := json.Unmarshal([]byte(state.Approval.Call.Function.Arguments), &resolved); err != nil {
		t.Fatal(err)
	}
	if resolved.Quality != "" || resolved.Size != "4:3" || resolved.ImageResolution == "" {
		t.Fatalf("approval did not use declared image options: %+v", resolved)
	}
	var tasks int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&tasks)
	if tasks != 0 {
		t.Fatal("normalization submitted a paid task before approval")
	}
	approvalID := state.Approval.ID
	approveAgentMediaDraft(t, s, run.ID)
	run, state = agentInterjectionState(t, s, run.ID)
	if state.MediaTaskID == "" || run.Status == "failed" {
		t.Fatalf("normalized approval failed to submit: status=%s failure=%s", run.Status, run.FailureMessage)
	}
	for _, event := range state.Events {
		if event.Type == "tool_failed" || event.Type == "run_failed" {
			t.Fatalf("deterministic normalization required a model repair: %+v", event)
		}
	}
	if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
		t.Fatal(err)
	}
	db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&tasks)
	if tasks != 1 {
		t.Fatalf("approval replay created duplicate tasks: %d", tasks)
	}
}

func TestCloudAgentMediaPreservesDraftOptionsAgainstModelOverrides(t *testing.T) {
	for _, canonical := range []bool{false, true} {
		t.Run(map[bool]string{false: "flat metadata", true: "generation contract"}[canonical], func(t *testing.T) {
			s, db, a := agentMediaFixture(t)
			canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
			doc, _ := creationDocument(canvas.PayloadJSON)
			meta := map[string]any{"status": "idle", "size": "16:9", "seconds": "6", "generateAudio": "false", "channelId": "channel", "channelModelKey": "seedance-test"}
			if canonical {
				configured := a
				configured.ReferenceNodeIDs, configured.SourceNodeID = nil, ""
				noAudio := false
				configured.Size, configured.Duration, configured.VideoGenerateAudio = "16:9", 6, &noAudio
				spec, err := cloudAgentGenerationSpec(configured, map[string]any{}, nil)
				if err != nil {
					t.Fatal(err)
				}
				stored, err := spec.NodeMetadata()
				if err != nil {
					t.Fatal(err)
				}
				meta = stored
				meta["status"] = "idle"
				// A stale flat mirror must never supersede the canonical settings.
				meta["size"] = "9:16"
			}
			doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": a.NodeID, "type": "video", "title": "用户草稿", "metadata": meta})
			raw, _ := json.Marshal(doc)
			if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			a.SnapshotHash = cloudAgentMediaContentHash(doc)
			// This model-supplied duration exceeds the budget, but it is not the
			// duration that will be executed on the configured draft.
			a.Duration, a.ChannelModelKey = 100, "model-made-up-by-agent"
			run, state := agentMediaRun(t, s, a, "auto")
			req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
			if err != nil {
				t.Fatal(err)
			}
			config := req.Input["config"].(map[string]any)
			if plan.Args.Size != "16:9" || plan.Args.Duration != 6 || plan.Args.ChannelModelKey != "seedance-test" || plan.Args.VideoGenerateAudio == nil || *plan.Args.VideoGenerateAudio || config["size"] != "16:9" || config["videoSeconds"] != "6" {
				t.Fatalf("model overrode existing draft: args=%+v config=%+v", plan.Args, config)
			}
			state.Request.Budget.MaxVideoSeconds = 5
			if _, _, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a)); err == nil {
				t.Fatal("inherited duration bypassed the effective budget")
			}
		})
	}
}

func TestCloudAgentImageDraftKeepsCanonicalModelAndImageOptions(t *testing.T) {
	size, resolution, quality := "16:9", "2k", "high"
	spec := contract.GenerationSpec{Version: 1, Mode: "image", ModelSelection: &contract.ModelSelection{Kind: "logical", LogicalModelID: "user-model"}, Options: contract.Options{Size: &size, ImageResolution: &resolution, Quality: &quality}, TextInputMode: "prompt-only", ReferenceBindings: []contract.ReferenceBinding{}}
	meta, err := spec.NodeMetadata()
	if err != nil {
		t.Fatal(err)
	}
	meta["size"] = "1:1"
	doc := map[string]any{"nodes": []any{map[string]any{"id": "draft", "metadata": meta}}}
	a := cloudAgentMediaArgs{Mode: "image", NodeID: "draft", ChannelID: "guessed-channel", ChannelModelKey: "guessed-model", Size: "9:16", ImageResolution: "4k", Quality: "max"}
	selection, options, err := cloudAgentMediaDraftConfiguration(a, doc)
	if err != nil {
		t.Fatal(err)
	}
	a.LogicalModelID, a.ChannelID, a.ChannelModelKey = selection.LogicalModelID, selection.ChannelID, selection.ModelKey
	applyCloudAgentMediaDraftOptions(&a, options)
	if a.LogicalModelID != "user-model" || a.ChannelID != "" || a.ChannelModelKey != "" || a.Size != size || a.ImageResolution != resolution || a.Quality != quality {
		t.Fatalf("image settings changed: %+v", a)
	}
}

func TestCloudAgentLogicalImageOptionsKeepSupportedQualityAndRejectInvalidValues(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	logical := seedAgentLogicalImageModel(t, s, db)
	a.Mode, a.LogicalModelID, a.ChannelID, a.ChannelModelKey = "image", logical.ID, "", ""
	a.Duration, a.VideoGenerateAudio, a.ReferenceNodeIDs = 0, nil, nil
	a.Size, a.Quality, a.ImageResolution = "16:9", "high", "2k"
	run, state := agentMediaRun(t, s, a, "auto")
	req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	if plan.Args.Quality != "high" || plan.Args.ImageResolution != "2k" || plan.Args.Size != "16:9" {
		t.Fatalf("supported explicit new-node options were changed: %+v", plan.Args)
	}
	preparation := &creationTaskPreparation{}
	req.creationPrepare = preparation
	if _, err := s.CreateTask("user", req); err != nil {
		t.Fatal(err)
	}
	a.Quality = "model-invented-quality"
	req, _, err = s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	req.creationPrepare = preparation
	_, err = s.CreateTask("user", req)
	var fieldErr *cloudAgentFieldArgumentError
	if !errors.As(cloudAgentWrapMediaAdmissionError(err), &fieldErr) || fieldErr.Field != "quality" {
		t.Fatalf("unsupported quality lost bounded repair classification: %v", err)
	}
	canvas, _ := s.repo.CanvasProjectForUser("user", "agent-canvas")
	doc, _ := creationDocument(canvas.PayloadJSON)
	doc["nodes"] = append(doc["nodes"].([]any), map[string]any{"id": a.NodeID, "type": "image", "metadata": map[string]any{"status": "idle", "quality": "user-invalid-quality"}})
	raw, _ := json.Marshal(doc)
	if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	a.Quality, a.SnapshotHash = "high", cloudAgentMediaContentHash(doc)
	req, plan, err = s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil || plan.Args.Quality != "user-invalid-quality" {
		t.Fatalf("persisted user setting was silently normalized: plan=%+v err=%v", plan, err)
	}
	req.creationPrepare = preparation
	if _, err := s.CreateTask("user", req); err == nil {
		t.Fatal("invalid persisted user setting bypassed strict admission")
	}
}

func TestCloudAgentLogicalImageDropsOnlyUndeclaredOptions(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	logical := seedAgentLogicalImageModel(t, s, db)
	var revision model.LogicalModelRevision
	if err := db.First(&revision, "id = ?", logical.ActiveRevisionID).Error; err != nil {
		t.Fatal(err)
	}
	var spec CapabilitySpec
	if err := json.Unmarshal([]byte(revision.CapabilitySpecJSON), &spec); err != nil {
		t.Fatal(err)
	}
	delete(spec.Options, "quality")
	delete(spec.Options, "imageResolution")
	parameters := spec.ImageParameters[:0]
	for _, parameter := range spec.ImageParameters {
		if parameter.Name != "quality" && parameter.Name != "imageResolution" {
			parameters = append(parameters, parameter)
		}
	}
	spec.ImageParameters = parameters
	raw, _ := json.Marshal(spec)
	if err := db.Model(&revision).Update("capability_spec_json", string(raw)).Error; err != nil {
		t.Fatal(err)
	}
	// Logical image declarations are projected from the active route as well
	// as the product spec. Disable the options on that real route, too.
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGrokImage), "grok-image")
	profile.Image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
	profile.Image.Resolution = ImageResolutionConfig{Supported: false, Default: "auto"}
	if err := db.Model(&model.ChannelModel{}).Where("id = ?", "agent-image-cm").Updates(map[string]any{"protocol": model.ChannelInterfaceGrokImage, "capability_config_json": mustEncodeModelCapabilityConfig(t, profile)}).Error; err != nil {
		t.Fatal(err)
	}
	s.invalidateRouteCatalog()
	a.Mode, a.LogicalModelID, a.ChannelID, a.ChannelModelKey = "image", logical.ID, "", ""
	a.Quality, a.ImageResolution, a.Size = "imaginary", "imaginary", "16:9"
	if err := s.normalizeCloudAgentImageOptions(&a, nil); err != nil {
		t.Fatal(err)
	}
	if a.Quality != "" || a.ImageResolution != "" || a.Size != "16:9" || a.LogicalModelID != logical.ID {
		t.Fatalf("logical model options were not normalized within their declared scope: %+v", a)
	}
}

func TestCloudAgentReferenceRatioUsesActualResourceDimensions(t *testing.T) {
	spec := CapabilitySpec{Options: map[string]OptionConstraint{"size": {Values: []any{"1:1", "16:9", "4:3"}}}}
	for _, test := range []struct {
		name string
		refs []map[string]any
		want string
	}{
		{"wide", []map[string]any{{"width": 1920, "height": 1080}}, "16:9"},
		{"photo", []map[string]any{{"width": 640, "height": 480}}, "4:3"},
		{"unsupported", []map[string]any{{"width": 900, "height": 1600}}, ""},
		{"unknown", []map[string]any{{"width": 0, "height": 0}}, ""},
		{"multiple", []map[string]any{{"width": 1920, "height": 1080}, {"width": 640, "height": 480}}, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			if got := cloudAgentReferenceImageRatio(spec, map[string]any{"referenceImages": test.refs}); got != test.want {
				t.Fatalf("ratio=%q want=%q", got, test.want)
			}
		})
	}
}

func TestCloudAgentImageOmittedSizeInheritsSupportedReferenceRatio(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	logical := seedAgentLogicalImageModel(t, s, db)
	a.Mode, a.LogicalModelID, a.ChannelID, a.ChannelModelKey = "image", logical.ID, "", ""
	a.Duration, a.VideoGenerateAudio, a.Size, a.Quality = 0, nil, "", ""
	a.ReferenceNodeIDs = []string{"cat"}
	run, state := agentMediaRun(t, s, a, "auto")
	_, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	if plan.Args.Size != "4:3" {
		t.Fatalf("image edit lost source ratio: %+v", plan.Args)
	}
	a.Size = "16:9"
	_, plan, err = s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil || plan.Args.Size != "4:3" {
		t.Fatalf("model-only ratio overrode reference: plan=%+v err=%v", plan, err)
	}
	state.Canonical.Messages = []map[string]any{{"role": "user", "content": "这张图改为16:9横屏"}}
	a.ConfigurationChange = &cloudAgentMediaConfigurationChange{Fields: []string{"size"}, UserInstruction: "改为16:9横屏"}
	_, plan, err = s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
	if err != nil || plan.Args.Size != "16:9" {
		t.Fatalf("reference overrode explicit new output ratio: plan=%+v err=%v", plan, err)
	}
}

func TestCloudAgentModelDefaultDurationRespectsBudgetBeforeDraftApproval(t *testing.T) {
	s, db, a := agentMediaFixture(t)
	a.Duration = 0
	run, state := agentMediaRun(t, s, a, "auto")
	state.Request.Budget.MaxVideoSeconds = 1
	if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
		return cloudAgentSave(current, &state)
	}); err != nil {
		t.Fatal(err)
	}
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	run, state = agentInterjectionState(t, s, run.ID)
	if run.Status != "failed" || state.Approval != nil {
		t.Fatalf("model default over budget reached approval: status=%s", run.Status)
	}
	var tasks int64
	db.Model(&model.Task{}).Where("type = ?", "canvas_video").Count(&tasks)
	if tasks != 0 {
		t.Fatal("over-budget default created a paid task")
	}
}

func TestCloudAgentMediaCatalogOffersMinimalGenerationArguments(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	result, err := s.cloudAgentModelList(testGroupUserID(s), nil)
	if err != nil {
		t.Fatal(err)
	}
	models := result.(map[string]any)["models"].([]map[string]any)
	if len(models) == 0 {
		t.Fatal("fixture has no media models")
	}
	for _, model := range models {
		args := model["generationArguments"].(map[string]any)
		for _, key := range []string{"size", "quality", "imageResolution", "durationSeconds", "videoGenerateAudio"} {
			if _, exists := args[key]; exists {
				t.Fatalf("catalog encourages copying optional model controls: %+v", args)
			}
		}
		if args["mode"] == nil || model["defaults"] == nil || model["options"] == nil {
			t.Fatal("catalog lost actual capability/default information")
		}
	}
}
