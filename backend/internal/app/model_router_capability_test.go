package app

import "testing"

func TestMatchCapabilityUsesUserFacingOperationLabel(t *testing.T) {
	match := MatchCapability(CapabilitySpec{Capability: "video", Operations: []string{"text_to_video"}}, ModelRequestIntent{
		Capability: "video",
		Operation:  "reference_to_video",
	})
	if match.Matched {
		t.Fatal("expected capability mismatch")
	}
	if len(match.Reasons) != 1 || match.Reasons[0] != "当前模型不支持「参考素材生成视频」" {
		t.Fatalf("unexpected reasons: %#v", match.Reasons)
	}
}

func TestMatchCapabilityUsesGenericOperationLabelForUnknownOperation(t *testing.T) {
	match := MatchCapability(CapabilitySpec{Capability: "video", Operations: []string{"text_to_video"}}, ModelRequestIntent{
		Capability: "video",
		Operation:  "vendor_private_mode",
	})
	if match.Matched {
		t.Fatal("expected capability mismatch")
	}
	if len(match.Reasons) != 1 || match.Reasons[0] != "当前模型不支持「当前生成方式」" {
		t.Fatalf("unexpected reasons: %#v", match.Reasons)
	}
}
