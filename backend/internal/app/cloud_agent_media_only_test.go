package app

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

func TestCreationMediaOnlyRequestPreservesInputAndIdempotency(t *testing.T) {
	for _, mode := range []string{"", "replace", "append"} {
		t.Run(mode, func(t *testing.T) {
			s, _, _ := cloudAgentVisionFixture(t)
			req := creationReferenceRequest(t, "media-only-admission-key", mode, "ref-one")
			req.Prompt = " \n\t"
			if mode == "replace" {
				req.PermissionMode = "request_approval"
			} else if mode == "append" {
				req.PermissionMode = "auto"
			}
			run, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil {
				t.Fatalf("owned current attachment was rejected without text: %v", err)
			}
			if run.UserPrompt != "" || len(run.Attachments) != 1 {
				t.Fatalf("media-only user input was rewritten: %+v", run)
			}
			replay, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil || replay.ID != run.ID {
				t.Fatalf("identical media-only request was not idempotent: %+v %v", replay, err)
			}
			req.Attachments[0].ResourceID, req.Attachments[0].StorageKey = "ref-two", "resource:ref-two"
			if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
				t.Fatal("different media was accepted under the same idempotency key")
			}
			task, state, err := s.cloudAgentTask("user", run.ID)
			if err != nil || task.Prompt != "" || state.Request.Prompt != "" {
				t.Fatalf("media-only persisted request is invalid or invented text: %+v %v", task, err)
			}
			runs, err := s.CloudAgentSessionRuns("user", run.SessionID, 10)
			if err != nil || len(runs) != 1 || runs[0].UserPrompt != "" || len(runs[0].Attachments) != 1 {
				t.Fatalf("session recovery lost the media-only turn: %+v %v", runs, err)
			}
		})
	}
}

func TestCreationMediaOnlyAllowsSupportedMediaWithoutGrantingOrdinaryEmptyTasks(t *testing.T) {
	for _, kind := range []string{"image", "video", "audio"} {
		t.Run(kind, func(t *testing.T) {
			s, db, _ := cloudAgentVisionFixture(t)
			if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("mime_type", kind+"/test").Error; err != nil {
				t.Fatal(err)
			}
			req := creationReferenceRequest(t, "media-only-kind-"+kind, "", "ref-one")
			req.Prompt, req.Attachments[0].Kind = "", kind
			run, err := s.CreateCloudAgentRun("user", req, "")
			if err != nil || len(run.Attachments) != 1 || run.Attachments[0].Kind != kind {
				t.Fatalf("%s-only message was rejected: %+v %v", kind, run, err)
			}
			for _, taskType := range []string{"canvas_text", "canvas_image", "canvas_video"} {
				_, err := s.CreateTask("user", CreateTaskRequest{Type: taskType, Input: map[string]any{
					"referenceImages": []providerMedia{{StorageKey: "resource:ref-one"}},
					"agentRequests":   map[string]any{"canonical": map[string]any{"messages": []map[string]any{{"role": "user", "content": "fake internal request"}}}},
				}})
				if err == nil || err.Error() != "prompt is required" {
					t.Fatalf("ordinary %s bypassed nonempty prompt admission: %v", taskType, err)
				}
			}
			if _, err := s.processCanvasGenerationTask(context.Background(), "user", "", "canvas_text", "", `{"mode":"text","agentRequests":{"canonical":{"messages":[]}}}`); err == nil || err.Error() != "prompt is required" {
				t.Fatalf("worker accepted an empty prompt and empty canonical conversation: %v", err)
			}
		})
	}
}

func TestCreationMediaOnlyRequestStillRequiresCurrentAuthorizedInput(t *testing.T) {
	for _, tc := range []struct {
		name   string
		mutate func(*CloudAgentRequest)
	}{
		{"no-message", func(r *CloudAgentRequest) { r.Attachments = nil }},
		{"old-context-only", func(r *CloudAgentRequest) {
			r.Attachments = nil
			r.CreationContext = []CloudAgentCreationContextEntry{{Role: "user", Mode: "image", Content: "之前发过的图", ResourceIDs: []string{"ref-one"}}}
		}},
		{"inherited-only", func(r *CloudAgentRequest) { r.Attachments = nil; r.AttachmentMode = "inherit" }},
		{"inherit-with-new-media", func(r *CloudAgentRequest) { r.AttachmentMode = "inherit" }},
		{"canvas", func(r *CloudAgentRequest) { r.Surface = "canvas"; r.CanvasID = "agent-canvas" }},
		{"missing-media", func(r *CloudAgentRequest) {
			r.Attachments[0].ResourceID, r.Attachments[0].StorageKey = "not-owned", "resource:not-owned"
		}},
		{"wrong-type", func(r *CloudAgentRequest) { r.Attachments[0].Kind = "video" }},
		{"invalid-key", func(r *CloudAgentRequest) { r.Attachments[0].StorageKey = "resource:ref-two" }},
		{"invalid-permission", func(r *CloudAgentRequest) { r.PermissionMode = "unrestricted" }},
		{"no-budget", func(r *CloudAgentRequest) { r.Budget.MaxCredits = 0 }},
		{"readonly-generation", func(r *CloudAgentRequest) { r.Budget.MaxGenerationTasks = 1 }},
		{"control-text", func(r *CloudAgentRequest) { r.Prompt = "\v" }},
		{"invalid-text", func(r *CloudAgentRequest) { r.Prompt = string([]byte{0xff}) }},
	} {
		t.Run(tc.name, func(t *testing.T) {
			s, db, _ := cloudAgentVisionFixture(t)
			parent, err := s.CreateCloudAgentRun("user", creationReferenceRequest(t, "media-only-parent", "", "ref-one"), "")
			if err != nil {
				t.Fatal(err)
			}
			completeCreationReferenceRun(t, db, parent.ID)
			req := creationReferenceRequest(t, "media-only-invalid-key", "", "ref-one")
			req.Prompt = ""
			tc.mutate(&req)
			if _, err := s.CreateCloudAgentRun("user", req, parent.ID); err == nil {
				t.Fatal("invalid media-only turn was accepted")
			}
		})
	}
	for _, changes := range []map[string]any{{"user_id": "other"}, {"status": "pending"}} {
		s, db, _ := cloudAgentVisionFixture(t)
		if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Updates(changes).Error; err != nil {
			t.Fatal(err)
		}
		req := creationReferenceRequest(t, "media-only-resource-check", "", "ref-one")
		req.Prompt = ""
		if _, err := s.CreateCloudAgentRun("user", req, ""); err == nil {
			t.Fatalf("unowned or unready media was accepted: %v", changes)
		}
	}
}

func TestCreationMediaOnlyNativeConversationKeepsRealUserTurns(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, pixels := cloudAgentVisionFixture(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	received := make(chan map[string]any, 4)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		received <- body
		writeSSE(w, sseDelta(map[string]any{"content": "已记住对话约定，按当前权限继续。"}))
	}))
	t.Cleanup(server.Close)
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop) })
	go func() {
		for {
			select {
			case <-stop:
				return
			default:
			}
			_ = s.ProcessNextTask()
			time.Sleep(20 * time.Millisecond)
		}
	}()
	agreement := "后面发图时，按亚马逊美国站规划五张1:1图片；只读讨论，不要提交生成。"
	parentID, sessionID := "", ""
	for i, prompt := range []string{agreement, "", "", "换个话题，聊聊雪山"} {
		req := creationAgentRequest()
		req.IdempotencyKey = "media-only-native-turn-" + string(rune('0'+i))
		req.Prompt = prompt
		if i == 1 || i == 2 {
			id := "ref-one"
			if i == 2 {
				id = "ref-two"
			}
			req.Attachments = []CloudAgentAttachment{{ResourceID: id, StorageKey: "resource:" + id, Kind: "image", Role: "product", Name: id}}
		}
		run, err := s.CreateCloudAgentRun("user", req, parentID)
		if err != nil {
			t.Fatalf("turn %d creation failed: %v", i, err)
		}
		if execution := waitLiveAgentTerminal(t, s, run.ID); execution.Status != "completed" {
			t.Fatalf("turn %d runtime failed: %s", i, execution.FailureMessage)
		}
		select {
		case body := <-received:
			raw, _ := json.Marshal(body)
			if !strings.Contains(string(raw), agreement) {
				t.Fatalf("turn %d lost the user's standing agreement", i)
			}
			hasImage := strings.Contains(string(raw), base64.StdEncoding.EncodeToString(pixels))
			if hasImage != (i == 1 || i == 2) {
				t.Fatalf("turn %d current image delivery = %v", i, hasImage)
			}
			imageCount := 0
			for _, message := range creationMaps(body["messages"]) {
				for _, part := range creationMaps(message["content"]) {
					if stringField(part, "type") == "image_url" {
						imageCount++
					}
				}
			}
			if (hasImage && imageCount != 1) || (!hasImage && imageCount != 0) {
				t.Fatalf("turn %d automatically carried earlier image pixels: count=%d", i, imageCount)
			}
		default:
			t.Fatalf("turn %d never reached the native model bridge", i)
		}
		snapshot, err := s.repo.CloudAgentPiSession("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		var actualUsers []string
		for _, line := range strings.Split(snapshot.SessionJSONL, "\n") {
			var entry struct {
				Type    string `json:"type"`
				Message struct {
					Role    string `json:"role"`
					Content any    `json:"content"`
				} `json:"message"`
			}
			if json.Unmarshal([]byte(line), &entry) == nil && entry.Type == "message" && entry.Message.Role == "user" {
				actualUsers = append(actualUsers, runtimeContentText(entry.Message.Content))
			}
		}
		if len(actualUsers) != i+1 || actualUsers[i] != prompt {
			t.Fatalf("turn %d invented, duplicated or lost a native user message: %#v", i, actualUsers)
		}
		if strings.Contains(snapshot.SessionJSONL, "base64,") {
			t.Fatal("native session persisted media pixels")
		}
		parentID, sessionID = run.ID, run.SessionID
	}
	runs, err := s.CloudAgentSessionRuns("user", sessionID, 10)
	if err != nil || len(runs) != 4 {
		t.Fatalf("conversation history lost media-only turns: %+v %v", runs, err)
	}
	var mediaTasks int64
	if err := db.Model(&model.Task{}).Where("type IN ?", []string{"canvas_image", "canvas_video"}).Count(&mediaTasks).Error; err != nil || mediaTasks != 0 {
		t.Fatalf("media-only discussion submitted generation: %d %v", mediaTasks, err)
	}
}
