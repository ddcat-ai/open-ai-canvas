package protocol

import (
	"context"
	"testing"
)

// Qwen-Image 3.0 / Wan 2.7 图像属于百炼多模态模型。官方要求走 image-generation /
// multimodal-generation 端点；用 OpenAI 图片端点会被网关判为“模型与端点不匹配”，
// 在官方错误码里表现为 url error。参考图只能放在 input.messages[].content[].image。
func TestDashscopeQwenImageUsesMultimodalEndpoint(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-qwen-image.yingce-plugin", "dashscope-qwen-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "qwen-image-3.0-pro", Prompt: "灰色圆点", AspectRatio: "3:4", ImageCount: 1,
	}})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/api/v1/services/aigc/image-generation/generation" {
		t.Fatalf("create = %#v", create)
	}
	if create.Headers["X-DashScope-Async"] != "enable" {
		t.Fatalf("create headers = %#v", create.Headers)
	}
	// 原生端点是域名根下的绝对路径，不在 compatible-mode 之下；originPath 让请求路径
	// 替换 Base URL 的路径段，渠道继续沿用 .../compatible-mode/v1 也能命中正确地址。
	if !create.OriginPath {
		t.Fatal("create 必须声明 originPath")
	}

	body := manifestTestBody(t, create)
	if body["model"] != "qwen-image-3.0-pro" {
		t.Fatalf("model = %#v", body["model"])
	}
	content := dashscopeQwenImageContent(t, body)
	if len(content) != 1 {
		t.Fatalf("文生图 content = %#v, 期望只有 text 一项", content)
	}
	entry, _ := content[0].(map[string]any)
	if entry["text"] != "灰色圆点" {
		t.Fatalf("text 项 = %#v", entry)
	}

	parameters, _ := body["parameters"].(map[string]any)
	if parameters["size"] != "960*1280" {
		t.Fatalf("size = %#v, 期望 960*1280（DashScope 用星号而非字母 x）", parameters["size"])
	}
	if parameters["enable_thinking"] != false {
		t.Fatalf("enable_thinking = %#v, 官方要求非流式调用必须为 false", parameters["enable_thinking"])
	}
	if parameters["n"] != float64(1) {
		t.Fatalf("n = %#v, 期望 1", parameters["n"])
	}
}

func TestDashscopeQwenImagePutsReferencesInMessageContent(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-qwen-image.yingce-plugin", "dashscope-qwen-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "qwen-image-3.0-pro", Prompt: "换装", AspectRatio: "1:1", ImageCount: 2,
		Images: []MediaReference{
			{DataURL: "data:image/png;base64,QUJD", Role: "reference_image", Order: 2},
			{URL: "https://cdn.example/anchor.png", Role: "edit_source", Order: 1},
		},
	}})
	if err != nil {
		t.Fatal(err)
	}

	content := dashscopeQwenImageContent(t, manifestTestBody(t, create))
	if len(content) != 3 {
		t.Fatalf("图生图 content = %#v, 期望 2 张图 + 1 条 text", content)
	}
	// order 决定顺序：先 order=1 的参考图，再 order=2；text 永远排在最后。
	first, _ := content[0].(map[string]any)
	if first["image"] != "https://cdn.example/anchor.png" {
		t.Fatalf("第一项 = %#v", first)
	}
	second, _ := content[1].(map[string]any)
	if second["image"] != "data:image/png;base64,QUJD" {
		t.Fatalf("第二项 = %#v, 有 dataUrl 时必须优先 Base64（大陆地域无法回源站外图片）", second)
	}
	third, _ := content[2].(map[string]any)
	if third["text"] != "换装" {
		t.Fatalf("末项 = %#v", third)
	}

	parameters, _ := manifestTestBody(t, create)["parameters"].(map[string]any)
	if parameters["n"] != float64(2) {
		t.Fatalf("n = %#v, 期望 2", parameters["n"])
	}
	if parameters["size"] != "1024*1024" {
		t.Fatalf("size = %#v", parameters["size"])
	}
}

func TestDashscopeQwenImageOmitsUnregisteredSize(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-qwen-image.yingce-plugin", "dashscope-qwen-image")
	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: GenerationRequest{
		Model: "qwen-image-3.0-pro", Prompt: "circle", AspectRatio: "2880x2880",
	}})
	if err != nil {
		t.Fatal(err)
	}
	parameters, _ := manifestTestBody(t, create)["parameters"].(map[string]any)
	if _, present := parameters["size"]; present {
		t.Fatalf("parameters = %#v, 未登记的档位必须省略 size 交由模型自动推荐", parameters)
	}
}

func TestDashscopeQwenImageLifecycleReadsMultimodalChoices(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-qwen-image.yingce-plugin", "dashscope-qwen-image")
	created, err := adapter.ParseCreate(context.Background(), []byte(`{"output":{"task_id":"task-qwen-1","task_status":"PENDING"},"request_id":"req-1"}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.TaskID != "task-qwen-1" {
		t.Fatalf("taskId = %q", created.TaskID)
	}

	poll, err := adapter.BuildPoll(context.Background(), PollContext{TaskID: created.TaskID})
	if err != nil {
		t.Fatal(err)
	}
	if poll.Method != "GET" || poll.Path != "/api/v1/tasks/task-qwen-1" {
		t.Fatalf("poll = %#v", poll)
	}
	if !poll.OriginPath {
		t.Fatal("poll 必须声明 originPath")
	}

	// 图片藏在 output.choices[0].message.content[].image，这是多模态端点与 wanx 的差异所在。
	completed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: created.TaskID}, []byte(`{"output":{"task_id":"task-qwen-1","task_status":"SUCCEEDED","choices":[{"finish_reason":"stop","message":{"role":"assistant","content":[{"image":"https://dashscope-result.example/a.png","type":"image"}]}}]},"usage":{"output_image_count":1},"request_id":"req-2"}`))
	if err != nil {
		t.Fatal(err)
	}
	if completed.Status != StatusSucceeded {
		t.Fatalf("status = %q, want %q", completed.Status, StatusSucceeded)
	}
	if completed.Result == nil || len(completed.Result.Images) != 1 {
		t.Fatalf("result = %#v", completed.Result)
	}
	if completed.Result.Images[0].URL != "https://dashscope-result.example/a.png" {
		t.Fatalf("images = %#v", completed.Result.Images)
	}
}

func TestDashscopeQwenImageSurfacesFailureMessage(t *testing.T) {
	adapter := officialPackageAdapter(t, "dashscope-qwen-image.yingce-plugin", "dashscope-qwen-image")
	failed, err := adapter.ParsePoll(context.Background(), PollContext{TaskID: "task-qwen-1"}, []byte(`{"output":{"task_id":"task-qwen-1","task_status":"FAILED","code":"InvalidParameter","message":"url error, please check url！"},"request_id":"req-3"}`))
	if err != nil {
		t.Fatal(err)
	}
	if failed.Status != StatusFailed {
		t.Fatalf("status = %q, want %q", failed.Status, StatusFailed)
	}
	if failed.Message == "" {
		t.Fatal("上游失败必须保留错误信息，不能被包装成成功")
	}
}

func dashscopeQwenImageContent(t *testing.T, body map[string]any) []any {
	t.Helper()
	input, _ := body["input"].(map[string]any)
	messages, _ := input["messages"].([]any)
	if len(messages) != 1 {
		t.Fatalf("messages = %#v", messages)
	}
	message, _ := messages[0].(map[string]any)
	if message["role"] != "user" {
		t.Fatalf("role = %#v", message["role"])
	}
	content, _ := message["content"].([]any)
	return content
}
