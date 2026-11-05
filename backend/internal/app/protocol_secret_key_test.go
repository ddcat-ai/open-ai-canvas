package app

import (
	"strings"
	"testing"

	"yingce/backend/internal/model"
)

// 第二把密钥只看插件 auth.secretField 声明：即梦、腾讯混元、AWS Bedrock 都要 Secret Key，
// 普通 Bearer 插件不要。
func TestChannelModelContractRequiresSecretKeyFromDeclaredAuth(t *testing.T) {
	registry := loadOfficialFallbackRegistry()
	withoutSecret := &model.ModelChannel{APIKey: "access-key"}
	withSecret := &model.ModelChannel{APIKey: "access-key", SecretKey: "secret-key"}
	for _, test := range []struct {
		protocol, capability string
		requiresSecret       bool
	}{
		{"volcengine-jimeng-image", "image", true},
		{"volcengine-jimeng-video", "video", true},
		{"tencent-hunyuan-image", "image", true},
		{"tencent-hunyuan-video", "video", true},
		{"aws-bedrock-converse", "text", true},
		{"deepseek-chat", "text", false},
	} {
		req := ChannelModelRequest{ModelKey: "model-a", Capability: test.capability, Protocol: test.protocol}
		_, _, _, _, err := normalizeChannelModelContractWithRegistry(registry, withoutSecret, req)
		if test.requiresSecret != (err != nil) {
			t.Fatalf("%s without Secret Key error = %v, requiresSecret = %v", test.protocol, err, test.requiresSecret)
		}
		if err != nil && !strings.Contains(err.Error(), "Secret Key") {
			t.Fatalf("%s error must name the missing Secret Key: %v", test.protocol, err)
		}
		if _, _, _, _, err := normalizeChannelModelContractWithRegistry(registry, withSecret, req); err != nil {
			t.Fatalf("%s with both keys error = %v", test.protocol, err)
		}
	}
}

// 未安装官方插件时，内置即梦视频适配器也带着同一份鉴权声明。
func TestBuiltinJiMengVideoContractRequiresSecretKey(t *testing.T) {
	req := ChannelModelRequest{ModelKey: "jimeng-video", Capability: "video", Protocol: string(model.ChannelInterfaceVolcengineJiMengVideo)}
	if _, _, _, _, err := normalizeChannelModelContract(&model.ModelChannel{APIKey: "access-key"}, req); err == nil {
		t.Fatal("builtin JiMeng video must require a Secret Key")
	}
	if _, _, _, _, err := normalizeChannelModelContract(&model.ModelChannel{APIKey: "access-key", SecretKey: "secret-key"}, req); err != nil {
		t.Fatalf("builtin JiMeng video with both keys error = %v", err)
	}
}

func TestVideoTestSecondsFollowsDeclaredDefault(t *testing.T) {
	if got := videoTestSeconds(nil); got != 6 {
		t.Fatalf("videoTestSeconds(nil) = %d, want 6", got)
	}
	novita := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceNovitaVideo), "").Video
	if got := videoTestSeconds(novita); got != 5 {
		t.Fatalf("enum 5/10 profile test seconds = %d, want 5", got)
	}
	veo := DefaultModelCapabilityConfigForModel(string(model.ChannelInterfaceGeminiVeo), "").Video
	if got := videoTestSeconds(veo); got != veo.Duration.Default {
		t.Fatalf("veo test seconds = %d, want declared default %d", got, veo.Duration.Default)
	}
}
