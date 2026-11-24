package protocol

import (
	"context"
	"testing"
)

func TestSeedanceVideosCompatibleReadsMetadataVideoURL(t *testing.T) {
	adapter := officialPackageAdapter(t, "seedance-videos-compatible.yingce-plugin", "seedance-videos-compatible")
	state, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "6afbd24c9c5a79233d9de3175bf618da"}, []byte(`{"id":"6afbd24c9c5a79233d9de3175bf618da","status":"completed","metadata":{"url":"https://cdn.example/result.mp4"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if state.Status != StatusSucceeded || state.Result == nil || len(state.Result.Videos) != 1 {
		t.Fatalf("state = %#v, want one completed video", state)
	}
	if state.Result.Videos[0].URL != "https://cdn.example/result.mp4" {
		t.Fatalf("video URL = %q, want metadata.url", state.Result.Videos[0].URL)
	}
}
