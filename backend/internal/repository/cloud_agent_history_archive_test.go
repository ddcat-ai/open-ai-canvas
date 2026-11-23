package repository

import (
	"fmt"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func archiveTestRun(userID, runID, conversationID string, status string) *model.CloudAgentExecution {
	return &model.CloudAgentExecution{
		ID:                runID,
		UserID:            userID,
		Status:            status,
		Revision:          1,
		CheckpointVersion: 2,
		ConversationID:    conversationID,
		EventCount:        45,
		MessageCount:      1,
		StateJSON:         `{}`,
		CreatedAt:         time.Now().Add(-2 * time.Hour),
		UpdatedAt:         time.Now().Add(-2 * time.Hour),
	}
}

func seedArchiveTestPayload(t *testing.T, repo *Repository, run *model.CloudAgentExecution) {
	t.Helper()
	if err := repo.db.Omit("Journal", "Transcript").Create(run).Error; err != nil {
		t.Fatal(err)
	}
	events := make([]model.CloudAgentEventRecord, 0, run.EventCount)
	for sequence := 1; sequence <= run.EventCount; sequence++ {
		events = append(events, model.CloudAgentEventRecord{RunID: run.ID, UserID: run.UserID, Sequence: sequence, EventJSON: fmt.Sprintf(`{"runId":"%s","seq":%d,"eventId":"%s:%d","type":"receipt","payload":{},"createdAt":"%s"}`, run.ID, sequence, run.ID, sequence, run.CreatedAt.Add(time.Duration(sequence)*time.Second).UTC().Format(time.RFC3339Nano)), CreatedAt: run.CreatedAt.Add(time.Duration(sequence) * time.Second)})
	}
	if err := repo.db.Create(&events).Error; err != nil {
		t.Fatal(err)
	}
	message := model.CloudAgentMessageRecord{RunID: run.ID, UserID: run.UserID, Kind: "canonical", Sequence: 1, MessageJSON: `{"role":"user","content":"hello"}`}
	if err := repo.db.Create(&message).Error; err != nil {
		t.Fatal(err)
	}
	mutation := model.CloudAgentCanvasMutation{ID: run.ID + "-mutation", RunID: run.ID, UserID: run.UserID, CanvasID: "canvas", StepID: "step", BeforeSnapshotHash: "before", AfterSnapshotHash: "after", BeforeJSON: `{"nodes":[]}`, Status: "applied", CreatedAt: run.CreatedAt.Add(time.Minute)}
	if err := repo.db.Create(&mutation).Error; err != nil {
		t.Fatal(err)
	}
	session := model.CloudAgentPiSession{RunID: run.ID, UserID: run.UserID, SessionJSONL: "session\n", Revision: 1, UpdatedAt: run.CreatedAt}
	if err := repo.db.Create(&session).Error; err != nil {
		t.Fatal(err)
	}
	used, err := repo.agentPayloadBytes(run.UserID)
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Create(&model.AgentStorageUsage{UserID: run.UserID, StoredBytes: used, UpdatedAt: time.Now()}).Error; err != nil {
		t.Fatal(err)
	}
}

func TestCompactCloudAgentRunPreservesArchiveReadsAndWindow(t *testing.T) {
	repo, _ := agentLifecycleRepositories(t, "sqlite")
	run := archiveTestRun("user", "run", "conversation", "completed")
	seedArchiveTestPayload(t, repo, run)

	freed, err := repo.CompactCloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if freed <= 0 {
		t.Fatalf("compact freed %d bytes", freed)
	}
	freedAgain, err := repo.CompactCloudAgentRun("user", run.ID)
	if err != nil || freedAgain != 0 {
		t.Fatalf("repeat compact freed=%d err=%v", freedAgain, err)
	}

	var archive model.CloudAgentHistoryArchive
	if err := repo.db.First(&archive, "run_id = ? AND user_id = ?", run.ID, "user").Error; err != nil {
		t.Fatal(err)
	}
	payload, err := decodeCloudAgentHistoryArchive(&archive)
	if err != nil || payload.StateJSON != run.StateJSON || len(payload.Events) != 45 || len(payload.Mutations) != 1 || payload.Mutations[0].BeforeJSON != `{"nodes":[]}` {
		t.Fatalf("archive payload events=%d mutations=%+v err=%v", len(payload.Events), payload.Mutations, err)
	}

	stored, err := repo.CloudAgent("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	if !stored.HistoryCompacted || len(stored.Journal) != CloudAgentJournalWindow || stored.Journal[0].Sequence != 6 || stored.Journal[len(stored.Journal)-1].Sequence != 45 {
		t.Fatalf("unexpected compacted journal: compacted=%v len=%d first=%d last=%d", stored.HistoryCompacted, len(stored.Journal), stored.Journal[0].Sequence, stored.Journal[len(stored.Journal)-1].Sequence)
	}
	if stored.StateJSON != run.StateJSON {
		t.Fatalf("compacted state was not restored: %q", stored.StateJSON)
	}
	if len(stored.Transcript) != 1 {
		t.Fatalf("compacted transcript length=%d", len(stored.Transcript))
	}
	if session, err := repo.CloudAgentPiSession("user", run.ID); err != nil || session.SessionJSONL != "session\n" {
		t.Fatalf("archived Pi session=%+v err=%v", session, err)
	}
	if records, err := repo.CloudAgentEventRecords("user", run.ID, 40, 10); err != nil || len(records) != 5 || records[0].Sequence != 41 {
		t.Fatalf("archived event page=%+v err=%v", records, err)
	}
	if records, err := repo.CloudAgentEventRecordsBefore("user", run.ID, 8, 3); err != nil || len(records) != 3 || records[0].Sequence != 5 || records[2].Sequence != 7 {
		t.Fatalf("archived event before page=%+v err=%v", records, err)
	}
	if count, err := repo.CloudAgentEventRecordCount("user", run.ID); err != nil || count != 45 {
		t.Fatalf("archived event count=%d err=%v", count, err)
	}
	used, err := repo.AgentStoredBytes("user")
	if err != nil || used != 0 {
		t.Fatalf("stored bytes after compact=%d err=%v", used, err)
	}
}

func TestDeleteCloudAgentConversationRemovesHotAndColdHistoryOnly(t *testing.T) {
	repo, _ := agentLifecycleRepositories(t, "sqlite")
	first := archiveTestRun("user", "run-1", "conversation", "completed")
	second := &model.CloudAgentExecution{ID: "run-2", UserID: "user", ConversationID: "conversation", Status: "completed", Revision: 1, StateJSON: `{"second":true}`, CreatedAt: time.Now().Add(-time.Hour), UpdatedAt: time.Now().Add(-time.Hour)}
	seedArchiveTestPayload(t, repo, first)
	if _, err := repo.CompactCloudAgentRun("user", first.ID); err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Create(second).Error; err != nil {
		t.Fatal(err)
	}
	used, err := repo.agentPayloadBytes("user")
	if err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Model(&model.AgentStorageUsage{}).Where("user_id = ?", "user").Update("stored_bytes", used).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Create(&model.Task{ID: first.ID, UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	if err := repo.db.Create(&model.Task{ID: second.ID, UserID: "user", Operation: "cloud_agent", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	usedBefore, err := repo.AgentStoredBytes("user")
	if err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCloudAgentConversation("user", "conversation"); err != nil {
		t.Fatal(err)
	}
	var runs int64
	if err := repo.db.Model(&model.CloudAgentExecution{}).Where("user_id = ?", "user").Count(&runs).Error; err != nil {
		t.Fatal(err)
	}
	var archives int64
	if err := repo.db.Model(&model.CloudAgentHistoryArchive{}).Where("user_id = ?", "user").Count(&archives).Error; err != nil {
		t.Fatal(err)
	}
	if runs != 0 || archives != 0 {
		t.Fatalf("conversation history remains runs=%d archives=%d", runs, archives)
	}
	var tasks int64
	if err := repo.db.Model(&model.Task{}).Where("user_id = ?", "user").Count(&tasks).Error; err != nil {
		t.Fatal(err)
	}
	if tasks != 2 {
		t.Fatalf("task audit rows deleted: %d", tasks)
	}
	usedAfter, err := repo.AgentStoredBytes("user")
	if err != nil || usedAfter != 0 || usedBefore <= usedAfter {
		t.Fatalf("stored bytes after delete=%d before=%d err=%v", usedAfter, usedBefore, err)
	}
}

func TestDeleteCloudAgentConversationRejectsActiveAndCrossUser(t *testing.T) {
	repo, _ := agentLifecycleRepositories(t, "sqlite")
	active := &model.CloudAgentExecution{ID: "active", UserID: "user", ConversationID: "conversation", Status: "running", Revision: 1, StateJSON: `{}`}
	if err := repo.db.Create(active).Error; err != nil {
		t.Fatal(err)
	}
	if _, err := repo.DeleteCloudAgentConversation("user", "conversation"); err == nil {
		t.Fatal("active conversation deletion succeeded")
	}
	if _, err := repo.DeleteCloudAgentConversation("other", "conversation"); err != nil {
		t.Fatalf("cross-user deletion returned error: %v", err)
	}
	var count int64
	if err := repo.db.Model(&model.CloudAgentExecution{}).Where("id = ?", active.ID).Count(&count).Error; err != nil || count != 1 {
		t.Fatalf("active run deleted count=%d err=%v", count, err)
	}
	if err := repo.db.First(&model.CloudAgentExecution{}, "id = ?", active.ID).Error; err != nil {
		t.Fatal(err)
	}
}
