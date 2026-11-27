package app

import (
	"encoding/json"
	"reflect"
	"testing"

	"yingce/backend/internal/canvas/mediatool"
	"yingce/backend/internal/model"
)

func TestSharedMediaToolsPartialDraftEditPreservesOtherParameters(t *testing.T) {
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
	bitrate := 16000
	expected := *args.ProcessingParameters
	expected.Bitrate = &bitrate
	args.ProcessingParameters, args.SnapshotHash = &mediatool.Parameters{Bitrate: &bitrate}, ""
	req, restored, err := s.prepareCloudAgentMedia(run, &state, agentMediaCall(args))
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.Args.ProcessingParameters, &expected) {
		t.Fatalf("只修改码率时丢失其他草稿参数: %+v", restored.Args.ProcessingParameters)
	}
	req.creationPrepare = &creationTaskPreparation{}
	task, err := s.CreateTask("user", req)
	if err != nil {
		t.Fatal(err)
	}
	if err := applyCloudAgentResolvedMediaDefaults(&req, restored, task); err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(restored.Args.ProcessingParameters, &expected) {
		t.Fatalf("任务准入改变了未修改的参数: %+v", restored.Args.ProcessingParameters)
	}
}

func TestSharedMediaToolsPartialVersionEditPreservesOtherParameters(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	seedAgentMediaVersion(t, s, db)
	task, err := s.repo.TaskForUser("user", "original-task")
	if err != nil {
		t.Fatal(err)
	}
	var input map[string]any
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil {
		t.Fatal(err)
	}
	fps, bitrate, level := 60, 8000, "high"
	input["metadata"].(map[string]any)["processingParameters"] = &mediatool.Parameters{FPS: &fps, Bitrate: &bitrate, BitrateLevel: &level}
	raw, _ := json.Marshal(input)
	if err := db.Model(task).Updates(map[string]any{"operation": "enhance", "input_json": string(raw)}).Error; err != nil {
		t.Fatal(err)
	}
	bitrate = 16000
	args := cloudAgentMediaArgs{Mode: "video", NodeID: "new-version", InheritFromNodeID: "original", ReferenceNodeIDs: []string{}, ProcessingParameters: &mediatool.Parameters{Bitrate: &bitrate}}
	if err := s.inheritCloudAgentMediaConfiguration("user", "agent-canvas", &args, `{"referenceNodeIds":[]}`); err != nil {
		t.Fatal(err)
	}
	if args.Operation != "enhance" || !reflect.DeepEqual(args.ProcessingParameters, &mediatool.Parameters{FPS: &fps, Bitrate: &bitrate, BitrateLevel: &level}) {
		t.Fatalf("修改版丢失原处理规格: %+v", args)
	}
}

func TestSharedMediaToolsQuoteResolvesChannelFPSDefaults(t *testing.T) {
	for _, policy := range []string{VideoProcessingFPSKeepSource, VideoProcessingFPSUserSelect} {
		t.Run(policy, func(t *testing.T) {
			s, db, _, profile := sharedMediaToolFixture(t, "enhance")
			profile.Video.Processing.FPSPolicy = policy
			if policy == VideoProcessingFPSKeepSource {
				profile.Video.Processing.FPSOptions = nil
			}
			if err := db.Model(&model.ChannelModel{}).Where("id = ?", "processing-cm").Update("capability_config_json", mustEncodeModelCapabilityConfig(t, profile)).Error; err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.ChannelModelPriceTier{}).Where("id = ?", "processing-tier").Update("selector_json", `{"operation":"enhance","vquality":"1080p","fpsBand":"le30"}`).Error; err != nil {
				t.Fatal(err)
			}
			quote, err := s.QuoteChannelModel("user", ChannelModelQuoteRequest{ChannelID: "channel", ModelKey: "processing", Intent: ModelRequestIntent{Capability: "video", Operation: "enhance", Inputs: map[string]int{"video": 1}, Options: map[string]any{"videoSeconds": 13, "vquality": "1080p"}}})
			if err != nil {
				t.Fatalf("省略帧率的合法增强报价失败: %v", err)
			}
			if quote.Quantity != 13 {
				t.Fatalf("报价丢失源视频时长: %+v", quote)
			}
		})
	}
}
