package app

import (
	"testing"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestUserMemoryMutationRequiresAuthenticatedOwner(t *testing.T) {
	s := &Service{}
	checks := []func() error{
		func() error { _, err := s.UpdateUserAgentMemory("", "memory", AgentMemoryRequest{}); return err },
		func() error { return s.DecideUserAgentMemory("", "memory", "approve") },
		func() error { return s.DeleteUserAgentMemory("", "memory") },
		func() error { _, err := s.ExportUserAgentMemories(""); return err },
	}
	for i, check := range checks {
		if err := check(); err == nil {
			t.Fatalf("unauthenticated memory operation %d accepted", i)
		}
	}
}

func TestMemoryCandidateSurvivesCheckpointAndRequiresSuccessfulCompletion(t *testing.T) {
	for _, succeeded := range []bool{true, false} {
		name := "failed"
		if succeeded {
			name = "completed"
		}
		t.Run(name, func(t *testing.T) {
			s, _, _ := agentMediaFixture(t)
			s.disablePiRuntime = true
			req := agentTestRequest()
			req.PermissionMode = "auto"
			root, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatal(err)
			}
			run, err := s.repo.CloudAgent("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			state, err := cloudAgentDecode(run)
			if err != nil {
				t.Fatal(err)
			}
			state.ActiveTaskID = ""
			state.PiAssistantResponses = 1
			state.event(run.ID, "tool_completed", map[string]any{"toolName": "canvas_apply_ops", "callId": "source-write"})
			if _, err := cloudAgentRememberLesson(s.repo, "user", &state, rememberLessonCall(`{"topic":"canvas.fresh-state","category":"canvas","situation":"连续写入时","steps":[{"tool":"canvas_get_state","action":"重新读取"},{"tool":"canvas_apply_ops","action":"用最新快照写入"}]}`)); err != nil {
				t.Fatal(err)
			}
			if err := s.repo.MutateCloudAgent("user", run.ID, run.Revision, func(current *model.CloudAgentExecution, _ *repository.Repository) error {
				current.Status = "running"
				return cloudAgentSave(current, &state)
			}); err != nil {
				t.Fatal(err)
			}
			run, err = s.repo.CloudAgent("user", root.ID)
			if err != nil {
				t.Fatal(err)
			}
			state, err = cloudAgentDecode(run)
			if err != nil || len(state.PendingLessonDrafts) != 1 || state.PendingLessonDrafts[0].StepsJSON == "" || len(state.PendingLessonDrafts[0].Evidence) != 1 {
				t.Fatalf("checkpoint lost candidate route/evidence: %+v err=%v", state.PendingLessonDrafts, err)
			}
			if succeeded {
				if err := s.completeCloudAgentPiRun("user", root.ID); err != nil {
					t.Fatal(err)
				}
			} else if err := s.failCloudAgent(run, &state, "后续任务失败"); err != nil {
				t.Fatal(err)
			}
			lessons, err := s.repo.UserAgentLessons("user", model.AgentLessonStatusPending, 10)
			if err != nil {
				t.Fatal(err)
			}
			if !succeeded {
				if len(lessons) != 0 {
					t.Fatalf("failed run persisted candidates: %+v", lessons)
				}
				return
			}
			if len(lessons) != 1 || lessons[0].OriginRunID != root.ID || lessons[0].StepsJSON == "" || lessons[0].EvidenceJSON == "" || lessons[0].LastVerifiedAt != nil {
				t.Fatalf("successful run did not commit unverified evidence-backed memory: %+v", lessons)
			}
		})
	}
}
