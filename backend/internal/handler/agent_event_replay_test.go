package handler

import (
	"context"
	"crypto/sha256"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strconv"
	"strings"
	"testing"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
	"yingce/backend/internal/service"
)

type replayRecorder struct {
	*httptest.ResponseRecorder
	onFrame func(string)
	offset  int
}

func (r *replayRecorder) Flush() {
	r.ResponseRecorder.Flush()
	frame := string(r.Body.Bytes()[r.offset:])
	r.offset = r.Body.Len()
	if r.onFrame != nil {
		r.onFrame(frame)
	}
}

func TestAgentEventReplay(t *testing.T) {
	for _, mode := range []string{"hot", "archived", "compact-between-pages", "archive-unreadable", "archive-missing", "page-read-error", "second-page-error", "live-from-zero", "initial-tail", "resume-zero", "cleanup-pending", "archived-legacy-prefix", "journal-hole"} {
		t.Run(mode, func(t *testing.T) {
			router, db, _ := skillAuthorizationFixture(t)
			if err := database.MigrateSchema(db); err != nil {
				t.Fatal(err)
			}
			must := func(err error) {
				t.Helper()
				if err != nil {
					t.Fatal(err)
				}
			}
			user := "skill-member"
			key := "event-replay"
			id := fmt.Sprintf("ag%x", sha256.Sum256([]byte(user+"\x00"+key)))[:34]
			const total = 1003
			input := fmt.Sprintf(`{"cloudAgent":{"version":1,"request":{"idempotencyKey":%q}}}`, key)
			task := model.Task{ID: id, UserID: user, Operation: "cloud_agent", Status: model.TaskStatusRunning, InputJSON: input}
			run := model.CloudAgentExecution{ID: id, UserID: user, Status: "completed", Revision: 1, CheckpointVersion: 2, EventCount: total, StateJSON: "{}"}
			hash := fmt.Sprintf("%x", sha256.Sum256(nil))
			run.StateJSON = fmt.Sprintf(`{"request":{"prompt":"test","idempotencyKey":%q,"permissionMode":"read_only","logicalModelId":"model","budget":{"maxCredits":1}},
					"policy":{"compilerVersion":"frozen","systemPolicyId":"system","systemPolicyVersion":1,"mediaPolicyId":"media","mediaPolicyVersion":1,"capabilitySetVersion":"frozen","reasoningMode":"auto","profileRevision":"%[2]s","profileHash":"%[2]s","systemPolicyHash":"%[2]s","mediaPolicyHash":"%[2]s","capabilitySetHash":"%[2]s"},
					"profile":{"revision":"%[2]s","hash":"%[2]s"},"taskIds":[%[3]q],"decisions":{},"events":[]}`, key, hash, id)
			event := func(i int) string {
				return fmt.Sprintf(`{"runId":%q,"eventId":"%s:%d","seq":%d,"type":"text","payload":{},"createdAt":"2026-01-01T00:00:00Z"}`, id, id, i, i)
			}
			addRows := func(tx *gorm.DB) error {
				rows := make([]model.CloudAgentEventRecord, 0, total)
				for seq := 1; seq <= total; seq++ {
					if mode == "journal-hole" && seq == 6 {
						continue
					}
					rows = append(rows, model.CloudAgentEventRecord{RunID: id, UserID: user, Sequence: seq, EventJSON: event(seq)})
				}
				return tx.CreateInBatches(rows, 100).Error
			}
			cursor := 1
			if mode == "live-from-zero" || mode == "compact-between-pages" {
				run.Status = "running"
			}
			switch mode {
			case "live-from-zero":
				cursor, run.EventCount = 0, 0
			case "archived-legacy-prefix":
				run.CheckpointVersion, run.EventCount = 1, 4
				run.StateJSON = `{"events":[` + event(3) + "," + event(4) + "]}"
			default:
				must(addRows(db))
			}
			if mode == "initial-tail" || mode == "resume-zero" {
				cursor = 0
			}
			end := total
			if mode == "cleanup-pending" {
				run.CleanupPending, cursor, end = true, total-1, total+1
			}
			must(db.Create(&task).Error)
			must(db.Create(&run).Error)
			compact := func() {
				_, err := repository.New(db).CompactCloudAgentRun(user, id)
				must(err)
				var cold, hot int64
				must(db.Model(&model.CloudAgentHistoryArchive{}).Where("run_id = ?", id).Count(&cold).Error)
				must(db.Model(&model.CloudAgentEventRecord{}).Where("run_id = ?", id).Count(&hot).Error)
				if cold != 1 || hot != 0 {
					t.Fatalf("after compaction: archives=%d hot=%d", cold, hot)
				}
			}
			switch mode {
			case "archived", "archive-unreadable", "archive-missing", "archived-legacy-prefix":
				compact()
				if mode == "archive-unreadable" {
					must(db.Model(&model.CloudAgentHistoryArchive{}).Where("run_id = ?", id).Update("PayloadGZIP", []byte("broken")).Error)
				}
				if mode == "archive-missing" {
					must(db.Where("run_id = ?", id).Delete(&model.CloudAgentHistoryArchive{}).Error)
				}
			case "page-read-error", "second-page-error":
				pages := 0
				must(db.Callback().Query().After("gorm:query").Register("replay:page-error", func(tx *gorm.DB) {
					if strings.Contains(tx.Statement.SQL.String(), "sequence >") {
						pages++
						if mode == "page-read-error" || pages == 2 {
							tx.AddError(fmt.Errorf("read failed"))
						}
					}
				}))
			}
			path := "/api/agent/runs/" + id + "/events?after=" + strconv.Itoa(cursor)
			if cross := skillAuthorizationRequest(router, "GET", path, "skill-admin", nil); cross.Code != 404 {
				t.Fatalf("cross-account status %d", cross.Code)
			}
			ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
			defer cancel()
			req := httptest.NewRequestWithContext(ctx, "GET", path, nil)
			if mode == "resume-zero" {
				req.Header.Set("Last-Event-ID", "0")
			}
			req.AddCookie(&http.Cookie{Name: service.SessionCookieName, Value: user + ".skill-access-token"})
			rec := &replayRecorder{ResponseRecorder: httptest.NewRecorder()}
			rec.onFrame = func(frame string) {
				switch {
				case mode == "cleanup-pending" && strings.HasPrefix(frame, fmt.Sprintf("id: %d\n", total)):
					rec.onFrame = nil
					pending := true
					must(db.Callback().Query().After("gorm:query").Register("replay:cleanup", func(tx *gorm.DB) {
						if !pending || len(tx.Statement.Selects) != 2 || tx.Statement.Selects[1] != "revision" {
							return
						}
						pending = false
						must(db.Transaction(func(write *gorm.DB) error {
							if err := write.Create(&model.CloudAgentEventRecord{RunID: id, UserID: user, Sequence: end, EventJSON: event(end)}).Error; err != nil {
								return err
							}
							return write.Model(&run).Updates(map[string]any{"cleanup_pending": false, "revision": 2, "event_count": end}).Error
						}))
					}))
				case mode == "live-from-zero" && strings.Contains(frame, "event: run_snapshot"):
					rec.onFrame = nil
					must(db.Transaction(func(tx *gorm.DB) error {
						if err := addRows(tx); err != nil {
							return err
						}
						return tx.Model(&run).Updates(map[string]any{"status": "completed", "revision": 2, "event_count": total}).Error
					}))
				case mode == "compact-between-pages" && strings.HasPrefix(frame, "id: 501\n"):
					rec.onFrame = nil
					must(db.Model(&run).Updates(map[string]any{"status": "completed", "revision": 2}).Error)
					compact()
				}
			}
			router.ServeHTTP(rec, req)
			body := rec.Body.String()
			switch mode {
			case "second-page-error":
				if rec.Code != 200 || strings.Contains(body, "run_snapshot") || !strings.Contains(body, "Agent 状态读取失败") || strings.Count(body, "event: agent_event") != 500 {
					t.Fatal("stream did not stop at the first unread page")
				}
				resumed := skillAuthorizationRequest(router, "GET", "/api/agent/runs/"+id+"/events?after=501", user, nil)
				body += resumed.Body.String()
			case "archive-unreadable", "archive-missing", "page-read-error", "journal-hole":
				if rec.Code < 500 || strings.Contains(body, "run_snapshot") {
					t.Fatalf("failed read: status %d, events %d", rec.Code, strings.Count(body, "agent_event"))
				}
				return
			case "archived-legacy-prefix":
				if rec.Code != 410 || !strings.Contains(body, `"earliestSeq":3`) {
					t.Fatalf("legacy prefix: status %d", rec.Code)
				}
				resp := skillAuthorizationRequest(router, "GET", "/api/agent/runs/"+id+"/events?after=2", user, nil)
				if resp.Code != 200 || strings.Count(resp.Body.String(), "event: agent_event") != 2 {
					t.Fatalf("retained suffix: status %d", resp.Code)
				}
				return
			}
			next := cursor + 1
			if mode == "initial-tail" {
				next = total - repository.CloudAgentJournalWindow + 1
			}
			pendingSnapshots, finalSnapshots := 0, 0
			for _, line := range strings.Split(body, "\n") {
				if strings.HasPrefix(line, "id: ") {
					if line != fmt.Sprintf("id: %d", next) {
						t.Fatalf("after %d received %s", next-1, line)
					}
					next++
				}
				if strings.HasPrefix(line, "data: ") && strings.Contains(line, `"status":"completed"`) {
					if strings.Contains(line, `"cleanupPending":true`) {
						pendingSnapshots++
						if mode != "cleanup-pending" || next != total+1 {
							t.Fatalf("cleanup snapshot after event %d, expected %d", next-1, total)
						}
					} else {
						finalSnapshots++
						if next != end+1 {
							t.Fatalf("final snapshot after event %d of %d", next-1, end)
						}
					}
				}
			}
			if finalSnapshots != 1 || (mode == "cleanup-pending" && pendingSnapshots != 1) {
				t.Fatalf("snapshots: cleanup=%d final=%d", pendingSnapshots, finalSnapshots)
			}
			if rec.Code != 200 || next != end+1 || !strings.Contains(body, `"status":"completed"`) || ctx.Err() != nil {
				t.Fatalf("status %d, received through %d", rec.Code, next-1)
			}
		})
	}
}
