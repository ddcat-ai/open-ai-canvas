package protocol

import (
	"context"
	"reflect"
	"testing"
)

func TestEvoLinkSeedAudioUploadCreateAndPoll(t *testing.T) {
	adapter := officialPackageAdapter(t, "evolink-seed-audio.yingce-plugin", "evolink-seed-audio")
	uploader, ok := adapter.(MediaUploadAdapter)
	if !ok || !reflect.DeepEqual(uploader.UploadKinds(), []string{"audio"}) {
		t.Fatal("audio upload contract is missing")
	}
	media := MediaReference{Kind: "audio", DataURL: "data:audio/wav;base64,YXVkaW8=", Name: "voice.wav", MIMEType: "audio/wav"}
	upload, err := uploader.BuildUpload(context.Background(), RequestContext{}, media)
	if err != nil {
		t.Fatal(err)
	}
	if upload.Method != "POST" || upload.Path != "/api/v1/files/upload/stream" || upload.ContentType != "multipart/form-data" || len(upload.Files) != 1 || upload.Files[0].Name != "file" {
		t.Fatalf("upload = %#v", upload)
	}
	referenceURL := "https://files.example/voice.wav"
	gotURL, err := uploader.ParseUpload(context.Background(), []byte(`{"data":{"file_url":"`+referenceURL+`"}}`))
	if err != nil || gotURL != referenceURL {
		t.Fatalf("upload URL = %q, error = %v", gotURL, err)
	}
	request := GenerationRequest{
		Capability: CapabilityAudio,
		Model:      "doubao-seed-audio-1-0",
		Prompt:     "参考 @audio1 的音色，说一句你好",
		Audios:     []MediaReference{{Kind: "audio", Order: 1, Metadata: map[string]any{MediaUploadIDKey: referenceURL}}},
		Extra:      map[string]any{"audioFormat": "mp3", "audioSpeed": 1.2},
	}
	created, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if created.Method != "POST" || created.Path != "/v1/audios/generations" {
		t.Fatalf("create = %#v", created)
	}
	body := manifestTestBody(t, created)
	if got := body["audio_references"]; !reflect.DeepEqual(got, []any{referenceURL}) {
		t.Fatalf("audio_references = %#v", got)
	}
	if body["format"] != "mp3" || body["speech_rate"] != 1.2 {
		t.Fatalf("audio settings = %#v", body)
	}
	createdResult, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-1","status":"pending"}`))
	if err != nil || createdResult.TaskID != "task-1" || createdResult.Status != StatusPending {
		t.Fatalf("created result = %#v, error = %v", createdResult, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task-1"})
	if err != nil || poll.Path != "/v1/tasks/task-1" {
		t.Fatalf("poll = %#v, error = %v", poll, err)
	}
	polled, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(`{"id":"task-1","status":"completed","result_data":[{"audio_url":"https://cdn.example/audio.mp3"}]}`))
	if err != nil || polled.Status != StatusSucceeded || polled.Result == nil || len(polled.Result.Audios) != 1 || polled.Result.Audios[0].URL != "https://cdn.example/audio.mp3" {
		t.Fatalf("polled = %#v, error = %v", polled, err)
	}
}
