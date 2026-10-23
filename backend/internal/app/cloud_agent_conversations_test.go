package app

import (
	"errors"
	"fmt"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func finishConversationTestRun(t *testing.T, db *gorm.DB, runID string) {
	t.Helper()
	if err := db.Model(&model.Task{}).Where("id = ?", runID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"text":"上一轮回复"}`}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.CloudAgentExecution{}).Where("id = ?", runID).Update("status", "completed").Error; err != nil {
		t.Fatal(err)
	}
}

func TestCloudAgentConversationHistoryRestoresTurnsAndOwnership(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	finishConversationTestRun(t, db, root.ID)
	if err := db.Create(&model.CanvasProject{ID: "other-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
		t.Fatal(err)
	}
	req := agentTestRequest()
	req.CanvasID = "other-canvas"
	req.Prompt, req.IdempotencyKey = "在另一个页面继续", "other-page-next-turn"
	child, err := s.CreateCloudAgentRun("user", req, root.ID)
	if err != nil {
		t.Fatal(err)
	}
	if child.ConversationID != root.ID || child.UserPrompt != req.Prompt || child.IdempotencyKey != req.IdempotencyKey {
		t.Fatalf("run lost restore identity: %+v", child)
	}
	for _, canvasID := range []string{"agent-canvas", "other-canvas"} {
		page, err := s.CloudAgentConversations("user", canvasID, "", 100)
		if err != nil || len(page.Items) != 1 {
			t.Fatalf("directory for %s: %+v %v", canvasID, page, err)
		}
		item := page.Items[0]
		if item.ID != root.ID || item.LatestRunID != child.ID || item.CanvasID != req.CanvasID || item.Revision != child.Revision || item.Status != child.Status {
			t.Fatalf("canvas directory used a stale canvas-scoped turn: %+v", item)
		}
	}
	first, err := s.CloudAgentConversationRuns("user", root.ID, "", 1)
	if err != nil || len(first.Items) != 1 || first.Items[0].ID != root.ID || first.NextCursor == "" {
		t.Fatalf("first run page: %+v %v", first, err)
	}
	second, err := s.CloudAgentConversationRuns("user", root.ID, first.NextCursor, 1)
	if err != nil || len(second.Items) != 1 || second.Items[0].ID != child.ID || second.NextCursor != "" {
		t.Fatalf("second run page: %+v %v", second, err)
	}
	if second.Items[0].ParentID != root.ID || second.Items[0].ConversationID != root.ID || second.Items[0].UserPrompt != req.Prompt {
		t.Fatalf("child history was not restored: %+v", second.Items[0])
	}
	for _, query := range []func() error{
		func() error { _, err := s.CloudAgentConversations("other", "agent-canvas", "", 100); return err },
		func() error { _, err := s.CloudAgentConversationRuns("other", root.ID, "", 100); return err },
		func() error { _, err := s.CloudAgentConversationRuns("user", "missing-run", "", 100); return err },
	} {
		var appErr *AppError
		if err := query(); !errors.As(err, &appErr) || appErr.Status != 404 {
			t.Fatalf("foreign or absent history was exposed: %v", err)
		}
	}
	var count int64
	if err := db.Model(&model.Task{}).Where("operation = ?", cloudAgentOperation).Count(&count).Error; err != nil || count != 2 {
		t.Fatalf("read APIs created tasks: %d %v", count, err)
	}
}

func TestCloudAgentConversationDirectoryKeysetAndValidation(t *testing.T) {
	s, db, root := reliableAgentRoot(t)
	finishConversationTestRun(t, db, root.ID)
	// Equal timestamps exercise the ID tie-breaker; foreign rows never change
	// the current user's latest turn, even with a matching conversation ID.
	stamp := time.Now().UTC().Add(time.Hour)
	for _, row := range []model.CloudAgentExecution{
		{ID: "history-a", UserID: "user", ConversationID: "history-a", CanvasID: "agent-canvas", Status: "completed", CreatedAt: stamp},
		{ID: "history-b", UserID: "user", ConversationID: "history-b", CanvasID: "agent-canvas", Status: "completed", CreatedAt: stamp},
		{ID: "foreign-latest", UserID: "other", ConversationID: root.ID, CanvasID: "agent-canvas", Status: "running", CreatedAt: stamp.Add(time.Hour)},
	} {
		if err := db.Create(&row).Error; err != nil {
			t.Fatal(err)
		}
	}
	seen := map[string]bool{}
	cursor := ""
	for range 3 {
		page, err := s.CloudAgentConversations("user", "agent-canvas", cursor, 1)
		if err != nil || len(page.Items) != 1 || seen[page.Items[0].ID] {
			t.Fatalf("directory page duplicated or skipped rows: %+v %v", page, err)
		}
		seen[page.Items[0].ID] = true
		cursor = page.NextCursor
	}
	if cursor != "" || !seen[root.ID] || !seen["history-a"] || !seen["history-b"] {
		t.Fatalf("directory pagination did not finish: %v %q", seen, cursor)
	}
	for _, args := range []struct {
		canvas, cursor string
		limit          int
	}{
		{"", "", 100}, {"agent-canvas", "not-a-cursor", 100}, {"agent-canvas", "", 0}, {"agent-canvas", "", 101},
	} {
		if _, err := s.CloudAgentConversations("user", args.canvas, args.cursor, args.limit); err == nil {
			t.Fatalf("invalid directory input accepted: %+v", args)
		}
	}
}

func TestCloudAgentConversationRejectsStaleParentButReplaysOriginalKey(t *testing.T) {
	for _, legacy := range []bool{false, true} {
		t.Run(fmt.Sprintf("legacy=%t", legacy), func(t *testing.T) {
			s, db, _, _ := creationTestService(t)
			s.legacyCloudAgentRootTask = legacy
			if err := db.Create(&model.CanvasProject{ID: "agent-canvas", UserID: "user", PayloadJSON: `{"nodes":[]}`}).Error; err != nil {
				t.Fatal(err)
			}
			root, err := s.CreateCloudAgentRun("user", agentTestRequest(), "")
			if err != nil {
				t.Fatal(err)
			}
			finishConversationTestRun(t, db, root.ID)
			req := agentTestRequest()
			req.IdempotencyKey = "conversation-child-first"
			child, err := s.CreateCloudAgentRun("user", req, root.ID)
			if err != nil {
				t.Fatal(err)
			}
			finishConversationTestRun(t, db, child.ID)
			before, err := s.repo.CreditAccount("user")
			if err != nil {
				t.Fatal(err)
			}
			stale := req
			stale.IdempotencyKey = "conversation-child-stale"
			_, err = s.CreateCloudAgentRun("user", stale, root.ID)
			var appErr *AppError
			if !errors.As(err, &appErr) || appErr.Status != 409 || appErr.Reason != "agent_conversation_stale_parent" {
				t.Fatalf("stale parent admitted: %v", err)
			}
			replayed, err := s.CreateCloudAgentRun("user", req, root.ID)
			if err != nil || replayed.ID != child.ID {
				t.Fatalf("idempotent replay lost priority: %+v %v", replayed, err)
			}
			after, err := s.repo.CreditAccount("user")
			if err != nil || after.AvailableMicrocredits != before.AvailableMicrocredits || after.ReservedMicrocredits != before.ReservedMicrocredits {
				t.Fatalf("stale/replay requests changed billing: %+v %+v %v", before, after, err)
			}
			stale.IdempotencyKey = "conversation-current-tip"
			if next, err := s.CreateCloudAgentRun("user", stale, child.ID); err != nil || next.ParentID != child.ID {
				t.Fatalf("latest tip cannot continue: %+v %v", next, err)
			}
		})
	}
}

func TestCloudAgentHistoryFromStartPagesPastEventWindow(t *testing.T) {
	s, _, root := reliableAgentRoot(t)
	total := cloudAgentRunEventDeltaLimit + 61
	growAgentJournal(t, s, root.ID, total)
	first, err := s.CloudAgentRun("user", root.ID, CloudAgentRunViewOptions{FromStart: true, EventLimit: 500})
	if err != nil || len(first.Events) != 500 || first.Events[0].Seq != 1 || first.EventSeqBase != 0 || first.LatestSeq != 500 || first.EventsTruncated {
		t.Fatalf("history first page lost prefix: %+v %v", first, err)
	}
	next, err := s.CloudAgentRun("user", root.ID, CloudAgentRunViewOptions{SinceSeq: first.LatestSeq, EventLimit: 500})
	if err != nil || len(next.Events) != 61 || next.Events[0].Seq != 501 || next.LatestSeq != total {
		t.Fatalf("history second page lost events: %+v %v", next, err)
	}
}
