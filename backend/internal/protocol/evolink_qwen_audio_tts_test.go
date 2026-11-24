package protocol

import (
	"context"
	"strings"
	"testing"
)

func TestEvoLinkQwenAudioTTSCreateAndPoll(t *testing.T) {
	adapter := officialPackageAdapter(t, "evolink-seed-audio.yingce-plugin", "evolink-qwen-audio-tts")
	request := GenerationRequest{
		Capability: CapabilityAudio,
		Model:      "qwen-audio-3.1-tts-flash",
		Prompt:     "你好，欢迎使用语音合成。",
		Extra: map[string]any{
			"audioVoice": "anmingyuan_v3.1", "audioInstructions": "自然、平静地说", "audioFormat": "wav", "audioSpeed": "1.2",
		},
	}
	created, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if created.Method != "POST" || created.Path != "/v1/audios/generations" {
		t.Fatalf("create = %#v", created)
	}
	body := manifestTestBody(t, created)
	if body["model"] != request.Model || body["prompt"] != request.Prompt || body["voice"] != "anmingyuan_v3.1" || body["instruction"] != "自然、平静地说" || body["response_format"] != "wav" || body["speech_rate"] != 1.2 || body["sample_rate"] != float64(24000) {
		t.Fatalf("audio request = %#v", body)
	}
	if _, exists := body["audio_references"]; exists {
		t.Fatalf("TTS request must not include references: %#v", body)
	}
	createdResult, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"task-1","status":"pending"}`))
	if err != nil || createdResult.TaskID != "task-1" || createdResult.Status != StatusPending {
		t.Fatalf("create result = %#v, error = %v", createdResult, err)
	}
	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: "task-1"})
	if err != nil || poll.Path != "/v1/tasks/task-1" {
		t.Fatalf("poll = %#v, error = %v", poll, err)
	}
	polled, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-1"}, []byte(`{"id":"task-1","status":"completed","result_data":[{"audio_url":"https://cdn.example/audio.wav"}],"usage":{"input_tokens":12,"output_tokens":80}}`))
	if err != nil || polled.Status != StatusSucceeded || polled.Result == nil || len(polled.Result.Audios) != 1 || polled.Result.Audios[0].URL != "https://cdn.example/audio.wav" {
		t.Fatalf("poll result = %#v, error = %v", polled, err)
	}
	if polled.Result.Usage["output_tokens"] != float64(80) {
		t.Fatalf("usage = %#v", polled.Result.Usage)
	}
}

func TestEvoLinkQwenAudioTTSRejectsReferencesAndLongText(t *testing.T) {
	adapter := officialPackageAdapter(t, "evolink-seed-audio.yingce-plugin", "evolink-qwen-audio-tts")
	for _, request := range []GenerationRequest{
		{Capability: CapabilityAudio, Model: "qwen-audio-3.1-tts-flash", Prompt: strings.Repeat("a", 5001)},
		{Capability: CapabilityAudio, Model: "qwen-audio-3.1-tts-flash", Prompt: "你好", Audios: []MediaReference{{Kind: "audio", URL: "https://example.com/voice.wav"}}},
	} {
		if _, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request}); err == nil {
			t.Fatalf("invalid request accepted: %#v", request)
		}
	}
}
