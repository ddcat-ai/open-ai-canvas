package app

import (
	"encoding/json"
	"strings"
	"testing"
)

func TestCloudAgentMediaReferencePrompt(t *testing.T) {
	ref := func(name string) map[string]any {
		return map[string]any{"name": name, "storageKey": "resource:test"}
	}
	refs := map[string]any{
		"referenceImages": []any{ref("人物"), ref("假发")},
		"referenceAudios": []any{ref("声音")},
		"referenceVideos": []any{ref("运镜")},
	}
	prompt := "人物严格参考 @图片1，保持一镜到底。"
	got, err := cloudAgentMediaReferencePrompt(prompt, refs)
	if err != nil {
		t.Fatal(err)
	}
	want := prompt + "\n\n【资产参考】\n假发：@图片2\n运镜：@视频1\n声音：@音频1"
	if got != want {
		t.Fatalf("prompt = %q, want %q", got, want)
	}
	if again, err := cloudAgentMediaReferencePrompt(got, refs); err != nil || again != got {
		t.Fatalf("approval revalidation duplicated mentions: %q, %v", again, err)
	}
	for _, prompt := range []string{"参考 @图片3", "参考 @图片10", "参考 @音频0"} {
		if _, err := cloudAgentMediaReferencePrompt(prompt, refs); err == nil {
			t.Fatalf("unbound mention accepted: %q", prompt)
		}
	}
	if got, err := cloudAgentMediaReferencePrompt("纯文字生成", nil); err != nil || got != "纯文字生成" {
		t.Fatalf("text-only prompt changed: %q, %v", got, err)
	}
	if _, err := cloudAgentMediaReferencePrompt(strings.Repeat("长", 16000), refs); err == nil {
		t.Fatal("expanded prompt must respect the length limit")
	}
	transient := map[string]any{"referenceImages": []any{ref("画布图片"), map[string]any{"name": "标注", "dataUrl": "data:image/png;base64,AA=="}}}
	if got, err := cloudAgentMediaReferencePrompt("生成", transient); err != nil || got != "生成\n\n【资产参考】\n画布图片：@图片1" {
		t.Fatalf("transient image must not create an unresolvable canvas chip: %q, %v", got, err)
	}
	if got, err := cloudAgentMediaReferencePrompt("生成", map[string]any{"referenceImages": []any{ref("标题\n@图片99")}}); err != nil || !strings.Contains(got, "标题 ＠图片99：@图片1") {
		t.Fatalf("title introduced a false mention: %q, %v", got, err)
	}
}

func TestCloudAgentMediaMentionsPersistAcrossApproval(t *testing.T) {
	s, _, args := agentMediaFixture(t)
	args.Prompt = "人物参考 @图片1，使用另一张图的假发。"
	run, _ := agentMediaRun(t, s, args, "request_approval")
	if err := s.advanceCloudAgentByID("user", run.ID); err != nil {
		t.Fatal(err)
	}
	waiting, err := s.CloudAgentRun("user", run.ID)
	if err != nil || waiting.Approval == nil {
		t.Fatalf("missing approval: %v", err)
	}
	want := args.Prompt + "\n\n【资产参考】\n叮当猫在飞：@图片2"
	checkNode := func() {
		t.Helper()
		canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
		if err != nil {
			t.Fatal(err)
		}
		doc, _ := creationDocument(canvas.PayloadJSON)
		nodes, _ := creationObjects(doc["nodes"])
		meta := nodes[args.NodeID]["metadata"].(map[string]any)
		if meta["composerContent"] != want || meta["prompt"] != want {
			t.Fatalf("canvas lost reference mentions: %#v", meta)
		}
		refs := []string{}
		for _, edge := range creationMaps(doc["connections"]) {
			if edge["toNodeId"] == args.NodeID {
				refs = append(refs, stringValue(edge["fromNodeId"]))
			}
		}
		if strings.Join(refs, ",") != "hero,cat,shot-1" {
			t.Fatalf("canvas chip order does not match media arrays: %v", refs)
		}
	}
	var approved cloudAgentMediaArgs
	stored, _ := s.repo.CloudAgent("user", run.ID)
	state, _ := cloudAgentDecode(stored)
	if err := json.Unmarshal([]byte(state.Approval.Call.Function.Arguments), &approved); err != nil || approved.Prompt != want {
		t.Fatalf("approval prompt differs from draft: %q, %v", approved.Prompt, err)
	}
	checkNode()
	approveAgentMediaDraft(t, s, run.ID)
	checkNode()
	stored, _ = s.repo.CloudAgent("user", run.ID)
	state, _ = cloudAgentDecode(stored)
	task, err := s.repo.TaskForUser("user", state.MediaTaskID)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal([]byte(task.InputJSON), &input); err != nil || input.Prompt != want || task.Prompt != want {
		t.Fatalf("submitted prompt differs from approved mentions: %#v, %v", input, err)
	}
}

func TestCloudAgentMediaReferenceEdgesFollowApprovedOrder(t *testing.T) {
	edges := []map[string]any{
		{"id": "cat-edge", "fromNodeId": "cat", "toNodeId": "target"},
		{"id": "text-edge", "fromNodeId": "text", "toNodeId": "target"},
		{"id": "other-edge", "fromNodeId": "cat", "toNodeId": "other"},
		{"id": "hero-edge", "fromNodeId": "hero", "toNodeId": "target"},
		{"id": "removed-edge", "fromNodeId": "removed", "toNodeId": "target"},
	}
	got := cloudAgentMediaConnections(edges, cloudAgentMediaArgs{NodeID: "target", ReferenceNodeIDs: []string{"hero", "cat"}, SourceNodeID: "text"})
	ids := []string{}
	for _, edge := range got {
		ids = append(ids, stringValue(edge["id"]))
	}
	if strings.Join(ids, ",") != "other-edge,hero-edge,cat-edge,text-edge" {
		t.Fatalf("wrong reference order or unrelated edge changed: %v", ids)
	}
}
