package app

import (
	"encoding/json"
	"reflect"
	"strings"
	"testing"

	"yingce/backend/internal/model"
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

func TestCloudAgentMediaComposerPromptUsesUnifiedImageSlots(t *testing.T) {
	refs := map[string]any{
		"referenceImages": []any{
			map[string]any{"storageKey": "resource:character", "canvasReferenceKind": "character"},
			map[string]any{"storageKey": "resource:scene"},
			map[string]any{"storageKey": "resource:character-two", "canvasReferenceKind": "character"},
		},
		"referenceAudios": []any{map[string]any{"storageKey": "resource:voice"}},
	}
	prompt := "@图片1、@图片2、@图片3 和 @音频1"
	want := "@角色1、@图片2、@角色3 和 @音频1"
	if got := cloudAgentMediaComposerPrompt(prompt, refs); got != want {
		t.Fatalf("composer prompt = %q, want %q", got, want)
	}
	if prompt != "@图片1、@图片2、@图片3 和 @音频1" {
		t.Fatal("provider prompt was mutated")
	}
	if got := cloudAgentMediaComposerPrompt("参考 @图片10", refs); got != "参考 @图片10" {
		t.Fatalf("unbound reference changed: %q", got)
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
	got := cloudAgentMediaConnections(map[string]any{"connections": edges}, cloudAgentMediaArgs{NodeID: "target", ReferenceNodeIDs: []string{"hero", "cat"}, SourceNodeID: "text"})
	sources := []string{}
	for _, edge := range got {
		sources = append(sources, stringValue(edge["fromNodeId"]))
	}
	if got[0]["id"] != "other-edge" || strings.Join(sources, ",") != "cat,hero,cat,text" {
		t.Fatalf("wrong reference order or unrelated edge changed: %v", got)
	}
}

func TestCloudAgentMediaStoryboardConnectionsSurviveApproval(t *testing.T) {
	for _, origin := range []string{"materialized", "row-handle", "row-binding"} {
		t.Run(origin, func(t *testing.T) {
			s, db, args := agentMediaFixture(t)
			canvas, err := s.repo.CanvasProjectForUser("user", "agent-canvas")
			if err != nil {
				t.Fatal(err)
			}
			doc, err := creationDocument(canvas.PayloadJSON)
			if err != nil {
				t.Fatal(err)
			}
			doc["nodes"] = append(creationMaps(doc["nodes"]), map[string]any{"id": args.NodeID, "type": "video", "metadata": map[string]any{"status": "idle"}}, map[string]any{
				"id": "script", "type": "script", "metadata": map[string]any{"storyboard": map[string]any{"rows": []any{map[string]any{"id": "shot", "videoNodeId": args.NodeID}}}},
			})
			edges := []map[string]any{{"id": "cat-input", "fromNodeId": "cat", "toNodeId": args.NodeID, "relation": "storyboard-asset-reference", "storyboardRowId": "shot"}, {"id": "old-input", "fromNodeId": "shot-1", "toNodeId": args.NodeID}}
			if origin != "row-binding" {
				output := map[string]any{"id": "output", "fromNodeId": "script", "toNodeId": args.NodeID, "fromHandleId": "row:shot"}
				if origin == "materialized" {
					output["relation"], output["storyboardRowId"] = "storyboard-output", "shot"
				}
				edges = append(edges, output)
			}
			doc["connections"] = edges
			raw, err := json.Marshal(doc)
			if err != nil {
				t.Fatal(err)
			}
			if err := db.Model(&model.CanvasProject{}).Where("id = ?", canvas.ID).Update("payload_json", string(raw)).Error; err != nil {
				t.Fatal(err)
			}
			args.SnapshotHash, args.SourceNodeID = cloudAgentCanvasHash(doc), ""
			run, state := agentMediaRun(t, s, args, "request_approval")
			if err := s.advanceCloudAgentTool(run, &state); err != nil {
				t.Fatal(err)
			}
			readEdges := func() []map[string]any {
				t.Helper()
				stored, err := s.repo.CanvasProjectForUser("user", canvas.ID)
				if err != nil {
					t.Fatal(err)
				}
				payload, err := creationDocument(stored.PayloadJSON)
				if err != nil {
					t.Fatal(err)
				}
				return creationMaps(payload["connections"])
			}
			draft := readEdges()
			var inputs []string
			outputs := 0
			for _, edge := range draft {
				if edge["fromNodeId"] == "script" {
					outputs++
					if edge["fromHandleId"] != "row:shot" || edge["relation"] != "storyboard-output" || edge["storyboardRowId"] != "shot" || (origin != "row-binding" && edge["id"] != "output") {
						t.Fatalf("incorrect output edge: %v", edge)
					}
					continue
				}
				if edge["relation"] != "storyboard-asset-reference" || edge["storyboardRowId"] != "shot" {
					t.Fatalf("incorrect storyboard reference: %v", edge)
				}
				inputs = append(inputs, stringValue(edge["fromNodeId"]))
			}
			if outputs != 1 || !reflect.DeepEqual(inputs, args.ReferenceNodeIDs) {
				t.Fatalf("persisted graph differs from the approved inputs: %v", draft)
			}
			approveAgentMediaDraft(t, s, run.ID)
			if submitted := readEdges(); !reflect.DeepEqual(draft, submitted) {
				t.Fatalf("approval rewrote edges: %v -> %v", draft, submitted)
			}
		})
	}
}

func TestCloudAgentMediaDependencyTracksStoryboardBindingAndHandles(t *testing.T) {
	args := cloudAgentMediaArgs{Mode: "video", NodeID: "clip"}
	row := map[string]any{"id": "shot", "videoNodeId": args.NodeID}
	edge := map[string]any{"id": "output", "fromNodeId": "script", "toNodeId": args.NodeID, "fromHandleId": "row:shot"}
	doc := map[string]any{
		"nodes": []any{
			map[string]any{"id": "script", "type": "script", "metadata": map[string]any{"storyboard": map[string]any{"rows": []any{row}}}},
			map[string]any{"id": args.NodeID, "type": "video"},
		},
		"connections": []any{edge},
	}
	dependency := func() string {
		t.Helper()
		hash, err := cloudAgentMediaDependencyHash(doc, args)
		if err != nil {
			t.Fatal(err)
		}
		return hash
	}
	approved := dependency()
	edge["fromHandleId"] = "row:other"
	if dependency() == approved {
		t.Fatal("changing the output handle must invalidate approval")
	}
	edge["fromHandleId"] = "row:shot"
	delete(row, "videoNodeId")
	if dependency() == approved {
		t.Fatal("removing the row binding must invalidate approval even when the edge remains")
	}
}
