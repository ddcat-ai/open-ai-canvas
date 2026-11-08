package protocol

import (
	"context"
	"testing"
)

func TestMetasoSeedanceParameters(t *testing.T) {
	for _, pkg := range []struct{ file, provider string }{{"metaso-h3.yingce-plugin", "metaso-h3"}, {"minimax-hailuo-video-v2.yingce-plugin", "minimax-video"}} {
		for _, model := range []string{"seedance-2.0-mini", "seedance-2.0"} {
			t.Run(pkg.provider+"/"+model, func(t *testing.T) {
				adapter := officialPackageAdapter(t, pkg.file, pkg.provider)
				for _, tc := range []struct {
					name       string
					duration   int
					resolution string
					watermark  bool
					invalid    bool
				}{
					{"defaults", 0, "", false, false},
					{"minimum", 4, "480p", false, false},
					{"maximum", 15, "720p", false, false},
					{"too short", 3, "480p", false, true},
					{"too long", 16, "480p", false, true},
					{"old H3 resolution", 4, "768P", false, true},
					{"1080p", 4, "1080p", false, model == "seedance-2.0-mini"},
					{"4k", 4, "4k", false, model == "seedance-2.0-mini"},
					{"watermark", 4, "480p", true, true},
				} {
					t.Run(tc.name, func(t *testing.T) {
						spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: model, Prompt: "a paper boat", Duration: tc.duration, Resolution: tc.resolution, Watermark: tc.watermark}})
						if tc.invalid {
							if err == nil {
								t.Fatal("invalid parameters accepted")
							}
							return
						}
						if err != nil {
							t.Fatal(err)
						}
						body := manifestTestBody(t, spec)
						wantDuration, wantResolution := tc.duration, tc.resolution
						if wantDuration == 0 {
							wantDuration = 4
						}
						if wantResolution == "" {
							wantResolution = "480p"
						}
						if body["model"] != model || body["duration"] != float64(wantDuration) || body["resolution"] != wantResolution {
							t.Fatalf("unexpected body: %#v", body)
						}
						if body["aigc_watermark"] == true {
							t.Fatal("watermark enabled")
						}
						if _, ok := body["prompt_optimizer"]; ok {
							t.Fatal("Seedance must omit prompt optimizer")
						}
					})
				}
				created, err := adapter.ParseCreate(context.Background(), []byte(`{"task_id":"seedance-test"}`))
				if err != nil || created.TaskID != "seedance-test" {
					t.Fatalf("create = %#v, %v", created, err)
				}
				polled, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "seedance-test"}, []byte(`{"task":{"id":"seedance-test","status":"succeeded","content":{"url":"https://cdn.example/video.mp4"}}}`))
				if err != nil || polled.Status != StatusSucceeded {
					t.Fatalf("poll = %#v, %v", polled, err)
				}
			})
		}
	}
}
