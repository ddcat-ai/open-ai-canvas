package app

import (
	"errors"
	"strings"
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestDramaDialogueSyncPreservesSurroundingPrompt(t *testing.T) {
	for _, quote := range [][2]string{{"“", "”"}, {"「", "」"}, {"\"", "\""}} {
		before := "手写镜头：近景。甲说：" + quote[0] + "你好。" + quote[1] + "\n手写灯光：暖光。"
		got, err := syncDramaDialogue(before, "你好。", "你好啊。再见。")
		if err != nil || got != strings.Replace(before, "你好。", "你好啊。再见。", 1) {
			t.Fatalf("unexpected patch: %q %v", got, err)
		}
	}
	for _, prompt := range []string{"甲说：“你好。”乙说：“你好。”", "手写为：“您好。”", "你好。只是说明，不是台词"} {
		if _, err := syncDramaDialogue(prompt, "你好。", "再见。"); err == nil {
			t.Fatalf("ambiguous prompt accepted: %q", prompt)
		}
	}
}

func TestDramaDialogueSyncConflictKeepsOriginal(t *testing.T) {
	segment := model.DramaSegment{PromptStatus: "ready", VideoPrompt: "模型原文", VideoPromptOverride: "甲说：“你好。”\n手写灯光"}
	for _, tc := range []struct {
		name         string
		old          string
		fields       map[string]any
		count, limit int
	}{
		{"duplicate shot", "你好。", map[string]any{"dialogue": "再见。"}, 2, 1000},
		{"missing quote", "您好。", map[string]any{"dialogue": "再见。"}, 1, 1000},
		{"new silent shot", "", map[string]any{"dialogue": "再见。"}, 1, 1000},
		{"structural", "你好。", map[string]any{"camera": "推近"}, 1, 1000},
		{"length limit", "你好。", map[string]any{"dialogue": "再见。"}, 1, 5},
	} {
		t.Run(tc.name, func(t *testing.T) {
			fields := dramaShotPromptEdit(segment, model.DramaShot{Dialogue: tc.old}, tc.fields, tc.count, tc.limit, 0)
			if fields["prompt_status"] != model.DramaPromptConflict || fields["prompt_error"] == "" {
				t.Fatalf("missing conflict: %+v", fields)
			}
			if _, ok := fields["video_prompt_override"]; ok {
				t.Fatal("overwrote manual prompt")
			}
			if _, ok := fields["video_prompt"]; ok {
				t.Fatal("overwrote model prompt")
			}
		})
	}
}

func TestDramaDialogueEditSynchronizesWithoutGeneration(t *testing.T) {
	for _, custom := range []bool{false, true} {
		t.Run(map[bool]string{false: "generated", true: "manual"}[custom], func(t *testing.T) {
			svc, fake := newDramaTestService(t)
			project := createTestDramaWithMedia(t, svc, DramaReviewEvery, DramaMediaManual).Project.ID
			runDramaTicks(t, svc, project, 20)
			summary, _ := svc.DramaSummary("usr-drama", project)
			episode := summary.Episodes[0].ID
			detail, err := svc.DramaEpisodeDetail("usr-drama", project, episode)
			if err != nil {
				t.Fatal(err)
			}
			shot := detail.Shots[0]
			rows, _ := svc.repo.DramaSegments(episode)
			original := rows[0]
			prompt := original.VideoPrompt
			if custom {
				prompt += "\n手写细节：保留衣服上的猫图案，不要改灯光。"
				if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{VideoPromptOverride: &prompt}); err != nil {
					t.Fatal(err)
				}
			}
			beforeRequests := len(fake.requests)
			next := shot.Dialogue + "这句话我不会收回。"
			if _, err := svc.UpdateDramaShot("usr-drama", project, shot.ID, UpdateDramaShotRequest{Dialogue: &next}); err != nil {
				t.Fatal(err)
			}
			rows, _ = svc.repo.DramaSegments(episode)
			updated := rows[0]
			want := strings.Replace(prompt, shot.Dialogue, next, 1)
			actual := updated.VideoPrompt
			if custom {
				actual = updated.VideoPromptOverride
			}
			if actual != want || !dramaPromptReady(updated) {
				t.Fatalf("sync failed: %+v", updated)
			}
			if updated.VideoResourceID != original.VideoResourceID {
				t.Fatal("existing video removed")
			}
			runDramaTicks(t, svc, project, 4)
			if len(fake.requests) != beforeRequests {
				t.Fatal("edit automatically created paid work")
			}
			// The old revision cannot replace the new prompt or modify the shot.
			err = svc.repo.UpdateDramaShotScript(model.DramaShot{ID: shot.ID, ProjectID: project}, map[string]any{"dialogue": "late"}, original, map[string]any{"video_prompt": "late"})
			if !errors.Is(err, repository.ErrDramaSegmentChanged) {
				t.Fatalf("late edit: %v", err)
			}
			// A structural edit saves the script but preserves the entire prompt.
			camera := "极慢推近"
			if _, err := svc.UpdateDramaShot("usr-drama", project, shot.ID, UpdateDramaShotRequest{Camera: &camera}); err != nil {
				t.Fatal(err)
			}
			rows, _ = svc.repo.DramaSegments(episode)
			if rows[0].PromptStatus != model.DramaPromptConflict || dramaPromptReady(rows[0]) {
				t.Fatal("conflict did not block stale submission")
			}
			if rows[0].VideoPromptOverride != updated.VideoPromptOverride || rows[0].VideoPrompt != updated.VideoPrompt {
				t.Fatal("conflict erased prompt")
			}
			if _, err := svc.GenerateDramaSegments("usr-drama", project, episode, GenerateDramaSegmentsRequest{Segments: []int{0}}); err == nil {
				t.Fatal("conflicted prompt submitted")
			}
			runDramaTicks(t, svc, project, 4)
			if len(fake.requests) != beforeRequests {
				t.Fatal("conflict automatically rewrote prompt")
			}
			// Manual confirmation is sufficient; no text model is needed.
			if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{VideoPromptOverride: &want}); err != nil {
				t.Fatal(err)
			}
			rows, _ = svc.repo.DramaSegments(episode)
			if !dramaPromptReady(rows[0]) || rows[0].PromptError != "" {
				t.Fatal("manual resolution failed")
			}
			if _, err := svc.RequestDramaSegmentPrompts("usr-drama", project, episode, GenerateDramaSegmentsRequest{Segments: []int{0}}); err != nil {
				t.Fatal(err)
			}
			rows, _ = svc.repo.DramaSegments(episode)
			if dramaPromptReady(rows[0]) {
				t.Fatal("old manual prompt allowed while rewriting")
			}
			runDramaTicks(t, svc, project, 4)
			rows, _ = svc.repo.DramaSegments(episode)
			if rows[0].VideoPromptOverride != want || rows[0].PromptStatus != model.DramaPromptReview || dramaPromptReady(rows[0]) {
				t.Fatal("AI rewrite did not preserve manual prompt for review")
			}
			empty := ""
			if err := svc.UpdateDramaSegment("usr-drama", project, episode, 0, UpdateDramaSegmentRequest{VideoPromptOverride: &empty}); err != nil {
				t.Fatal(err)
			}
			rows, _ = svc.repo.DramaSegments(episode)
			if !dramaPromptReady(rows[0]) || rows[0].VideoPromptOverride != "" {
				t.Fatal("AI candidate adoption failed")
			}
		})
	}
}
