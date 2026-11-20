package protocol

import (
	"context"
	"testing"
)

func TestMiniMaxSpeechModelsBuildAndParse(t *testing.T) {
	adapter := officialPackageAdapter(t, "minimax-speech.yingce-plugin", "minimax-speech")
	models := []string{"speech-2.8-hd", "speech-2.8-turbo", "speech-2.6-hd", "speech-2.6-turbo", "speech-02-hd", "speech-02-turbo"}
	for _, model := range models {
		t.Run(model, func(t *testing.T) {
			spec, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
				Model: model, Prompt: "你好，欢迎来到影策。", Extra: map[string]any{"audioVoice": "male-qn-jingying", "audioSpeed": "1.25", "audioFormat": "mp3"},
			}})
			if err != nil {
				t.Fatal(err)
			}
			body := manifestTestBody(t, spec)
			voice := body["voice_setting"].(map[string]any)
			if spec.Path != "/v1/t2a_v2" || body["model"] != model || body["text"] != "你好，欢迎来到影策。" || body["stream"] != false || body["output_format"] != "url" || voice["voice_id"] != "male-qn-jingying" || voice["speed"] != 1.25 {
				t.Fatalf("request = %#v", body)
			}
		})
	}
	result, err := adapter.ParseCreate(context.Background(), []byte(`{"data":{"audio":"https://example.com/speech.mp3"},"base_resp":{"status_code":0,"status_msg":"success"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if result.Status != StatusSucceeded || result.Result == nil || len(result.Result.Audios) != 1 || result.Result.Audios[0].URL != "https://example.com/speech.mp3" || !result.Result.Audios[0].Ephemeral {
		t.Fatalf("result = %#v", result)
	}
	failed, err := adapter.ParseCreate(context.Background(), []byte(`{"data":null,"base_resp":{"status_code":1001,"status_msg":"invalid voice"}}`))
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != StatusFailed || failed.Result != nil {
		t.Fatalf("failed result = %#v", failed)
	}
}
