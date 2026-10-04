package app

import "testing"

// 复现：canvas_inspect_image 看图后下一次模型调用报「模型协议引用了未获准的图片」。
func TestCloudAgentPiStepImageReferencesSatisfyPlaceholderPreflight(t *testing.T) {
	s, _, _ := cloudAgentVisionFixture(t)
	state := cloudAgentRuntime{Request: agentTestRequest()}
	state.Request.VisionEnabled = true
	call := cloudAgentStoryboardCall(t, "canvas_inspect_image", "inspect-cat", map[string]any{"nodeId": "cat"})
	result, err := s.prepareCloudAgentImageInspection("user", "agent-canvas", &state, call)
	if err != nil {
		t.Fatal(err)
	}
	history := []map[string]any{
		{"role": "user", "content": "参考左侧素材"},
		{"role": "user", "content": cloudAgentImageContentParts(result.(cloudAgentImageInspection))},
	}

	// 不带清单时预检拒绝，复现修复前的失败。
	bare := canonicalAgentRequest{ToolChoice: "auto", Messages: history}
	if err := validateAgentResourcePlaceholders(canvasGenerationInput{Mode: "text", AgentRequests: &agentToolRequests{Canonical: &bare}}); err == nil {
		t.Fatal("placeholder without approved references passed preflight")
	}

	canonical := canonicalAgentRequest{ToolChoice: "auto", Messages: history}
	references, err := s.cloudAgentPiStepImageReferences("user", state.Request, &canonical)
	if err != nil {
		t.Fatal(err)
	}
	if len(references) != 1 {
		t.Fatalf("references = %#v, want the inspected image", references)
	}
	input := canvasGenerationInput{Mode: "text", ReferenceImages: references, AgentRequests: &agentToolRequests{Canonical: &canonical}}
	if err := validateAgentResourcePlaceholders(input); err != nil {
		t.Fatalf("preflight still rejects the inspected image: %v", err)
	}

	// 没有图片的历史不产生清单，也不报错。
	plain := canonicalAgentRequest{ToolChoice: "auto", Messages: history[:1]}
	if refs, err := s.cloudAgentPiStepImageReferences("user", state.Request, &plain); err != nil || len(refs) != 0 {
		t.Fatalf("text-only history: refs=%#v err=%v", refs, err)
	}
}
