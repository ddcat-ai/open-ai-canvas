package app

import (
	"encoding/json"
	"fmt"
	"testing"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func agentPixelImageFixture(t *testing.T) (*Service, *gorm.DB, cloudAgentMediaArgs) {
	t.Helper()
	s, db, a := agentMediaFixture(t)
	profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkImage), "doubao-seedream-5-0-pro-260628")
	presets := kemeiSeedreamImagePresets()
	values := make([]string, 0, len(presets))
	for _, preset := range presets {
		values = append(values, preset.Size)
	}
	profile.Image.Size = ImageSizeConfig{Parameter: "size", Values: values, Default: "1424x800", Presets: presets}
	profile.Image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
	profile.Image.Resolution = ImageResolutionConfig{Supported: false, Default: "auto"}
	for _, row := range []any{
		&model.ChannelModel{ID: "pixel-cm", ChannelID: "channel", ModelKey: "pixel-image", Capability: "image", Protocol: model.ChannelInterfaceVolcengineArkImage, CapabilityConfigJSON: mustEncodeModelCapabilityConfig(t, profile), BillingMode: "fixed_request", PriceConfigured: true, Enabled: true},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	for _, preset := range presets {
		selector := fmt.Sprintf(`{"size":%q}`, preset.Size)
		price := map[string]int64{"1k": 100, "1.5k": 150, "2k": 200}[preset.Tier]
		if err := db.Create(&model.ChannelModelPriceTier{ID: "pixel-" + preset.Size, ChannelModelID: "pixel-cm", SelectorKey: selector, SelectorJSON: selector, BillingMode: "fixed_request", UnitPriceMicrocredits: price, PriceConfigured: true, Enabled: true}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Updates(map[string]any{"width": 1424, "height": 800}).Error; err != nil {
		t.Fatal(err)
	}
	a.Mode, a.ChannelModelKey, a.NodeID = "image", "pixel-image", "image-shot-1"
	a.Duration, a.VideoGenerateAudio, a.Size, a.Quality = 0, nil, "1424x800", ""
	a.Prompt, a.SourceNodeID, a.ReferenceNodeIDs = "编辑参考图", "", []string{"cat"}
	return s, db, a
}

func TestCloudAgentPixelImageReferenceReachesApproval(t *testing.T) {
	for _, tc := range []struct {
		name, size, draft, want string
		multiple, canonical     bool
		price                   int64
	}{
		{name: "explicit 1k", size: "1424x800", want: "1424x800", price: 100},
		{name: "omitted", want: "1424x800", price: 100},
		{name: "explicit 1.5k", size: "2048x1152", want: "2048x1152", price: 150},
		{name: "explicit 2k", size: "2816x1584", want: "2816x1584", price: 200},
		{name: "inherit ratio within 1.5k", size: "1536x1536", want: "2048x1152", price: 150},
		{name: "multiple references", size: "2048x2048", want: "2048x2048", multiple: true, price: 200},
		{name: "flat draft", size: "2816x1584", draft: "1424x800", want: "1424x800", price: 100},
		{name: "canonical draft", size: "1424x800", draft: "2816x1584", want: "2816x1584", canonical: true, price: 200},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, a := agentPixelImageFixture(t)
			a.Size = tc.size
			if tc.multiple {
				a.ReferenceNodeIDs = append(a.ReferenceNodeIDs, "hero")
			}
			if tc.draft != "" {
				canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
				if err != nil {
					t.Fatal(err)
				}
				doc, err := creationDocument(canvas.PayloadJSON)
				if err != nil {
					t.Fatal(err)
				}
				meta := map[string]any{"size": tc.draft}
				if tc.canonical {
					stored := a
					stored.Size, stored.ReferenceNodeIDs = tc.draft, nil
					spec, err := cloudAgentGenerationSpec(stored, nil, nil)
					if err != nil {
						t.Fatal(err)
					}
					meta, err = spec.NodeMetadata()
					if err != nil {
						t.Fatal(err)
					}
					meta["size"] = "1024x1024"
				}
				meta["status"] = "idle"
				doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": a.NodeID, "type": "image", "metadata": meta})
				raw, err := json.Marshal(doc)
				if err != nil {
					t.Fatal(err)
				}
				if err := db.Model(canvas).Update("payload_json", string(raw)).Error; err != nil {
					t.Fatal(err)
				}
				a.SnapshotHash = cloudAgentMediaContentHash(doc)
			}
			run, state := agentMediaRun(t, s, a, "auto")
			req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
			if err != nil {
				t.Fatal(err)
			}
			req.creationPrepare = &creationTaskPreparation{}
			task, err := s.CreateTask("user", req)
			if err != nil {
				t.Fatal(err)
			}
			var resolved map[string]any
			if err := json.Unmarshal([]byte(task.InputJSON), &resolved); err != nil {
				t.Fatal(err)
			}
			t.Logf("requested=%q normalized=%q resolved=%q capability=%q", tc.size, plan.Args.Size, resolved["config"].(map[string]any)["size"], resolved["capabilityOptions"].(map[string]any)["size"])
			if err := applyCloudAgentResolvedMediaDefaults(&req, plan, task); err != nil {
				t.Errorf("legal preset blocked before approval: %v", err)
			}
			if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
				t.Fatal(err)
			}
			run, state = agentInterjectionState(t, s, run.ID)
			var tasks int64
			if err := db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&tasks).Error; err != nil {
				t.Fatal(err)
			}
			if tasks != 0 {
				t.Fatal("created a billable task before approval")
			}
			if run.Status != "waiting_approval" || state.Approval == nil {
				t.Fatalf("legal image edit did not reach approval: status=%s failure=%s", run.Status, run.FailureMessage)
			}
			if plan.Args.Size != tc.want {
				t.Fatalf("wrong admitted size: %q", plan.Args.Size)
			}
			if state.Approval.Prepared.Quote.AmountMicrocredits != tc.price || state.Approval.Prepared.Quote.PriceTierID != "pixel-"+tc.want {
				t.Fatalf("wrong preset quote: %+v", state.Approval.Prepared.Quote)
			}
			approvalID := state.Approval.ID
			approveAgentMediaDraft(t, s, run.ID)
			if err := s.DecideCloudAgentApproval("user", run.ID, approvalID, "approve", ""); err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&tasks).Error; err != nil || tasks != 1 {
				t.Fatalf("approval must submit exactly once: tasks=%d err=%v", tasks, err)
			}
			var submitted model.Task
			if err := db.Where("type = ?", "canvas_image").First(&submitted).Error; err != nil {
				t.Fatal(err)
			}
			var input canvasGenerationInput
			if err := json.Unmarshal([]byte(submitted.InputJSON), &input); err != nil {
				t.Fatal(err)
			}
			if input.Config.Size != tc.want || len(input.ReferenceImages) != len(a.ReferenceNodeIDs) || input.ReferenceImages[0].StorageKey != "resource:ref-one" {
				t.Fatalf("submission changed approved size or references: %+v", input)
			}
		})
	}
}

func TestCloudAgentPixelImageRejectsUndeclaredSize(t *testing.T) {
	for _, size := range []string{"1424x801", "2848x1600", "17:9"} {
		t.Run(size, func(t *testing.T) {
			s, db, a := agentPixelImageFixture(t)
			a.Size = size
			run, state := agentMediaRun(t, s, a, "auto")
			req, plan, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(a))
			if err != nil {
				t.Fatal(err)
			}
			if plan.Args.Size != size {
				t.Fatalf("invalid size was silently replaced: %q", plan.Args.Size)
			}
			req.creationPrepare = &creationTaskPreparation{}
			if _, err := s.CreateTask("user", req); err == nil {
				t.Fatal("undeclared size passed admission")
			}
			var tasks int64
			if err := db.Model(&model.Task{}).Where("type = ?", "canvas_image").Count(&tasks).Error; err != nil || tasks != 0 {
				t.Fatalf("invalid size created a task: tasks=%d err=%v", tasks, err)
			}
		})
	}
}

func TestCloudAgentImageApprovalDoesNotEquatePixelTiers(t *testing.T) {
	for _, requested := range []string{"1424x800", "2048x1152", "2816x1584", "3840x2160", "3584x2016"} {
		for _, resolved := range []string{"1424x800", "2048x1152", "2816x1584", "3840x2160", "3584x2016"} {
			input := map[string]any{"mode": "image", "config": map[string]any{"size": resolved}, "capabilityOptions": map[string]any{"size": resolved}}
			err := validateCloudAgentResolvedMediaOptions(map[string]any{"size": requested}, input)
			if (err == nil) != (requested == resolved) {
				t.Fatalf("pixel presets confused: requested=%s resolved=%s err=%v", requested, resolved, err)
			}
		}
	}
}

func TestCloudAgentPixelImageUsesEffectiveResolution(t *testing.T) {
	for _, logical := range []bool{false, true} {
		for _, tc := range []struct {
			name, size, resolution, draftResolution, want string
			changeResolution                              bool
		}{
			{name: "default tier", want: "2752x1536"},
			{name: "explicit 4k", resolution: "4k", want: "3840x2160"},
			{name: "4k pixels", size: "3840x2160", resolution: "4k", want: "3840x2160"},
			{name: "4k ratio inheritance", size: "2880x2880", resolution: "4k", want: "3840x2160"},
			{name: "saved 4k", resolution: "2k", draftResolution: "4k", want: "3840x2160"},
			{name: "user changes tier", size: "2048x2048", resolution: "4k", changeResolution: true, want: "3840x2160"},
		} {
			t.Run(fmt.Sprintf("logical=%v/%s", logical, tc.name), func(t *testing.T) {
				s, db, a := agentPixelImageFixture(t)
				profile := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceVolcengineArkImage), "pixel-image")
				profile.Image = pixelSizeTestProfile()
				profile.Image.Quality = ImageQualityConfig{Supported: false, Default: "auto"}
				profile.Image.Resolution = ImageResolutionConfig{Supported: true, Values: []string{"2k", "4k"}, Default: "2k"}
				if err := db.Model(&model.ChannelModel{}).Where("id = ?", "pixel-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
					t.Fatal(err)
				}
				if logical {
					spec, err := CapabilitySpecFromModelCapabilityConfig(profile, "image")
					if err != nil {
						t.Fatal(err)
					}
					raw, err := json.Marshal(spec)
					if err != nil {
						t.Fatal(err)
					}
					for _, row := range []any{
						&model.SystemSetting{Key: featureAvailabilitySettingKey, ValueJSON: `{"frontendModelsEnabled":true}`},
						&model.LogicalModel{ID: "logical-pixel", Code: "logical-pixel", Name: "Pixel test", Capability: "image", Enabled: true, ActiveRevisionID: "pixel-revision", PricePolicy: "channel", BillingMode: "fixed_request"},
						&model.LogicalModelRevision{ID: "pixel-revision", LogicalModelID: "logical-pixel", Version: 1, CapabilitySpecJSON: string(raw), DefaultOptionsJSON: `{"imageResolution":"2k"}`},
						&model.LogicalModelRoute{ID: "pixel-route", LogicalModelRevisionID: "pixel-revision", ChannelModelID: "pixel-cm", Enabled: true, Weight: 1},
					} {
						if err := db.Create(row).Error; err != nil {
							t.Fatal(err)
						}
					}
					a.LogicalModelID, a.ChannelID, a.ChannelModelKey = "logical-pixel", "", ""
				}
				a.Size, a.ImageResolution = tc.size, tc.resolution
				state := &cloudAgentRuntime{}
				if tc.changeResolution {
					state.Request.Prompt = "分辨率改成4k"
					a.ConfigurationChange = &cloudAgentMediaConfigurationChange{Fields: []string{"imageResolution"}, UserInstruction: state.Request.Prompt}
				}
				doc := map[string]any{"nodes": []any{}}
				if tc.draftResolution != "" {
					doc["nodes"] = []any{map[string]any{"id": a.NodeID, "metadata": map[string]any{"imageResolution": tc.draftResolution}}}
				}
				refs := map[string]any{"referenceImages": []map[string]any{{"width": 2752, "height": 1536}}}
				if err := s.resolveCloudAgentMediaConfiguration(&a, state, agentMediaCall(a).Function.Arguments, doc, refs); err != nil {
					t.Fatal(err)
				}
				if a.Size != tc.want || (tc.draftResolution != "" && a.ImageResolution != tc.draftResolution) {
					t.Fatalf("size encoding ignored effective resolution: %+v", a)
				}
			})
		}
	}
}
