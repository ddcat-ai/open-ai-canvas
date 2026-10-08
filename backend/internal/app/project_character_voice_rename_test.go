package app

import (
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

func TestCharacterVoiceRebindUsesLatestSampleName(t *testing.T) {
	service, db, _, _ := creationTestService(t)
	now := time.Now()
	for _, item := range []any{
		&model.Resource{ID: "voice-sample", UserID: "user", Kind: "audio", Status: model.ResourceStatusReady, MimeType: "audio/mpeg", Size: 10},
		&model.VoiceProfile{ID: "sample-profile", UserID: "user", Name: "生成音频", Provider: "user_upload", VoiceKey: "sample:voice-sample", SampleResourceID: "voice-sample", CompatibleModelsJSON: "[]", Status: "active", CreatedAt: now, UpdatedAt: now},
	} {
		if err := db.Create(item).Error; err != nil {
			t.Fatal(err)
		}
	}
	binding, err := service.characterVoiceForResource("user", "voice-sample", "杨过·声音", "", now)
	if err != nil || binding.VoiceProfileID != "sample-profile" {
		t.Fatalf("binding = %#v, %v", binding, err)
	}
	var renamed model.VoiceProfile
	if err := db.First(&renamed, "id = ?", "sample-profile").Error; err != nil || renamed.Name != "杨过·声音" {
		t.Fatalf("sample voice kept stale name: %q, %v", renamed.Name, err)
	}
	// 空名字不能把已有名字清掉。
	if _, err := service.characterVoiceForResource("user", "voice-sample", "  ", "", now); err != nil {
		t.Fatal(err)
	}
	if err := db.First(&renamed, "id = ?", "sample-profile").Error; err != nil || renamed.Name != "杨过·声音" {
		t.Fatalf("empty name overwrote voice name: %q, %v", renamed.Name, err)
	}
	// 内置音色名称由系统维护，不跟随用户输入改名。
	builtin := model.VoiceProfile{ID: "builtin-profile", Provider: "openai", Name: "alloy"}
	if err := service.renameSampleVoiceProfile("user", &builtin, "改名"); err != nil || builtin.Name != "alloy" {
		t.Fatalf("builtin voice renamed: %q, %v", builtin.Name, err)
	}
}
