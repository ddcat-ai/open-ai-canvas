package protocol

import (
	"context"
	"encoding/json"
	"os"
	"testing"
)

// MiniMax T2A 协议插件的契约测试。
//
// MiniMax 的异步语音合成与常见「一次 POST 拿 URL」的形态不同，有三个容易写错的地方：
//
//	① 音色必须真的发出去：宿主把音色放在 `extra.audioVoice`（对外 API 的 OpenAI `voice` 参数）
//	   或 `request.providerOptions["minimax-t2a"].voice_id`，**不是** `extra.voiceId`；
//	   请求体里没有 voice_setting 时上游直接回 2013「no voice_id found」；
//	② 轮询路径是 `/v1/query/t2a_async_query_v2`，不是 `/v1/query/t2a_async`；
//	③ 响应字段全在**顶层**（没有 data 包装），且 `task_id` / `file_id` 是**数字**，
//	   两者不是同一个数：处理中用 task_id 轮询，成功后用 file_id 下载。
//
// 本测试把「真实发出的上游请求」与「真实响应的解析结果」都钉住：
// 上游形状来自官方文档（创建 / 查询 / 文件下载三个接口），不是从现象反推的猜测。
func TestMiniMaxT2AManifest(t *testing.T) {
	const file = "../../../plugin-packages/minimax-t2a/manifest.json"
	raw, err := os.ReadFile(file)
	if err != nil {
		t.Fatalf("读取 %s：%v", file, err)
	}
	adapters, err := LoadInstalledProviders(raw, nil)
	if err != nil {
		t.Fatalf("加载 %s：%v", file, err)
	}
	if len(adapters) != 1 {
		t.Fatalf("插件应提供 1 个 provider，实际 %d", len(adapters))
	}
	adapter := adapters[0]
	ctx := context.Background()

	t.Run("create-body", func(t *testing.T) {
		spec, err := adapter.BuildCreate(ctx, RequestContext{BaseURL: "https://api.minimaxi.com", Request: GenerationRequest{
			Model: "speech-02-hd", Prompt: "你好，世界。",
			ProviderOptions: map[string]map[string]any{"minimax-t2a": {
				"voice_id": "ttv-voice-2026091920460626-zDvYNcSI",
				"speed":    1.25, "vol": 2, "emotion": "happy",
			}},
		}})
		if err != nil {
			t.Fatalf("构建创建请求：%v", err)
		}
		if spec.Method != "POST" || spec.Path != "/v1/t2a_async_v2" {
			t.Fatalf("创建请求 = %s %s", spec.Method, spec.Path)
		}
		body := decodeBody(t, spec.Body)
		if body["model"] != "speech-02-hd" || body["text"] != "你好，世界。" {
			t.Fatalf("创建请求体 = %v", body)
		}
		voice := objectValue(t, body, "voice_setting")
		if voice["voice_id"] != "ttv-voice-2026091920460626-zDvYNcSI" {
			t.Fatalf("voice_id 必须来自 providerOptions，实际 %v", voice["voice_id"])
		}
		if voice["speed"] != float64(1.25) || voice["vol"] != float64(2) || voice["emotion"] != "happy" {
			t.Fatalf("voice_setting = %v", voice)
		}
		// pitch 没给 → 必须整体省略：上游对 null 会按参数错误处理。
		if _, exists := voice["pitch"]; exists {
			t.Fatalf("未提供 pitch 时不应发送该字段，实际 %v", voice["pitch"])
		}
		audio := objectValue(t, body, "audio_setting")
		if audio["format"] != "mp3" || audio["channel"] != float64(1) || audio["audio_sample_rate"] != float64(32000) {
			t.Fatalf("audio_setting = %v", audio)
		}
	})

	t.Run("create-body-voice-from-openai-surface", func(t *testing.T) {
		// 对外 API 的 /audio/speech 走的是 Extra.audioVoice（OpenAI 的 voice 参数），
		// 不是 providerOptions —— 这条链路必须也能拿到音色。
		spec, err := adapter.BuildCreate(ctx, RequestContext{BaseURL: "https://api.minimaxi.com", Request: GenerationRequest{
			Model: "speech-02-hd", Prompt: "你好。", Extra: map[string]any{"audioVoice": "female-tianmei"},
		}})
		if err != nil {
			t.Fatalf("构建创建请求：%v", err)
		}
		body := decodeBody(t, spec.Body)
		if got := objectValue(t, body, "voice_setting")["voice_id"]; got != "female-tianmei" {
			t.Fatalf("voice_id 应回落到 extra.audioVoice，实际 %v", got)
		}
	})

	t.Run("create-body-default-voice", func(t *testing.T) {
		// 音色缺省时也必须发一个合法音色：上游没有 voice_id 直接 2013，
		// 「面板里选了模型就能出活」比「必须先去别处挑一个音色」更符合画布用法。
		spec, err := adapter.BuildCreate(ctx, RequestContext{BaseURL: "https://api.minimaxi.com", Request: GenerationRequest{
			Model: "speech-02-hd", Prompt: "你好。",
		}})
		if err != nil {
			t.Fatalf("构建创建请求：%v", err)
		}
		body := decodeBody(t, spec.Body)
		if got := objectValue(t, body, "voice_setting")["voice_id"]; got != "male-qn-qingse" {
			t.Fatalf("默认音色应为 male-qn-qingse，实际 %v", got)
		}
	})

	t.Run("poll-path", func(t *testing.T) {
		spec, err := adapter.BuildPoll(ctx, PollContext{
			BaseURL: "https://api.minimaxi.com", Request: GenerationRequest{Model: "speech-02-hd"}, TaskID: "95157322514444",
		})
		if err != nil {
			t.Fatalf("构建轮询请求：%v", err)
		}
		if spec.Path != "/v1/query/t2a_async_query_v2?task_id=95157322514444" {
			t.Fatalf("轮询路径 = %s", spec.Path)
		}
	})

	t.Run("parse-create-numeric-task-id", func(t *testing.T) {
		// 真实响应（官方文档「创建异步语音合成任务」）：字段在顶层，task_id 是数字。
		created, err := adapter.ParseCreate(ctx, []byte(`{"task_id":95157322514444,"task_token":"eyJhbGciOiJSUz","file_id":95157322514444,"usage_characters":101,"base_resp":{"status_code":0,"status_msg":"success"}}`))
		if err != nil {
			t.Fatalf("解析创建响应：%v", err)
		}
		if created.TaskID != "95157322514444" {
			t.Fatalf("taskId 必须是数字转出来的字符串，实际 %q", created.TaskID)
		}
		if created.Status != StatusPending {
			t.Fatalf("创建响应没有 status，应为 pending，实际 %s", created.Status)
		}
	})

	t.Run("parse-create-upstream-error", func(t *testing.T) {
		// 上游参数错误时 task_id 是 0，且必须把**真实原因**浮上来，
		// 不能被宿主的兜底解析盖成「字段类型不对」。
		created, err := adapter.ParseCreate(ctx, []byte(`{"file_id":0,"task_id":0,"task_token":"","usage_characters":0,"base_resp":{"status_msg":"invalid params, no voice_id found","status_code":2013}}`))
		if err != nil {
			t.Fatalf("解析创建响应：%v", err)
		}
		if created.Status != StatusFailed {
			t.Fatalf("base_resp.status_code=2013 必须是失败，实际 %s", created.Status)
		}
		if created.Message != "invalid params, no voice_id found" {
			t.Fatalf("失败原因应取 base_resp.status_msg，实际 %q", created.Message)
		}
	})

	t.Run("parse-poll-processing-keeps-task-id", func(t *testing.T) {
		polled, err := adapter.ParsePoll(ctx, PollContext{TaskID: "95157322514444"}, []byte(`{"task_id":95157322514444,"status":"Processing","file_id":95157322514496,"base_resp":{"status_code":0,"status_msg":"success"}}`))
		if err != nil {
			t.Fatalf("解析轮询响应：%v", err)
		}
		if polled.Status != StatusProcessing {
			t.Fatalf("Processing 应归一为处理中，实际 %s", polled.Status)
		}
		if polled.TaskID != "95157322514444" {
			t.Fatalf("处理中必须继续用 task_id 轮询，实际 %q", polled.TaskID)
		}
	})

	t.Run("parse-poll-success-switches-to-file-id", func(t *testing.T) {
		// 下载用的是 file_id，**与 task_id 不是同一个数**（官方文档示例：
		// task_id 95157322514444 / file_id 95157322514496）。成功后必须把它交出去，
		// 宿主的 result 步骤才有得用。
		polled, err := adapter.ParsePoll(ctx, PollContext{TaskID: "95157322514444"}, []byte(`{"task_id":95157322514444,"status":"Success","file_id":95157322514496,"base_resp":{"status_code":0,"status_msg":"success"}}`))
		if err != nil {
			t.Fatalf("解析轮询响应：%v", err)
		}
		if polled.Status != StatusSucceeded {
			t.Fatalf("Success 应归一为成功，实际 %s", polled.Status)
		}
		if polled.TaskID != "95157322514496" {
			t.Fatalf("成功后应改用 file_id，实际 %q", polled.TaskID)
		}
	})

	t.Run("parse-poll-expired-is-failure", func(t *testing.T) {
		polled, err := adapter.ParsePoll(ctx, PollContext{TaskID: "1"}, []byte(`{"task_id":1,"status":"Expired","base_resp":{"status_code":0,"status_msg":"success"}}`))
		if err != nil {
			t.Fatalf("解析轮询响应：%v", err)
		}
		if polled.Status != StatusFailed {
			t.Fatalf("Expired 必须当失败，实际 %s", polled.Status)
		}
	})

	t.Run("result-path-downloads-by-file-id", func(t *testing.T) {
		resultAdapter, ok := adapter.(ResultAdapter)
		if !ok {
			t.Fatal("插件必须声明独立结果端点（音频要从 /v1/files/retrieve_content 取字节）")
		}
		capability, ok := adapter.(ResultCapability)
		if !ok || !capability.ResultAvailable() {
			t.Fatal("结果端点必须可用")
		}
		spec, err := resultAdapter.BuildResult(ctx, PollContext{BaseURL: "https://api.minimaxi.com", TaskID: "95157322514496"})
		if err != nil {
			t.Fatalf("构建结果请求：%v", err)
		}
		if spec.Path != "/v1/files/retrieve_content?file_id=95157322514496" {
			t.Fatalf("结果路径 = %s", spec.Path)
		}
	})
}

func decodeBody(t *testing.T, body any) map[string]any {
	t.Helper()
	encoded, err := json.Marshal(body)
	if err != nil {
		t.Fatalf("序列化请求体：%v", err)
	}
	var decoded map[string]any
	if err := json.Unmarshal(encoded, &decoded); err != nil {
		t.Fatalf("解析请求体：%v", err)
	}
	return decoded
}

func objectValue(t *testing.T, body map[string]any, key string) map[string]any {
	t.Helper()
	value, ok := body[key].(map[string]any)
	if !ok {
		t.Fatalf("请求体缺少对象字段 %s：%v", key, body)
	}
	return value
}
