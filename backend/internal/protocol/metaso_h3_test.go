package protocol

import (
	"context"
	"strconv"
	"testing"
)

func TestMetasoH3VideoDurationRange(t *testing.T) {
	adapter := officialPackageAdapter(t, "metaso-h3.yingce-plugin", "metaso-h3")
	for seconds := 4; seconds <= 30; seconds++ {
		t.Run(strconv.Itoa(seconds), func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{Model: "MiniMax-H3", Prompt: "a clip", Duration: seconds}})
			if err != nil {
				t.Fatal(err)
			}
			if spec.Path != "/api/minimax/v2/video_generation" {
				t.Fatalf("create path = %q", spec.Path)
			}
			if !spec.OriginPath {
				t.Fatal("Metaso create path must be relative to the origin")
			}
			if duration := manifestTestBody(t, spec)["duration"]; duration != float64(seconds) {
				t.Fatalf("upstream duration = %#v, want %d", duration, seconds)
			}
		})
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task-1"})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Path != "/api/minimax/v2/query/video_generation/task-1" || !poll.OriginPath {
		t.Fatalf("poll path = %q, originPath = %t", poll.Path, poll.OriginPath)
	}
}
