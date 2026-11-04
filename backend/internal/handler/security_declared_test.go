package handler

import (
	"net/http"
	"testing"

	"yingce/backend/internal/model"
)

// 内置协议名单：内置实现覆盖的全部协议都算内置，官方插件复用这些 ID 时保持原行为。
func TestIsBuiltinProxyProtocol(t *testing.T) {
	builtin := []model.ChannelInterfaceType{
		model.ChannelInterfaceChatCompletion,
		model.ChannelInterfaceOpenAIResponse,
		model.ChannelInterfaceClaudeAPI,
		model.ChannelInterfaceOpenAIImage,
		model.ChannelInterfaceGrokImage,
		model.ChannelInterfaceOpenAIAudio,
		model.ChannelInterfaceDoubaoStreamingTTS,
		model.ChannelInterfaceNewAPIVideo,
		model.ChannelInterfaceNewAPIChannel1,
		model.ChannelInterfaceNewAPIChannel2,
		model.ChannelInterfaceXAIVideo,
		model.ChannelInterfaceVolcengineArkVideo,
		model.ChannelInterfaceVolcengineArkAgentPlanVideo,
		model.ChannelInterfaceVolcengineArkImage,
		model.ChannelInterfaceVolcengineArkAgentPlanImage,
		model.ChannelInterfaceVolcengineJiMengImage,
		model.ChannelInterfaceVolcengineJiMengVideo,
		model.ChannelInterfaceGeminiVeo,
		model.ChannelInterfaceGeminiImage,
		model.ChannelInterfaceNovitaVideo,
		model.ChannelInterfaceMiniMaxVideo,
		model.ChannelInterfaceAgnesVideo,
		model.ChannelInterfaceRunningHubImage,
	}
	for _, protocol := range builtin {
		if !isBuiltinProxyProtocol(protocol) {
			t.Fatalf("%q 应判为内置协议", protocol)
		}
	}
	for _, protocol := range []model.ChannelInterfaceType{"vendor-chat", "vendor-image-banana", "vendor-video", ""} {
		if isBuiltinProxyProtocol(protocol) {
			t.Fatalf("%q 不应判为内置协议", protocol)
		}
	}
}

// 内置协议的路径白名单行为不变（含官方插件复用内置 ID 的那些）。
func TestInterfaceAllowsProxyPathKeepsBuiltinRules(t *testing.T) {
	cases := []struct {
		interfaceType model.ChannelInterfaceType
		path          string
		want          bool
	}{
		{model.ChannelInterfaceChatCompletion, "/chat/completions", true},
		{model.ChannelInterfaceChatCompletion, "/responses", false},
		{model.ChannelInterfaceOpenAIResponse, "/responses", true},
		{model.ChannelInterfaceClaudeAPI, "/messages", true},
		{model.ChannelInterfaceOpenAIImage, "/images/edits", true},
		{model.ChannelInterfaceOpenAIImage, "/images/generations", true},
		{model.ChannelInterfaceGrokImage, "/images/edits", true},
		{model.ChannelInterfaceOpenAIAudio, "/audio/speech", true},
		{model.ChannelInterfaceMiniMaxVideo, "/v2/video_generation", false},
		{model.ChannelInterfaceVolcengineArkVideo, "/contents/generations/tasks", false},
		{model.ChannelInterfaceNewAPIVideo, "/videos", false},
		{model.ChannelInterfaceXAIVideo, "/videos/generations", false},
	}
	for _, test := range cases {
		if got := interfaceAllowsProxyPath(test.interfaceType, test.path); got != test.want {
			t.Fatalf("interfaceAllowsProxyPath(%q, %q) = %v, want %v", test.interfaceType, test.path, got, test.want)
		}
	}
}

// 内置协议的系统代理判定不走声明分支：openai-image 的 /images/edits 仍放行，方舟视频仍拒绝。
func TestAuthorizeSystemProxyKeepsBuiltinProtocolBehavior(t *testing.T) {
	channel := &model.ModelChannel{ModelsJSON: `["gpt-image-2"]`}
	body := []byte(`{"model":"gpt-image-2"}`)
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceOpenAIImage, http.MethodPost, "/images/edits", "application/json", body); err != nil {
		t.Fatalf("openai-image /images/edits 应放行：%v", err)
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceVolcengineArkVideo, http.MethodPost, "/contents/generations/tasks", "application/json", body); err == nil {
		t.Fatal("volcengine-ark-video 应继续拒绝")
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceDoubaoStreamingTTS, http.MethodPost, "/audio/speech", "application/json", body); err != nil {
		t.Fatalf("doubao-streaming-tts 的 /audio/speech 应保持放行：%v", err)
	}
	if err := authorizeSystemProxy(channel, model.ChannelInterfaceChatCompletion, http.MethodPost, "/chat/completions", "application/json", body); err != nil {
		t.Fatalf("chat-completion 应保持放行：%v", err)
	}
}

// 声明式插件协议：create 的 POST 需要模型授权，非 create 只允许 GET（DELETE 取消不走系统代理）。
func TestAuthorizeDeclaredProxyRequest(t *testing.T) {
	channel := &model.ModelChannel{ModelsJSON: `["vendor-model"]`}
	body := []byte(`{"model":"vendor-model"}`)

	if err := authorizeDeclaredProxyRequest(true, true, true, channel, http.MethodPost, "application/json", body); err != nil {
		t.Fatalf("声明的 create POST 应放行：%v", err)
	}
	if err := authorizeDeclaredProxyRequest(true, false, true, channel, http.MethodGet, "", nil); err != nil {
		t.Fatalf("声明的 GET 轮询应放行：%v", err)
	}
	if err := authorizeDeclaredProxyRequest(true, false, true, channel, http.MethodDelete, "", nil); err == nil {
		t.Fatal("DELETE 取消不应经系统代理放行")
	}
	if err := authorizeDeclaredProxyRequest(true, false, false, channel, http.MethodGet, "", nil); err == nil {
		t.Fatal("未声明路径应拒绝")
	}
	if err := authorizeDeclaredProxyRequest(false, false, false, channel, http.MethodGet, "", nil); err == nil {
		t.Fatal("没装插件时不应由声明分支放行")
	}
	if err := authorizeDeclaredProxyRequest(true, true, true, channel, http.MethodPost, "application/json", []byte(`{"model":"other"}`)); err == nil {
		t.Fatal("未授权模型应拒绝")
	}
}
