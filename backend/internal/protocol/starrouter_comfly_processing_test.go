package protocol

import "testing"

func TestStarRouterComflyProcessingContracts(t *testing.T) {
	for _, test := range []struct{ provider, model string }{
		{"subtitle-removal", "comfly/1194"},
		{"depth", "comfly/1776"},
		{"upscale", "comfly/1849"},
	} {
		t.Run(test.provider, func(t *testing.T) {
			adapter := officialPackageAdapter(t, "starrouter-media.yingce-plugin", "starrouter-comfly-video-"+test.provider)
			if !adapter.Metadata().Kind.IsProcessing() || adapter.Metadata().RequiresPublicMediaURLs {
				t.Fatalf("metadata=%#v", adapter.Metadata())
			}
			request := GenerationRequest{
				Model: test.model, Prompt: "ignored", Resolution: "4k", Duration: 20,
				Videos: []MediaReference{{Kind: "video", URL: "https://cdn.example/source.mp4"}},
				ProviderOptions: map[string]map[string]any{
					"starrouter-comfly-video-" + test.provider: {"input_video": "https://untrusted.example/override.mp4", "fps": 120},
				},
			}
			spec, err := adapter.BuildCreate(t.Context(), RequestContext{Request: request})
			if err != nil || spec.Path != "/comfly/v1/videos" || !spec.OriginPath || spec.Auth.Type != "bearer" {
				t.Fatalf("create=%#v err=%v", spec, err)
			}
			body := manifestTestBody(t, spec)
			metadata, ok := body["metadata"].(map[string]any)
			if !ok || len(body) != 2 || body["model"] != test.model || len(metadata) != 1 || metadata["input_video"] != request.Videos[0].URL {
				t.Fatalf("body=%#v", body)
			}
			inline := request
			inline.Videos = []MediaReference{{Kind: "video", DataURL: "data:video/mp4;base64,dmlkZW8="}}
			inlineSpec, err := adapter.BuildCreate(t.Context(), RequestContext{Request: inline})
			if err != nil || manifestTestBody(t, inlineSpec)["metadata"].(map[string]any)["input_video"] != inline.Videos[0].DataURL {
				t.Fatalf("inline video request=%#v err=%v", inlineSpec, err)
			}
			for _, invalid := range []GenerationRequest{
				{Model: test.model},
				{Model: test.model, Videos: append(request.Videos, request.Videos[0])},
				{Model: "comfly/other", Videos: request.Videos},
				{Model: test.model, Videos: request.Videos, Images: []MediaReference{{URL: "https://cdn.example/image.png"}}},
				{Model: test.model, Videos: request.Videos, Audios: []MediaReference{{URL: "https://cdn.example/audio.mp3"}}},
			} {
				if _, err := adapter.BuildCreate(t.Context(), RequestContext{Request: invalid}); err == nil {
					t.Fatalf("accepted invalid request=%#v", invalid)
				}
			}
			receipt, err := adapter.ParseCreate(t.Context(), []byte(`{"id":"task-public","status":"queued","comfly":{"task_id":1234}}`))
			if err != nil || receipt.TaskID != "task-public" || receipt.Status != StatusPending {
				t.Fatalf("receipt=%#v err=%v", receipt, err)
			}
			poll := PollContext{TaskID: receipt.TaskID, Model: test.model, Request: request}
			for _, operation := range []struct {
				method, suffix string
				build          func() (RequestSpec, error)
			}{
				{"GET", "", func() (RequestSpec, error) { return adapter.BuildPoll(t.Context(), poll) }},
				{"GET", "/content", func() (RequestSpec, error) { return adapter.(ResultAdapter).BuildResult(t.Context(), poll) }},
				{"POST", "/cancel", func() (RequestSpec, error) { return adapter.BuildCancel(t.Context(), poll) }},
			} {
				spec, err := operation.build()
				if err != nil || spec.Method != operation.method || spec.Path != "/comfly/v1/videos/task-public"+operation.suffix || !spec.OriginPath {
					t.Fatalf("operation=%#v err=%v", spec, err)
				}
			}
			for status, want := range map[string]Status{"queued": StatusPending, "in_progress": StatusProcessing, "completed": StatusSucceeded, "failed": StatusFailed, "canceled": StatusCancelled} {
				state, err := adapter.ParsePoll(t.Context(), poll, []byte(`{"id":"task-public","status":"`+status+`"}`))
				if err != nil || state.Status != want {
					t.Fatalf("status=%s state=%#v err=%v", status, state, err)
				}
			}
			failed, err := adapter.ParsePoll(t.Context(), poll, []byte(`{"error":{"code":"invalid_media","message":"invalid source"}}`))
			if err != nil || failed.Status != StatusFailed || failed.Message != "invalid source" {
				t.Fatalf("failed=%#v err=%v", failed, err)
			}
		})
	}
}
