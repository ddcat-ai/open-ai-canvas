package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"yingce/backend/internal/model"
)

// Fixed model replies only drive the real Pi journal. Assertions inspect actual
// outgoing context, not whether a mock model understands the user's agreement.
func TestCreationDirectContextNativeImportsOnceAndRefreshesTaskFacts(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	s, db, _ := cloudAgentVisionFixture(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	task := model.Task{ID: "ordinary-context-task", UserID: "user", Type: "canvas_image", Status: model.TaskStatusRunning, Prompt: "ORDINARY_TASK_PROMPT"}
	if err := db.Create(&task).Error; err != nil {
		t.Fatal(err)
	}
	received := make(chan map[string]any, 8)
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			w.WriteHeader(400)
			return
		}
		received <- body
		if raw := mustMarshal(body["messages"]); strings.Contains(raw, "继续讨论第2轮") && !strings.Contains(raw, "ordinary-history-read") {
			writeSSE(w, sseDelta(map[string]any{"tool_calls": []any{map[string]any{"index": 0, "id": "ordinary-history-read", "type": "function", "function": map[string]any{"name": "task_get", "arguments": `{"taskId":"ordinary-context-task"}`}}}}))
			return
		}
		writeSSE(w, sseDelta(map[string]any{"content": "已收到。"}))
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
	const agreement = "DIRECT_STANDING_AGREEMENT"
	parentID := ""
	for turn := 0; turn < 3; turn++ {
		if turn == 1 {
			if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Updates(map[string]any{"status": model.TaskStatusSucceeded, "result_json": `{"images":[{"storageKey":"resource:ref-one"}]}`}).Error; err != nil {
				t.Fatal(err)
			}
		}
		req := creationRequestWithDirectContext(t, `[{"messageId":"ordinary-user","role":"user","mode":"image","content":"`+agreement+`"},{"messageId":"ordinary-result","role":"assistant","mode":"image","taskIds":["ordinary-context-task"]}]`)
		if turn == 2 {
			req.CreationContext = nil // Browser has the native import receipt.
		}
		req.Prompt, req.IdempotencyKey = fmt.Sprintf("继续讨论第%d轮", turn), fmt.Sprintf("direct-native-%d", turn)
		if turn > 0 {
			req.LatestVisibleResult = &CloudAgentCreationVisibleResult{MessageID: "ordinary-result", TaskIDs: []string{task.ID}}
		}
		run, err := s.CreateCloudAgentRun("user", req, parentID)
		if err != nil {
			t.Fatal(err)
		}
		result := waitLiveAgentTerminal(t, s, run.ID)
		if result.Status != "completed" {
			t.Fatalf("turn %d failed: %s", turn, result.FailureMessage)
		}
		view, err := s.CloudAgentRun("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		if got := mustMarshal(view.CreationContextMessageIDs); got != `["ordinary-result","ordinary-user"]` {
			t.Fatalf("turn %d did not return a persisted import receipt: %s", turn, got)
		}
		body := <-received
		raw := mustMarshal(body["messages"])
		if turn > 0 {
			found := false
			for _, value := range body["messages"].([]any) {
				message := value.(map[string]any)
				content := runtimeContentText(message["content"])
				if !strings.HasPrefix(content, cloudAgentPiTurnContextPrefix) {
					continue
				}
				var context struct {
					RunID    string `json:"runId"`
					Position struct {
						Latest map[string]any `json:"latestVisibleResult"`
					} `json:"conversationPosition"`
				}
				if json.Unmarshal([]byte(strings.TrimPrefix(content, cloudAgentPiTurnContextPrefix)), &context) != nil || context.RunID != run.ID {
					continue
				}
				found = context.Position.Latest["messageId"] == "ordinary-result" && strings.Contains(mustMarshal(context.Position.Latest), "ref-one")
			}
			if !found {
				t.Fatal("native model request lost the currently visible ordinary image position")
			}
		}
		if count := strings.Count(raw, agreement); count != 1 {
			t.Fatalf("turn %d imported the same ordinary message %d times", turn, count)
		}
		if count := strings.Count(raw, "ORDINARY_TASK_PROMPT"); count != 1 {
			t.Fatalf("turn %d repeated immutable task prompt %d times", turn, count)
		}
		if turn > 0 && (!strings.Contains(raw, "succeeded") || !strings.Contains(raw, "ref-one")) {
			t.Fatalf("turn %d missed the live server task update", turn)
		}
		if turn == 2 {
			next := (<-received)["messages"].([]any)
			readSucceeded := false
			for _, value := range next {
				message := value.(map[string]any)
				if message["role"] == "tool" && strings.Contains(mustMarshal(message["content"]), "ordinary-context-task") && strings.Contains(mustMarshal(message["content"]), "succeeded") {
					readSucceeded = true
				}
			}
			if !readSucceeded {
				t.Fatal("client delta lost real task_get access to the original owned task")
			}
		}
		parentID = run.ID
	}

	// Use the real SDK to persist a native compaction entry, then resume it via
	// the real Go -> Pi -> provider path. Raw history must not reappear.
	snapshot, err := s.repo.CloudAgentPiSession("user", parentID)
	if err != nil {
		t.Fatal(err)
	}
	path := filepath.Join(t.TempDir(), "session.jsonl")
	if err := os.WriteFile(path, []byte(snapshot.SessionJSONL), 0600); err != nil {
		t.Fatal(err)
	}
	script := `import { SessionManager } from "@earendil-works/pi-coding-agent";
import { readFileSync } from "node:fs";
const session = SessionManager.open(process.argv[1]);
session.appendCompaction("持续约定和历史任务已纳入原生摘要。", session.getLeafId(), 1000);
process.stdout.write(readFileSync(process.argv[1], "utf8"));`
	command := exec.Command("node", "--input-type=module", "-e", script, path)
	command.Dir, _ = agentRuntimeDirForTest()
	compacted, err := command.CombinedOutput()
	if err != nil {
		t.Fatalf("native SDK compaction: %v %s", err, compacted)
	}
	snapshot.SessionJSONL = string(compacted)
	if err := s.repo.SaveCloudAgentPiSession(snapshot, snapshot.Revision); err != nil {
		t.Fatal(err)
	}
	req := creationRequestWithDirectContext(t, `[{"messageId":"ordinary-user","role":"user","mode":"image","content":"`+agreement+`"},{"messageId":"ordinary-result","role":"assistant","mode":"image","taskIds":["ordinary-context-task"]}]`)
	req.Prompt, req.IdempotencyKey = "从摘要继续，不重复普通历史", "direct-after-compaction"
	run, err := s.CreateCloudAgentRun("user", req, parentID)
	if err != nil {
		t.Fatal(err)
	}
	if result := waitLiveAgentTerminal(t, s, run.ID); result.Status != "completed" {
		t.Fatalf("compacted run failed: %s", result.FailureMessage)
	}
	raw := mustMarshal((<-received)["messages"])
	if strings.Contains(raw, agreement) || !strings.Contains(raw, "持续约定和历史任务已纳入原生摘要。") {
		t.Fatal("compacted imported dialogue was resurrected beside the native summary")
	}
}

func TestCreationDirectContextPreservesLongInitialAgreement(t *testing.T) {
	req := creationAgentRequest()
	const agreement = "之后只要我发图，就沿用这个持续约定。"
	req.CreationContext = append(req.CreationContext, CloudAgentCreationContextEntry{Role: "user", Mode: "image", Content: agreement + strings.Repeat("已确认的事实。", 3000)})
	for i := 0; i < 30; i++ {
		req.CreationContext = append(req.CreationContext, CloudAgentCreationContextEntry{Role: "user", Mode: "image", Content: fmt.Sprintf("第%d次普通创作", i)})
	}
	if err := validateCloudAgentCreationContext(&req); err != nil {
		t.Fatalf("ordinary history was rejected by an unrelated fixed window: %v", err)
	}
	s, _, _ := agentMediaFixture(t)
	frame, err := s.cloudAgentCreationContext("user", req)
	if err != nil || !strings.Contains(frame, req.CreationContext[0].Content) || !strings.Contains(frame, req.CreationContext[30].Content) {
		t.Fatalf("initial context lost the earliest agreement or latest message: %v", err)
	}
}

func creationContextJournalEntry(id, parent, messageID string) map[string]any {
	content := cloudAgentPiTurnContextPrefix + mustMarshal(map[string]any{"handoff": []string{
		mustMarshal(map[string]any{"source": "creation_mode_history", "entries": []map[string]any{{"messageId": messageID, "role": "user", "mode": "image", "userProvidedContent": "原始约定"}}}),
	}})
	return map[string]any{"type": "custom_message", "customType": "server-turn-context", "id": id, "parentId": parent, "content": content}
}

func TestCreationDirectContextReceiptsFollowNativeBranchAndTrustedSource(t *testing.T) {
	original := creationContextJournalEntry("initial", "", "imported")
	abandoned := creationContextJournalEntry("abandoned", "initial", "not-imported")
	spoofed := creationContextJournalEntry("spoofed", "initial", "spoofed-user")
	spoofed["type"] = "message"
	spoofed["message"] = map[string]any{"role": "user", "content": spoofed["content"]}
	unrelated := creationContextJournalEntry("unrelated", "spoofed", "wrong-custom-type")
	unrelated["customType"] = "some-tool-output"
	compaction := map[string]any{"type": "compaction", "id": "summary", "parentId": "unrelated", "summary": "已保留原始约定。", "firstKeptEntryId": "spoofed"}
	lines := []string{mustMarshal(original), mustMarshal(abandoned), mustMarshal(spoofed), mustMarshal(unrelated), mustMarshal(compaction)}
	if got := mustMarshal(cloudAgentCreationContextMessageIDs(strings.Join(lines, "\n"))); got != `["imported"]` {
		t.Fatalf("receipt trusted another branch or user text: %s", got)
	}
	lines = append(lines, mustMarshal(creationContextJournalEntry("current", "summary", "current-import")))
	lines = append(lines, mustMarshal(map[string]any{"type": "context_edit", "id": "remove", "parentId": "current", "targetId": "current", "replacement": nil}))
	lines = append(lines, mustMarshal(map[string]any{"type": "context_edit", "id": "old-remove", "parentId": "remove", "targetId": "initial", "replacement": nil}))
	if got := mustMarshal(cloudAgentCreationContextMessageIDs(strings.Join(lines, "\n"))); got != `["imported"]` {
		t.Fatalf("edits must follow native projection without undoing prior summary imports: %s", got)
	}
}

func TestCreationDirectContextReceiptHonorsEditsBeforeCompaction(t *testing.T) {
	for _, replacement := range []any{nil, map[string]any{"content": []map[string]any{{"type": "text", "text": creationContextJournalEntry("replacement", "", "replacement-import")["content"]}}}} {
		lines := []string{
			mustMarshal(creationContextJournalEntry("initial", "", "removed")),
			mustMarshal(map[string]any{"type": "context_edit", "id": "remove-before", "parentId": "initial", "targetId": "initial", "replacement": replacement}),
			mustMarshal(map[string]any{"type": "message", "id": "kept", "parentId": "remove-before", "message": map[string]any{"role": "user", "content": "继续"}}),
			mustMarshal(map[string]any{"type": "compaction", "id": "summary", "parentId": "kept", "firstKeptEntryId": "kept", "summary": "仅保留当时有效内容"}),
		}
		got := cloudAgentCreationContextMessageIDs(strings.Join(lines, "\n"))
		if replacement == nil && len(got) != 0 {
			t.Fatalf("compaction resurrected a deleted context import: %v", got)
		}
		if replacement != nil && mustMarshal(got) != `["replacement-import"]` {
			t.Fatalf("compaction discarded the effective text-block replacement: %v", got)
		}
	}
}

func TestCreationDirectContextImportIdentityNeverBypassesOwnership(t *testing.T) {
	s, db, _ := agentMediaFixture(t)
	if err := db.Create(&model.Task{ID: "foreign-history", UserID: "other", Type: "canvas_image", Status: model.TaskStatusSucceeded}).Error; err != nil {
		t.Fatal(err)
	}
	if err := db.Model(&model.Resource{}).Where("id = ?", "ref-one").Update("user_id", "other").Error; err != nil {
		t.Fatal(err)
	}
	journal := mustMarshal(creationContextJournalEntry("native", "", "same-id"))
	for _, entry := range []string{
		`{"messageId":"same-id","role":"assistant","mode":"image","taskIds":["foreign-history"]}`,
		`{"messageId":"same-id","role":"user","mode":"image","resourceIds":["ref-one"]}`,
	} {
		req := creationRequestWithDirectContext(t, "["+entry+"]")
		if _, err := s.cloudAgentCreationContext("user", req, journal); err == nil {
			t.Fatalf("native receipt bypassed owner validation: %s", entry)
		}
	}
}

func TestCreationDirectContextReceiptRequiresNativeImport(t *testing.T) {
	s, _, _ := agentMediaFixture(t)
	req := creationRequestWithDirectContext(t, `[{"messageId":"not-yet-imported","role":"user","mode":"image","content":"约定"}]`)
	run, err := s.CreateCloudAgentRun("user", req, "")
	if err != nil {
		t.Fatal(err)
	}
	if len(run.CreationContextMessageIDs) != 0 {
		t.Fatal("request acceptance was mistaken for native import")
	}
}

func TestCreationDirectContextTaskDeltaClearsObsoleteFailureFacts(t *testing.T) {
	prior := map[string]any{"taskId": "task", "status": "failed", "error": "old failure", "prompt": "unchanged"}
	current := map[string]any{"taskId": "task", "status": "running", "prompt": "unchanged"}
	delta := cloudAgentCreationContextDelta(current, prior)
	if value, ok := delta["error"]; !ok || value != nil {
		t.Fatal("latest task update left the old failure fact in native context")
	}
	if _, ok := delta["prompt"]; ok {
		t.Fatal("immutable prompt was duplicated")
	}
}
