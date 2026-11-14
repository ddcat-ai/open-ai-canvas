package protocol

import (
	"context"
	"testing"
)

// TestOfficialDoubaoWebImageSync 校验内置豆包网页驱动生图 provider：同步
// /v1/images/generations、data URL 参考图直传本机桥、响应 data[].url（桥侧已带
// Referer 下载转内联 data URL）映射为图片结果。
func TestOfficialDoubaoWebImageSync(t *testing.T) {
	adapter := officialPackageAdapter(t, "doubao-web.yingce-plugin", "doubao-web-image")
	if adapter.Metadata().RequiresPublicMediaURLs {
		t.Fatal("doubao-web-image must keep requiresPublicMediaUrls=false (data URL 结果/参考图直传本机桥)")
	}
	request := GenerationRequest{
		Capability: CapabilityImage,
		Model:      "doubao_image_1.0",
		Prompt:     "赛博朋克风格的城市夜景",
		Images:     []MediaReference{{DataURL: "data:image/png;base64,aGVsbG8=", Kind: "image"}},
		Metadata:   map[string]any{"nodeId": "image-node"},
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/images/generations" || create.ContentType != "application/json" {
		t.Fatalf("doubao-web-image create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if metadata, ok := body["metadata"].(map[string]any); !ok || metadata["nodeId"] != "image-node" {
		t.Fatalf("doubao-web-image metadata = %#v", body["metadata"])
	}
	if body["model"] != request.Model || body["prompt"] != request.Prompt {
		t.Fatalf("doubao-web-image create body = %#v", body)
	}
	refs, _ := body["reference_images"].([]any)
	if len(refs) != 1 || refs[0] != request.Images[0].DataURL {
		t.Fatalf("doubao-web-image reference_images = %#v", refs)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"created":1780000000,"data":[{"url":"data:image/png;base64,aW1hZ2U="}]}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != StatusSucceeded || created.Result == nil || len(created.Result.Images) != 1 {
		t.Fatalf("doubao-web-image create result = %#v", created)
	}
	// data: 内联结果必须落在 DataURL（checkpoint 按内联字节暂存），URL 字段留空——
	// 多 MB base64 进 URL 会被媒体恢复管线的 16KB 地址上限拦成「记录恢复信息失败」。
	image := created.Result.Images[0]
	if image.URL != "" || image.DataURL != "data:image/png;base64,aW1hZ2U=" {
		t.Fatalf("doubao-web-image inline result must map to DataURL, got %#v", image)
	}
}

// TestOfficialDoubaoWebTextSync 校验内置豆包网页驱动文本 provider：同步
// /v1/chat/completions、messages 透传、choices.0.message.content 映射；
// 不含 agent scope（网页驱动无法工具调用）。
func TestOfficialDoubaoWebTextSync(t *testing.T) {
	adapter := officialPackageAdapter(t, "doubao-web.yingce-plugin", "doubao-web-text")
	for _, scope := range adapter.Metadata().Scopes {
		if scope == "agent" {
			t.Fatal("doubao-web-text must not expose agent scope (网页驱动不支持工具调用)")
		}
	}
	request := GenerationRequest{
		Capability: CapabilityText,
		Model:      "doubao_text_1.0",
		Messages: []Message{
			{Role: "system", Content: "你是一个简洁的助手"},
			{Role: "user", Content: "用一句话介绍影策"},
		},
	}

	create, err := adapter.BuildCreate(context.Background(), RequestContext{Request: request})
	if err != nil {
		t.Fatal(err)
	}
	if create.Method != "POST" || create.Path != "/v1/chat/completions" || create.ContentType != "application/json" {
		t.Fatalf("doubao-web-text create = %#v", create)
	}
	body := manifestTestBody(t, create)
	if body["model"] != request.Model {
		t.Fatalf("doubao-web-text create body = %#v", body)
	}
	msgs, _ := body["messages"].([]any)
	if len(msgs) != 2 {
		t.Fatalf("doubao-web-text messages = %#v", msgs)
	}

	created, err := adapter.ParseCreate(context.Background(), []byte(`{"id":"chatcmpl-task_abc","object":"chat.completion","choices":[{"index":0,"message":{"role":"assistant","content":"影策是画布式 AI 创作工具"},"finish_reason":"stop"}],"usage":{"prompt_tokens":10,"completion_tokens":8,"total_tokens":18}}`))
	if err != nil {
		t.Fatal(err)
	}
	if created.Status != StatusSucceeded || created.Result == nil || created.Result.Text != "影策是画布式 AI 创作工具" {
		t.Fatalf("doubao-web-text create result = %#v", created)
	}
}
