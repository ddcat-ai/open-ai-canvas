package protocol

import (
	"context"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

// IndexTTS2 的音色完全来自 prompt_simple 参考音频，缺失时上游返回“缺少必填参数”，
// 因此插件必须把画布连线的参考音频映射过去，并在本地拦截未连接音频的请求。
func TestAutoDLIndexTTS2Workflow(t *testing.T) {
	data, err := os.ReadFile(filepath.Join("..", "..", "..", "plugin-packages", "autodl-comfyui.yingce-plugin"))
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := ParsePluginPackage(data)
	if err != nil {
		t.Fatal(err)
	}
	adapters, err := LoadInstalledProviders(pkg.ManifestRaw, nil)
	if err != nil {
		t.Fatal(err)
	}
	var adapter Adapter
	for _, a := range adapters {
		if a.Metadata().ID == "autodl-comfyui-audio" {
			adapter = a
		}
	}
	if adapter == nil {
		t.Fatal("autodl-comfyui-audio provider adapter not found")
	}
	if !adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("IndexTTS2 reference audio must be sent as public URLs")
	}

	if _, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Capability: CapabilityAudio, Model: "indextts2-v1", Prompt: "你好，这是一段测试文本",
	}}); err == nil || !strings.Contains(err.Error(), "音色参考音频") {
		t.Fatalf("missing prompt_simple must be rejected locally, err = %v", err)
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Capability: CapabilityAudio, Model: "indextts2-v1", Prompt: "你好，这是一段测试文本",
		Audios: []MediaReference{{URL: "https://cdn.example/voice.mp3", Order: 0}},
		Extra:  map[string]any{"audioVoice": "alloy"},
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v1/comfyui/comfyui_workflow/indextts2-v1" {
		t.Fatalf("create spec = %#v", create)
	}
	body := create.Body.(map[string]any)
	if body["prompt_text"] != "你好，这是一段测试文本" || body["prompt_simple"] != "https://cdn.example/voice.mp3" || body["emo_control_method"] != "与音色参考音频相同" || body["emo_random"] != false {
		t.Fatalf("single reference body = %#v", body)
	}
	for _, name := range []string{"emo_happy", "emo_angry", "emo_sad", "emo_afraid", "emo_disgusted", "emo_melancholic", "emo_surprised", "emo_calm"} {
		if value, ok := body[name]; !ok || manifestFloat(value) != 0 {
			t.Fatalf("%s = %#v, body = %#v", name, value, body)
		}
	}
	for _, name := range []string{"emo_ref_audio", "voice", "prompt"} {
		if _, exists := body[name]; exists {
			t.Fatalf("single reference body must not send %s: %#v", name, body)
		}
	}

	withEmotion, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Capability: CapabilityAudio, Model: "indextts2-v1", Prompt: "测试",
		Audios:          []MediaReference{{URL: "https://cdn.example/emotion.mp3", Order: 2}, {URL: "https://cdn.example/voice.mp3", Order: 1}},
		ProviderOptions: map[string]map[string]any{"autodl-comfyui-audio": {"emo_happy": 0.5, "emo_calm": 0.3}},
	}})
	if err != nil {
		t.Fatal(err)
	}
	emotionBody := withEmotion.Body.(map[string]any)
	if emotionBody["prompt_simple"] != "https://cdn.example/voice.mp3" || emotionBody["emo_ref_audio"] != "https://cdn.example/emotion.mp3" || emotionBody["emo_control_method"] != "使用情感参考音频" || manifestFloat(emotionBody["emo_happy"]) != 0.5 || manifestFloat(emotionBody["emo_calm"]) != 0.3 {
		t.Fatalf("emotion reference body = %#v", emotionBody)
	}

	if _, err := adapter.BuildCreate(context.Background(), RequestContext{BaseURL: "https://autodl.art", Request: GenerationRequest{
		Capability: CapabilityAudio, Model: "indextts2-v1", Prompt: "测试",
		Audios: []MediaReference{{URL: "https://cdn.example/a.mp3"}, {URL: "https://cdn.example/b.mp3", Order: 1}, {URL: "https://cdn.example/c.mp3", Order: 2}},
	}}); err == nil {
		t.Fatal("more than two reference audios must be rejected")
	}

	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "671ce5ca"}, []byte(`{"msg":"","code":"Success","data":{"status":"completed","results":[{"url":"https://cos.example/ComfyUI_00010_.wav","type":"audio","node_id":"9","file_type":"wav","output_type":"output"}],"task_id":"671ce5ca"}}`))
	if err != nil || completed.Status != StatusSucceeded || completed.Result == nil || len(completed.Result.Audios) != 1 || completed.Result.Audios[0].URL != "https://cos.example/ComfyUI_00010_.wav" {
		t.Fatalf("completed = %#v, err = %v", completed, err)
	}
}
