package app

import (
	"encoding/json"
	"fmt"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func proposalLesson(t *testing.T, s *Service, userID, topic string) model.AgentLesson {
	t.Helper()
	view, err := s.CreateUserAgentMemory(userID, AgentMemoryRequest{
		Topic: topic, Category: "canvas", Situation: "写画布前读取事实 " + topic, Lesson: "读取后再写入", Source: "用户已确认的原始来源",
	})
	if err != nil {
		t.Fatal(err)
	}
	lesson, err := s.repo.AgentLessonForUser(userID, view.ID)
	if err != nil {
		t.Fatal(err)
	}
	verified := time.Date(2026, 8, 1, 12, 0, 0, 0, time.UTC)
	lesson.LastVerifiedAt = &verified
	lesson.OriginRunID = "run-evidence"
	lesson.EvidenceJSON = `[{"sequence":7,"callId":"call-evidence","tool":"canvas_apply_ops"}]`
	if err := s.repo.SaveAgentLesson(lesson); err != nil {
		t.Fatal(err)
	}
	return *lesson
}

func finishProposalForTest(t *testing.T, s *Service, userID string, input []model.AgentLesson, plan agentMemoryCompactPlan) AgentMemoryProposalView {
	t.Helper()
	snapshots := make([]model.AgentMemorySnapshot, 0, len(input))
	for _, lesson := range input {
		snapshots = append(snapshots, model.SnapshotAgentMemory(lesson))
	}
	raw, err := json.Marshal(snapshots)
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	row := &model.AgentMemoryProposal{
		ID: newID(), UserID: userID, TaskID: "proposal-test-task", Version: 1, Status: model.AgentMemoryProposalGenerating,
		InputJSON: string(raw), ChangesJSON: "[]", SummaryJSON: "{}", CreatedAt: now, UpdatedAt: now,
	}
	if err := s.repo.Create(row); err != nil {
		t.Fatal(err)
	}
	body, _ := json.Marshal(plan)
	inputJSON, _ := json.Marshal(map[string]any{"metadata": map[string]any{"memoryProposalId": row.ID}})
	task := model.Task{ID: row.TaskID, UserID: userID, Operation: cloudAgentMemoryCompactOp, InputJSON: string(inputJSON)}
	s.noteAgentMemoryCompactTask(task, map[string]any{"text": string(body)}, nil)
	stored, err := s.repo.AgentMemoryProposalForUser(userID, row.ID)
	if err != nil {
		t.Fatal(err)
	}
	view, err := agentMemoryProposalViewOf(*stored)
	if err != nil {
		t.Fatal(err)
	}
	return view
}

func mergeProposalPlan(first, second model.AgentLesson) agentMemoryCompactPlan {
	return agentMemoryCompactPlan{Merges: []agentMemoryCompactMerge{{
		IDs: []string{first.ID, second.ID}, Topic: "canvas.safe-write", Category: "canvas",
		Situation: "可靠修改画布", Lesson: "读取事实，执行写入，验证结果", Source: "LLM不得替换此来源",
	}}}
}

func TestAgentMemoryProposalApprovalAndRestorePreserveEvidence(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	first := proposalLesson(t, s, "user-a", "canvas.first")
	second := proposalLesson(t, s, "user-a", "canvas.second")
	proposal := finishProposalForTest(t, s, "user-a", []model.AgentLesson{first, second}, mergeProposalPlan(first, second))
	if proposal.Status != model.AgentMemoryProposalPending || len(proposal.Changes) != 1 {
		t.Fatalf("expected pending before/after proposal: %+v", proposal)
	}
	unmodified, _ := s.repo.AgentLessonForUser("user-a", first.ID)
	if model.SnapshotAgentMemory(*unmodified).ContentVersion() != model.SnapshotAgentMemory(first).ContentVersion() {
		t.Fatal("model result changed a memory without approval")
	}
	if _, err := s.repo.AgentLessonForUser("user-a", second.ID); err != nil {
		t.Fatal("model result deleted a memory without approval")
	}
	if _, err := s.DecideUserAgentMemoryProposal("user-a", proposal.ID, AgentMemoryProposalDecision{Decision: "approve", Version: proposal.Version}); err != nil {
		t.Fatal(err)
	}
	merged, err := s.repo.AgentLessonForUser("user-a", first.ID)
	if err != nil || merged.Topic != "canvas.safe-write" || merged.Source != first.Source || merged.OriginRunID != first.OriginRunID || merged.EvidenceJSON != first.EvidenceJSON || !merged.LastVerifiedAt.Equal(*first.LastVerifiedAt) {
		t.Fatalf("approved merge lost provenance/verification: %+v %v", merged, err)
	}
	if _, err := s.repo.AgentLessonForUser("user-a", second.ID); err == nil {
		t.Fatal("approved merge should remove secondary row")
	}
	revisions, err := s.UserAgentMemoryRevisions("user-a", 30)
	if err != nil || len(revisions) != 1 || len(revisions[0].Before) != 2 || len(revisions[0].After) != 1 {
		t.Fatalf("approved batch needs a complete restore snapshot: %+v %v", revisions, err)
	}
	if _, err := s.RestoreUserAgentMemoryRevision("other", revisions[0].ID, AgentMemoryRevisionRestore{Version: revisions[0].Version}); err == nil {
		t.Fatal("another user restored a version")
	}
	if _, err := s.RestoreUserAgentMemoryRevision("user-a", revisions[0].ID, AgentMemoryRevisionRestore{Version: revisions[0].Version}); err != nil {
		t.Fatal(err)
	}
	for _, before := range []model.AgentLesson{first, second} {
		restored, err := s.repo.AgentLessonForUser("user-a", before.ID)
		if err != nil || restored.Topic != before.Topic || restored.Source != before.Source || restored.OriginRunID != before.OriginRunID || restored.EvidenceJSON != before.EvidenceJSON || !restored.LastVerifiedAt.Equal(*before.LastVerifiedAt) {
			t.Fatalf("restore lost original content/evidence: %+v %v", restored, err)
		}
	}
	if _, err := s.RestoreUserAgentMemoryRevision("user-a", revisions[0].ID, AgentMemoryRevisionRestore{Version: revisions[0].Version}); err == nil {
		t.Fatal("stale version restored twice")
	}
}

func TestAgentMemoryProposalRejectOwnerAndStaleAreAtomic(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	first := proposalLesson(t, s, "user-a", "canvas.first")
	second := proposalLesson(t, s, "user-a", "canvas.second")
	proposal := finishProposalForTest(t, s, "user-a", []model.AgentLesson{first, second}, mergeProposalPlan(first, second))
	for _, userID := range []string{"", "other"} {
		if _, err := s.DecideUserAgentMemoryProposal(userID, proposal.ID, AgentMemoryProposalDecision{Decision: "approve", Version: proposal.Version}); err == nil {
			t.Fatalf("user %q must not approve foreign proposal", userID)
		}
	}
	if _, err := s.DecideUserAgentMemoryProposal("user-a", proposal.ID, AgentMemoryProposalDecision{Decision: "approve", Version: proposal.Version + 1}); err == nil {
		t.Fatal("stale proposal version was accepted")
	}
	if _, err := s.UpdateUserAgentMemory("user-a", second.ID, AgentMemoryRequest{Topic: "canvas.user-edited", Category: "canvas", Situation: "用户后来编辑", Lesson: "保留新内容"}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.DecideUserAgentMemoryProposal("user-a", proposal.ID, AgentMemoryProposalDecision{Decision: "approve", Version: proposal.Version}); err == nil {
		t.Fatal("stale source content was overwritten")
	}
	stored, _ := s.repo.AgentMemoryProposalForUser("user-a", proposal.ID)
	unchanged, _ := s.repo.AgentLessonForUser("user-a", first.ID)
	if stored.Status != model.AgentMemoryProposalPending || unchanged.Topic != first.Topic {
		t.Fatal("stale approval partially modified proposal or first row")
	}
	if _, err := s.DecideUserAgentMemoryProposal("user-a", proposal.ID, AgentMemoryProposalDecision{Decision: "reject", Version: proposal.Version}); err != nil {
		t.Fatal(err)
	}
	rows, _ := s.UserAgentMemoryRevisions("user-a", 30)
	if len(rows) != 0 {
		t.Fatal("rejected proposal created an applied version")
	}
}

func TestAgentMemoryRevisionRejectsSubsequentEditsAndRecreatedIDs(t *testing.T) {
	for _, scenario := range []string{"edited", "recreated"} {
		t.Run(scenario, func(t *testing.T) {
			s, _, _, _ := creationTestService(t)
			first := proposalLesson(t, s, "user-a", "canvas.first")
			second := proposalLesson(t, s, "user-a", "canvas.second")
			proposal := finishProposalForTest(t, s, "user-a", []model.AgentLesson{first, second}, mergeProposalPlan(first, second))
			if _, err := s.DecideUserAgentMemoryProposal("user-a", proposal.ID, AgentMemoryProposalDecision{Decision: "approve", Version: proposal.Version}); err != nil {
				t.Fatal(err)
			}
			if scenario == "edited" {
				if _, err := s.UpdateUserAgentMemory("user-a", first.ID, AgentMemoryRequest{Topic: "canvas.new", Category: "canvas", Situation: "后续新修改", Lesson: "不能被恢复覆盖"}); err != nil {
					t.Fatal(err)
				}
			} else {
				second.AuthorUserID = "other"
				if err := s.repo.Create(&second); err != nil {
					t.Fatal(err)
				}
			}
			revisions, _ := s.UserAgentMemoryRevisions("user-a", 30)
			if _, err := s.RestoreUserAgentMemoryRevision("user-a", revisions[0].ID, AgentMemoryRevisionRestore{Version: revisions[0].Version}); err == nil {
				t.Fatal("restoration overwrote later changes")
			}
			stored, _ := s.repo.AgentMemoryRevisionForUser("user-a", revisions[0].ID)
			if stored.RestoredAt != nil {
				t.Fatal("failed restore changed revision status")
			}
		})
	}
}

func TestAgentMemoryProposalCannotExpandBeyondInput(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	first := proposalLesson(t, s, "user-a", "canvas.first")
	other := proposalLesson(t, s, "other", "canvas.other")
	proposal := finishProposalForTest(t, s, "user-a", []model.AgentLesson{first}, mergeProposalPlan(first, other))
	if len(proposal.Changes) != 0 || proposal.Status != model.AgentMemoryProposalNoChanges || proposal.Summary.Skipped != 1 {
		t.Fatalf("foreign source should be excluded: %+v", proposal)
	}
}

func TestAgentMemoryCompactUsesFairBoundedBatch(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	for i := 0; i < 165; i++ {
		lesson := model.AgentLesson{ID: fmt.Sprintf("memory-%03d", i), AuthorUserID: "user-a", Topic: "canvas.test", Status: model.AgentLessonStatusApproved, Hits: int64(1000 - i)}
		if err := s.repo.Create(&lesson); err != nil {
			t.Fatal(err)
		}
	}
	first, err := s.repo.AgentMemoryCompactCandidates("user-a", "", 80)
	if err != nil || len(first) != 80 {
		t.Fatalf("first batch: %v %d", err, len(first))
	}
	second, err := s.repo.AgentMemoryCompactCandidates("user-a", first[len(first)-1].ID, 80)
	if err != nil || len(second) != 80 || second[0].ID == first[0].ID {
		t.Fatalf("second batch didn't advance: %v", err)
	}
	third, err := s.repo.AgentMemoryCompactCandidates("user-a", second[len(second)-1].ID, 80)
	if err != nil || len(third) != 80 || third[0].ID != "memory-160" {
		t.Fatalf("tail must be reached and wrap: %+v %v", third, err)
	}
	large := make([]model.AgentLesson, 20)
	for i := range large {
		large[i] = model.AgentLesson{ID: fmt.Sprintf("large-%d", i), Topic: "canvas.large", Situation: strings.Repeat("需保留的细节", 1500)}
	}
	batch, prompt := boundedAgentMemoryCompactBatch(large)
	if len(batch) == 0 || len(batch) >= len(large) || len(prompt) > cloudAgentMemoryCompactInputBytes {
		t.Fatalf("batch not bounded: %d entries %d bytes", len(batch), len(prompt))
	}
}

func TestAgentMemoryCompactTaskStoresProposalBeforeCompletion(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	first := proposalLesson(t, s, "user", "canvas.first")
	view, err := s.CompactUserAgentMemories("user", AgentMemoryCompactRequest{ChannelID: "channel", ChannelModelKey: "text-test", Model: "text-test"})
	if err != nil {
		t.Fatal(err)
	}
	if view.ProposalID == "" || view.TaskID == "" || view.LastStatus != model.AgentMemoryCompactStatusQueued {
		t.Fatalf("missing durable proposal binding: %+v", view)
	}
	task, err := s.repo.Task(view.TaskID)
	if err != nil || agentMemoryProposalIDFromTask(*task) != view.ProposalID {
		t.Fatalf("task binding: %v %+v", err, task)
	}
	plan := agentMemoryCompactPlan{Rewrites: []agentMemoryCompactRewrite{{ID: first.ID, Topic: "canvas.rewritten", Category: "canvas", Situation: "读取真实内容", Lesson: "先读取再修改"}}}
	raw, _ := json.Marshal(plan)
	s.noteAgentMemoryCompactTask(*task, map[string]any{"text": string(raw)}, nil)
	updated, err := s.UserAgentMemoryCompact("user")
	if err != nil || updated.LastStatus != model.AgentMemoryCompactStatusReview {
		t.Fatalf("must await approval: %+v %v", updated, err)
	}
	stored, _ := s.repo.AgentLessonForUser("user", first.ID)
	if stored.Topic != first.Topic {
		t.Fatal("task completion modified memory")
	}
}

func TestAgentMemoryProposalRewritePreservesVerificationAndIgnoresCallbackReplay(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	first := proposalLesson(t, s, "user-a", "canvas.first")
	proposal := finishProposalForTest(t, s, "user-a", []model.AgentLesson{first}, agentMemoryCompactPlan{
		Rewrites: []agentMemoryCompactRewrite{{ID: first.ID, Topic: "canvas.clearer", Category: "canvas", Situation: "准确修改画布", Lesson: "观察并验证修改", Source: "模型不能改来源"}},
	})
	if proposal.Status != model.AgentMemoryProposalPending || len(proposal.Changes) != 1 {
		t.Fatalf("missing rewrite proposal: %+v", proposal)
	}
	if _, err := s.DecideUserAgentMemoryProposal("user-a", proposal.ID, AgentMemoryProposalDecision{Decision: "approve", Version: proposal.Version}); err != nil {
		t.Fatal(err)
	}
	stored, err := s.repo.AgentLessonForUser("user-a", first.ID)
	if err != nil || stored.Topic != "canvas.clearer" || stored.Source != first.Source || !stored.LastVerifiedAt.Equal(*first.LastVerifiedAt) {
		t.Fatalf("rewrite changed original evidence: %+v %v", stored, err)
	}
	input, _ := json.Marshal(map[string]any{"metadata": map[string]any{"memoryProposalId": proposal.ID}})
	replay := model.Task{ID: "proposal-test-task", UserID: "user-a", Operation: cloudAgentMemoryCompactOp, InputJSON: string(input)}
	s.noteAgentMemoryCompactTask(replay, map[string]any{"text": `{"rewrites":[],"merges":[]}`}, nil)
	row, _ := s.repo.AgentMemoryProposalForUser("user-a", proposal.ID)
	if row.Status != model.AgentMemoryProposalApproved {
		t.Fatal("callback replay replaced decided proposal")
	}
}

func TestAgentMemoryCompactClaimRejectsDuplicateStartAndStaleFailure(t *testing.T) {
	s, _, _, _ := creationTestService(t)
	setting, err := s.ensureAgentMemorySetting("user-a")
	if err != nil {
		t.Fatal(err)
	}
	now := time.Now().UTC()
	first := &model.AgentMemoryProposal{ID: newID(), UserID: "user-a", Status: model.AgentMemoryProposalGenerating, Version: 1, InputJSON: "[]", ChangesJSON: "[]", SummaryJSON: "{}", CreatedAt: now, UpdatedAt: now}
	if err := s.repo.ClaimAgentMemoryCompact(setting, first, "cursor-first"); err != nil {
		t.Fatal(err)
	}
	second := *first
	second.ID = newID()
	if err := s.repo.ClaimAgentMemoryCompact(setting, &second, "cursor-second"); err == nil {
		t.Fatal("stale settings started a second job")
	}
	if err := s.repo.FailAgentMemoryCompactStart(*setting, "stale failure", now.Add(time.Second)); err != nil {
		t.Fatal(err)
	}
	current, err := s.repo.AgentMemorySetting("user-a")
	if err != nil || current.CompactProposalID != first.ID || current.CompactCursor != "cursor-first" || current.LastStatus != model.AgentMemoryCompactStatusQueued {
		t.Fatalf("stale failure overwrote active proposal: %+v %v", current, err)
	}
	if _, err := s.repo.AgentMemoryProposalForUser("user-a", second.ID); err == nil {
		t.Fatal("failed claim persisted an orphan proposal")
	}
}
