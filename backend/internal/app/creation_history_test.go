package app

import (
	"encoding/json"
	"errors"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

func TestCreationHistoryReceiptRecoveryAndIncrementalValidation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	id := "receipt-creation-conversation"
	if _, err := s.CreateCloudAgentSession("user", CloudAgentSessionRequest{ID: id, Surface: "creation"}); err != nil {
		t.Fatal(err)
	}
	if err := db.Create(&model.Resource{ID: "reference", UserID: "user"}).Error; err != nil {
		t.Fatal(err)
	}
	input := CreationHistoryRequest{SourceConversationID: id, Messages: []CreationHistoryMessage{
		{ID: "prompt", Role: "user", Mode: "image", Content: "参考 @[node:ref] 创作", CreatedAt: time.Now().UTC(), Attachments: []CreationHistoryAttachment{{ID: "ref", StorageKey: "resource:reference", Name: "参考", Type: "image/png"}}, References: []CreationHistoryReference{{ID: "ref", Kind: "image", Label: "图片1", MentionToken: "@[node:ref]", AttachmentID: "ref"}}},
		{ID: "answer", Role: "assistant", Mode: "image", CreatedAt: time.Now().UTC(), ClientOperationID: "operation"},
	}}
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	encoded, _ := json.Marshal(map[string]any{"metadata": map[string]string{"source": "create-page", "conversationId": id, "creationSessionId": id, "messageId": "answer"}, "channel": map[string]string{"apiKey": "must-not-return"}})
	if err := db.Create(&model.Task{ID: "accepted", UserID: "user", Type: "canvas_image", Status: model.TaskStatusSucceeded, InputJSON: string(encoded)}).Error; err != nil {
		t.Fatal(err)
	}
	history, err := s.CreationHistory("user", id)
	if err != nil || len(history.Messages[1].TaskIDs) != 1 || history.Messages[1].TaskIDs[0] != "accepted" {
		t.Fatalf("lost receipt not recovered: %+v %v", history, err)
	}
	rows, err := s.repo.CreationSessionTasks("user", id, id)
	if err != nil || len(rows) != 1 {
		t.Fatalf("task lookup: %+v %v", rows, err)
	}
	var projected map[string]any
	if err := json.Unmarshal([]byte(rows[0].InputJSON), &projected); err != nil || projected["channel"] != nil {
		t.Fatalf("task credentials entered history lookup: %v", err)
	}
	input.Messages[1].TaskIDs = history.Messages[1].TaskIDs
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	// A previously validated reference may later expire independently. Appending
	// a new turn must not revalidate every old resource and task.
	if err := db.Delete(&model.Resource{}, "id = ?", "reference").Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Delete(&model.Task{}, "id = ?", "accepted").Error; err != nil {
		t.Fatal(err)
	}
	input.Messages = append(input.Messages, CreationHistoryMessage{ID: "next", Role: "user", Mode: "image", Content: "继续", CreatedAt: time.Now().UTC(), Settings: map[string]string{}})
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	input.Messages[1].TaskIDs = append(input.Messages[1].TaskIDs, "unvalidated")
	if _, err := s.SaveCreationHistory("user", id, input); err == nil {
		t.Fatal("accepted new unvalidated receipt")
	}
}

func TestCreationHistoryPrivateStableSessionAndMerge(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	id := "stable-creation-conversation"
	req := CloudAgentSessionRequest{ID: id, Surface: "creation", Title: "普通图片"}
	first, err := s.CreateCloudAgentSession("user", req)
	if err != nil {
		t.Fatal(err)
	}
	second, err := s.CreateCloudAgentSession("user", req)
	if err != nil || first.ID != id || second.ID != id {
		t.Fatalf("unstable identity: %+v %v", second, err)
	}
	if _, err := s.CreateCloudAgentSession("other", req); err == nil {
		t.Fatal("foreign session reused")
	}
	message := CreationHistoryMessage{ID: "first-user", Role: "user", Mode: "image", Content: "原始用户输入", CreatedAt: time.Now().UTC()}
	input := CreationHistoryRequest{SourceConversationID: id, Messages: []CreationHistoryMessage{message}}
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	stored, _ := s.repo.AgentSession("user", id)
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	replayed, _ := s.repo.AgentSession("user", id)
	if !stored.UpdatedAt.Equal(replayed.UpdatedAt) {
		t.Fatal("reading/replaying history extended retention")
	}
	message.ID, message.Content = "second-device", "第二台设备"
	if _, err := s.SaveCreationHistory("user", id, CreationHistoryRequest{SourceConversationID: id, Messages: []CreationHistoryMessage{message}}); err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveCreationHistory("user", id, input); err != nil {
		t.Fatal(err)
	}
	history, err := s.CreationHistory("user", id)
	if err != nil || len(history.Messages) != 2 {
		t.Fatalf("stale snapshot erased messages: %+v %v", history, err)
	}
	if _, err := s.CreationHistory("other", id); err == nil {
		t.Fatal("foreign history readable")
	}
	input.Messages[0].Content = "篡改已有正文"
	if _, err := s.SaveCreationHistory("user", id, input); err == nil {
		t.Fatal("existing message replaced")
	}
	if err := db.Model(&model.AgentSession{}).Where("id = ?", id).Update("status", "deleted").Error; err != nil {
		t.Fatal(err)
	}
	if _, err := s.SaveCreationHistory("user", id, input); err == nil {
		t.Fatal("deleted history revived")
	}
	if _, err := s.CreateCloudAgentSession("user", req); err == nil {
		t.Fatal("deleted session recreated")
	}
}

func TestCreationHistoryRejectsForeignTasksAndAgentImpersonation(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	id := "private-creation-conversation"
	if _, err := s.CreateCloudAgentSession("user", CloudAgentSessionRequest{ID: id, Surface: "creation"}); err != nil {
		t.Fatal(err)
	}
	for _, task := range []model.Task{
		{ID: "own", UserID: "user", Type: "canvas_image", InputJSON: `{"metadata":{"source":"create-page","conversationId":"private-creation-conversation","messageId":"result"}}`},
		{ID: "foreign", UserID: "other", Type: "canvas_image"},
		{ID: "other-session", UserID: "user", Type: "canvas_image", InputJSON: `{"metadata":{"source":"create-page","conversationId":"another","messageId":"result"}}`},
		{ID: "agent", UserID: "user", Type: "canvas_image", AgentRunID: "run"},
	} {
		if err := db.Create(&task).Error; err != nil {
			t.Fatal(err)
		}
	}
	message := CreationHistoryMessage{ID: "result", Role: "assistant", Mode: "image", CreatedAt: time.Now().UTC()}
	for _, taskID := range []string{"foreign", "other-session", "agent"} {
		message.TaskIDs = []string{taskID}
		if _, err := s.SaveCreationHistory("user", id, CreationHistoryRequest{SourceConversationID: id, Messages: []CreationHistoryMessage{message}}); err == nil {
			t.Fatalf("accepted %s", taskID)
		}
	}
	message.TaskIDs = []string{"own"}
	if _, err := s.SaveCreationHistory("user", id, CreationHistoryRequest{SourceConversationID: id, Messages: []CreationHistoryMessage{message}}); err != nil {
		t.Fatal(err)
	}
	message.Mode = "agent"
	if _, err := s.SaveCreationHistory("user", id, CreationHistoryRequest{SourceConversationID: id, Messages: []CreationHistoryMessage{message}}); err == nil {
		t.Fatal("browser supplied native Agent history")
	}
}

func TestCreationHistoryExpiryProtectsActiveWorkAndNewActivity(t *testing.T) {
	s, db, _, _ := creationTestService(t)
	old := time.Now().Add(-48 * time.Hour)
	cutoff := time.Now().Add(-24 * time.Hour)
	for _, id := range []string{"expired", "busy", "fresh", "canvas"} {
		surface := "creation"
		if id == "canvas" {
			surface = "canvas"
		}
		if err := db.Create(&model.AgentSession{ID: id, UserID: "user", Surface: surface, Status: "active", CreatedAt: old, UpdatedAt: old}).Error; err != nil {
			t.Fatal(err)
		}
	}
	if err := db.Create(&model.Task{ID: "busy-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusRunning, InputJSON: `{"metadata":{"creationSessionId":"busy"}}`, CreatedAt: old, UpdatedAt: old}).Error; err != nil {
		t.Fatal(err)
	}
	if err := s.repo.TouchAgentSession("user", "fresh", "creation", ""); err != nil {
		t.Fatal(err)
	}
	if err := s.repo.ExpireCreationSession("user", "busy", cutoff); !errors.Is(err, repository.ErrAgentSessionBusy) {
		t.Fatalf("busy history expired: %v", err)
	}
	for _, id := range []string{"expired", "fresh", "canvas"} {
		if err := s.repo.ExpireCreationSession("user", id, cutoff); err != nil {
			t.Fatal(err)
		}
	}
	for _, id := range []string{"expired", "busy", "fresh", "canvas"} {
		row, _ := s.repo.AgentSession("user", id)
		if (row.Status == "deleted") != (id == "expired") {
			t.Fatalf("wrong retention: %s %s", id, row.Status)
		}
	}
	late := &model.Task{ID: "late", UserID: "user", Type: "canvas_image", Status: model.TaskStatusQueued, InputJSON: `{"metadata":{"creationSessionId":"expired"}}`}
	if err := s.repo.CreateTaskWithActiveLimit(late, 10); !errors.Is(err, repository.ErrAgentSessionUnavailable) {
		t.Fatalf("expired session admitted task: %v", err)
	}
	var tasks int64
	if err := db.Model(&model.Task{}).Count(&tasks).Error; err != nil || tasks != 1 {
		t.Fatalf("retention changed tasks: %d %v", tasks, err)
	}
}
