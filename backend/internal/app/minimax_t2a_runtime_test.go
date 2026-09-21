package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
)

// MiniMax T2A 协议插件的**整条链路**测试：用一个假上游把创建 → 轮询 → 下载
// 三步真跑一遍（而不是只做清单形状断言），钉住三个最容易写错的地方：
//
//	① 创建请求必须带 voice_setting.voice_id（宿主的音色在 request.extra.audioVoice，
//	   请求体里没有 voice_setting 时上游回 2013「no voice_id found」）；
//	② 轮询打的是 /v1/query/t2a_async_query_v2，且**处理中一直用 task_id**；
//	③ 成功后下载用的是查询接口给的 **file_id**（与 task_id 不是同一个数），
//	   走 /v1/files/retrieve_content 取音频字节。
func TestMiniMaxT2AProtocolRuntimeEndToEnd(t *testing.T) {
	allowLoopbackProviderTest(t)
	// 插件包随包放在 plugin-packages/ 下，由运行时作为**内置插件**加载 ——
	// 这里不自行上传安装，跑的就是随包发布的那份产物。
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}

	const (
		taskID   = "95157322514444"
		fileID   = "95157322514496" // 官方文档示例里两者就不同，不能混用
		audioRaw = "ID3-minimax-t2a-audio-bytes"
	)
	var (
		createBody      map[string]any
		pollQueries     []string
		downloadQueries []string
	)
	polls := 0
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/v1/t2a_async_v2":
			if r.Method != http.MethodPost {
				t.Errorf("创建任务必须是 POST，实际 %s", r.Method)
			}
			body, _ := io.ReadAll(r.Body)
			_ = json.Unmarshal(body, &createBody)
			w.Header().Set("Content-Type", "application/json")
			// 真实创建响应：字段在顶层、task_id/file_id 是数字、没有 status。
			_, _ = w.Write([]byte(`{"task_id":` + taskID + `,"task_token":"eyJhbGciOiJSUz","file_id":` + taskID + `,"usage_characters":10,"base_resp":{"status_code":0,"status_msg":"success"}}`))
		case "/v1/query/t2a_async_query_v2":
			pollQueries = append(pollQueries, r.URL.RawQuery)
			polls++
			w.Header().Set("Content-Type", "application/json")
			if polls == 1 {
				_, _ = w.Write([]byte(`{"task_id":` + taskID + `,"status":"Processing","file_id":` + fileID + `,"base_resp":{"status_code":0,"status_msg":"success"}}`))
				return
			}
			_, _ = w.Write([]byte(`{"task_id":` + taskID + `,"status":"Success","file_id":` + fileID + `,"base_resp":{"status_code":0,"status_msg":"success"}}`))
		case "/v1/files/retrieve_content":
			downloadQueries = append(downloadQueries, r.URL.RawQuery)
			w.Header().Set("Content-Type", "audio/mpeg")
			_, _ = w.Write([]byte(audioRaw))
		default:
			http.NotFound(w, r)
		}
	}))
	defer server.Close()

	config := providerConfig{
		BaseURL: server.URL, APIKey: "key", Model: "speech-02-hd",
		APIFormat: "openai", InterfaceType: "minimax-t2a",
		AudioVoice: "female-tianmei", AudioFormat: "mp3",
	}
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, config.InterfaceType)
	if !ok {
		t.Fatal("声明式适配器不可用")
	}
	result, err := runProtocolAdapterTaskWithPolicy(ctx, canvasGenerationInput{Mode: "audio", Prompt: "你好，世界。", Config: config}, adapter, fastVideoPollPolicy())
	if err != nil {
		t.Fatalf("跑 T2A 任务：%v", err)
	}

	// ① 创建请求：音色必须真的发出去（旧版就是这里漏的）。
	voice, _ := createBody["voice_setting"].(map[string]any)
	if createBody["model"] != "speech-02-hd" || createBody["text"] != "你好，世界。" {
		t.Fatalf("创建请求体 = %v", createBody)
	}
	if voice["voice_id"] != "female-tianmei" {
		t.Fatalf("voice_setting.voice_id 必须来自 extra.audioVoice，实际 %v（创建请求体 %v）", voice["voice_id"], createBody)
	}
	audio, _ := createBody["audio_setting"].(map[string]any)
	if audio["format"] != "mp3" {
		t.Fatalf("audio_setting = %v", audio)
	}

	// ② 轮询：两次都必须用 task_id（处理中那次不能换成 file_id，否则查不到任务）。
	if len(pollQueries) != 2 {
		t.Fatalf("应轮询两次（一次处理中、一次成功），实际 %d 次：%v", len(pollQueries), pollQueries)
	}
	for index, query := range pollQueries {
		if query != "task_id="+taskID {
			t.Fatalf("第 %d 次轮询应带 task_id，实际 %q", index+1, query)
		}
	}

	// ③ 下载：必须用 file_id（不是 task_id）。
	if len(downloadQueries) != 1 {
		t.Fatalf("应下载一次，实际 %d 次：%v", len(downloadQueries), downloadQueries)
	}
	if downloadQueries[0] != "file_id="+fileID {
		t.Fatalf("下载应带 file_id，实际 %q", downloadQueries[0])
	}

	// 结果必须是音频字节本身，而不是「拿 JSON 当音频」。
	if result["mode"] != "audio" {
		t.Fatalf("结果 = %#v", result)
	}
	item, _ := result["audio"].(map[string]any)
	dataURL, _ := item["dataUrl"].(string)
	const prefix = "data:audio/mpeg;base64,"
	if !strings.HasPrefix(dataURL, prefix) {
		t.Fatalf("音频必须是 data URL，实际 %q", dataURL)
	}
	decoded, err := base64.StdEncoding.DecodeString(strings.TrimPrefix(dataURL, prefix))
	if err != nil {
		t.Fatalf("解码音频：%v", err)
	}
	if string(decoded) != audioRaw {
		t.Fatalf("音频字节被改写：%q", decoded)
	}
}

// 上游参数错误必须把**真实原因**带出来，不能被宿主的兜底解析盖成「字段类型不对」：
// MiniMax 参数错误时回的是顶层 base_resp（例如 2013「no voice_id found」），
// 同时 task_id 是数字 0 —— 若按 task_id 的类型先失败，真正的原因就丢了。
func TestMiniMaxT2AProtocolRuntimeSurfacesUpstreamError(t *testing.T) {
	allowLoopbackProviderTest(t)
	// 插件包随包放在 plugin-packages/ 下，由运行时作为**内置插件**加载 ——
	// 这里不自行上传安装，跑的就是随包发布的那份产物。
	center, err := newPluginRuntime(t.TempDir())
	if err != nil {
		t.Fatal(err)
	}
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"file_id":0,"task_id":0,"task_token":"","usage_characters":0,"base_resp":{"status_msg":"invalid params, no voice_id found","status_code":2013}}`))
	}))
	defer server.Close()

	config := providerConfig{BaseURL: server.URL, APIKey: "key", Model: "speech-02-hd", APIFormat: "openai", InterfaceType: "minimax-t2a"}
	ctx := withProtocolRegistry(context.Background(), center.registrySnapshot())
	adapter, ok := declarativeProtocolAdapterForContext(ctx, config.InterfaceType)
	if !ok {
		t.Fatal("声明式适配器不可用")
	}
	_, err = runProtocolAdapterTaskWithPolicy(ctx, canvasGenerationInput{Mode: "audio", Prompt: "你好。", Config: config}, adapter, fastVideoPollPolicy())
	if err == nil {
		t.Fatal("上游 2013 必须让任务失败")
	}
	if !strings.Contains(err.Error(), "no voice_id found") {
		t.Fatalf("必须把上游真实原因带出来，实际 %v", err)
	}
	if strings.Contains(err.Error(), "expected string") {
		t.Fatalf("不能报宿主兜底解析的类型错，实际 %v", err)
	}
}
