package app

import (
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"os/exec"
	"sync"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// The upstream is deliberately held open. A final-only implementation cannot
// satisfy this test by replaying the full answer as a fabricated text delta.
func TestCreationNativePiStreamsBeforeUpstreamCompletes(t *testing.T) {
	if _, err := exec.LookPath("node"); err != nil {
		t.Skip("node is not installed")
	}
	if _, err := agentRuntimeDirForTest(); err != nil {
		t.Skip(err.Error())
	}
	t.Setenv("CANVAS_ALLOWED_PRIVATE_UPSTREAM_HOSTS", "127.0.0.1")
	t.Setenv("REDIS_URL", "")
	release := make(chan struct{})
	var releaseOnce sync.Once
	finishUpstream := func() { releaseOnce.Do(func() { close(release) }) }
	server := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		var body map[string]any
		if err := json.NewDecoder(r.Body).Decode(&body); err != nil {
			t.Error(err)
			return
		}
		if body["stream"] != true {
			t.Error("model request did not enable real upstream streaming")
		}
		w.Header().Set("Content-Type", "text/event-stream")
		raw, _ := json.Marshal(sseDelta(map[string]any{"content": "正在规划"}))
		_, _ = fmt.Fprintf(w, "data: %s\n\n", raw)
		w.(http.Flusher).Flush()
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		writeSSE(w, sseDelta(map[string]any{"content": "五张商品图。"}))
	}))
	t.Cleanup(server.Close)
	t.Cleanup(finishUpstream)
	s, db, _, _ := creationTestService(t)
	s = New(s.repo, s.dataDir)
	t.Cleanup(func() { _ = s.Close() })
	if err := db.Model(&model.ModelChannel{}).Where("id = ?", "channel").Updates(map[string]any{"base_url": server.URL, "api_key": "test-only"}).Error; err != nil {
		t.Fatal(err)
	}
	stop := make(chan struct{})
	t.Cleanup(func() { close(stop); finishUpstream() })
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
	run, err := s.CreateCloudAgentRun("user", creationAgentRequest(), "")
	if err != nil {
		t.Fatal(err)
	}
	var streamed bool
	deadline := time.Now().Add(12 * time.Second)
	for time.Now().Before(deadline) {
		current, err := s.CloudAgentRun("user", run.ID)
		if err != nil {
			t.Fatal(err)
		}
		for _, event := range current.Events {
			if event.Type == "assistant_delta" && event.Payload["text"] == "正在规划" {
				streamed = true
			}
			if event.Type == "assistant_message" {
				t.Fatal("final answer appeared before upstream was released")
			}
		}
		if streamed {
			break
		}
		if cloudAgentRunTerminal(current.Status) {
			t.Fatalf("run terminated before first delta: %+v", current)
		}
		time.Sleep(25 * time.Millisecond)
	}
	if !streamed {
		t.Fatal("no real text delta was published while upstream was still streaming")
	}
	finishUpstream()
	finished := waitLiveAgentTerminal(t, s, run.ID)
	if finished.Status != "completed" {
		t.Fatalf("run failed: %s", finished.FailureMessage)
	}
	current, err := s.CloudAgentRun("user", run.ID)
	if err != nil {
		t.Fatal(err)
	}
	finals := 0
	for _, event := range current.Events {
		if event.Type == "assistant_message" {
			finals++
			if event.Payload["text"] != "正在规划五张商品图。" {
				t.Fatalf("final text lost or duplicated chunks: %+v", event)
			}
		}
	}
	if finals != 1 {
		t.Fatalf("one model response emitted %d final messages", finals)
	}
}
