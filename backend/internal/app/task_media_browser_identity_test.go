package app

import (
	"bytes"
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"strings"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// 可选的 Node runner 只替换浏览器 API/存储边界；任务完成和素材落库使用真实实现。
func TestGeneratedAssetBrowserIdentity(t *testing.T) {
	runner := os.Getenv("CANVAS_TEST_GENERATION_BROWSER_RUNNER")
	if runner == "" {
		t.Skip("设置 CANVAS_TEST_GENERATION_BROWSER_RUNNER 运行跨端行为测试")
	}
	for _, scenario := range []string{"open", "reopen", "reopen-synced", "agent-live", "agent-reopen", "agent-reopen-edited", "agent-without-id", "reopen-edited", "remote-absent", "remote-unavailable", "edit-before-get", "edit-disjoint", "edit-conflict", "edit-during-get", "edit-category", "edit-source", "edit-display-url", "edit-metadata", "edit-video", "edit-audio", "edit-resource-conflict"} {
		t.Run(scenario, func(t *testing.T) {
			s, db := newMediaRecoveryTestService(t)
			task := seedMediaTask(t, db, providerConfig{})
			mode, mimeType := "image", "image/png"
			if scenario == "edit-video" || scenario == "edit-audio" {
				mode = strings.TrimPrefix(scenario, "edit-")
				mimeType = map[string]string{"video": "video/mp4", "audio": "audio/mpeg"}[mode]
				input, _ := json.Marshal(canvasGenerationInput{Mode: mode, Prompt: "test"})
				task.Type, task.InputJSON = "canvas_"+mode, string(input)
				if err := db.Save(task).Error; err != nil {
					t.Fatal(err)
				}
			}
			// 模拟存储已完成，保留真实 worker 的 checkpoint 恢复与完成登记。
			resource := model.Resource{ID: newID(), UserID: task.UserID, Kind: mode, Status: model.ResourceStatusReady, Provider: "local", ObjectKey: "generated", MimeType: mimeType, Size: 80, Width: 2, Height: 3, UploadKey: mediaUploadKey(task.ID, 0)}
			if err := db.Create(&resource).Error; err != nil {
				t.Fatal(err)
			}
			checkpoint := &mediaCheckpoint{Mode: mode, StartedAt: time.Now(), Items: []mediaCheckpointItem{{ResourceID: resource.ID, MIMEType: mimeType}}}
			if err := s.saveMediaCheckpoint(task, checkpoint, "register"); err != nil {
				t.Fatal(err)
			}
			// 从持久 checkpoint 走 worker 的真实恢复与完成交易，不调用模型服务。
			if err := s.taskWorker().processClaimedTask(task, nil); err != nil {
				t.Fatal(err)
			}
			completed, err := s.repo.Task(task.ID)
			if err != nil || completed.Status != model.TaskStatusSucceeded {
				t.Fatalf("completion: %+v, %v", completed, err)
			}
			assets, err := s.repo.Assets(task.UserID)
			if err != nil || len(assets) != 1 {
				t.Fatalf("backend assets: %d, %v", len(assets), err)
			}
			var project json.RawMessage
			if strings.HasPrefix(scenario, "agent-") {
				// 使用真实 Agent 完成写回；成功节点不经过前端 recovery materializer。
				doc := map[string]any{"id": "image-canvas", "title": "画布", "revision": 1, "createdAt": time.Now(), "updatedAt": time.Now(), "nodes": []any{map[string]any{"id": "image-node", "type": "image", "title": "图片", "position": map[string]int{"x": 0, "y": 0}, "width": 320, "height": 240, "metadata": map[string]any{"taskId": task.ID, "status": "loading"}}}, "connections": []any{}, "chatSessions": []any{}, "activeChatId": nil, "viewport": map[string]int{"x": 0, "y": 0, "k": 1}, "directorScenes": []any{}}
				raw, _ := json.Marshal(doc)
				canvas := model.CanvasProject{ID: "image-canvas", UserID: task.UserID, Title: "画布", PayloadJSON: string(raw)}
				if err := s.repo.UpsertCanvasProject(&canvas); err != nil {
					t.Fatal(err)
				}
				policy, err := s.RuntimePolicy()
				if err != nil {
					t.Fatal(err)
				}
				if _, err := completeCloudAgentMediaNode(s.repo, task.UserID, canvas.ID, "image-node", completed, policy); err != nil {
					t.Fatal(err)
				}
				written, err := s.repo.CanvasProjectForUser(task.UserID, canvas.ID)
				if err != nil {
					t.Fatal(err)
				}
				project = json.RawMessage(written.PayloadJSON)
				writtenDoc, err := creationDocument(written.PayloadJSON)
				if err != nil {
					t.Fatal(err)
				}
				meta := creationMaps(writtenDoc["nodes"])[0]["metadata"].(map[string]any)
				if meta["status"] != "success" || meta["assetId"] != assets[0].ID {
					t.Errorf("Agent writeback identity: %v; registered=%s", meta, assets[0].ID)
				}
			}
			if scenario == "reopen-edited" || scenario == "agent-reopen-edited" {
				var payload map[string]any
				if err := json.Unmarshal([]byte(assets[0].PayloadJSON), &payload); err != nil {
					t.Fatal(err)
				}
				payload["title"], payload["tags"] = "用户自定义标题", []string{"精选", "已审阅"}
				raw, _ := json.Marshal(payload)
				assets[0].Title, assets[0].PayloadJSON = "用户自定义标题", string(raw)
				if err := s.repo.UpsertAsset(&assets[0]); err != nil {
					t.Fatal(err)
				}
			}
			if scenario == "edit-before-get" || scenario == "edit-category" || scenario == "edit-metadata" {
				// 模拟已存储的远端上下文；保留真实完成交易的标题、分类和来源。
				var payload map[string]any
				if err := json.Unmarshal([]byte(assets[0].PayloadJSON), &payload); err != nil {
					t.Fatal(err)
				}
				metadata := payload["metadata"].(map[string]any)
				metadata["messageId"], metadata["batchIndex"] = "remote-message", 7
				metadata["clientContext"] = map[string]any{"messageId": "remote-context-message", "remoteOnly": true}
				raw, _ := json.Marshal(payload)
				assets[0].PayloadJSON = string(raw)
				if err := s.repo.UpsertAsset(&assets[0]); err != nil {
					t.Fatal(err)
				}
			}
			devices := 1
			if scenario == "agent-reopen" || scenario == "agent-reopen-edited" {
				devices = 2
			}
			for device := 1; device <= devices; device++ {
				remote, err := s.repo.Assets(task.UserID)
				if err != nil {
					t.Fatal(err)
				}
				remotePayloads := make([]json.RawMessage, 0, len(remote))
				for _, asset := range remote {
					remotePayloads = append(remotePayloads, json.RawMessage(asset.PayloadJSON))
				}
				input, err := json.Marshal(map[string]any{"scenario": scenario, "task": taskForOutput(*completed), "asset": json.RawMessage(assets[0].PayloadJSON), "project": project, "remoteAssets": remotePayloads})
				if err != nil {
					t.Fatal(err)
				}
				ctx, cancel := context.WithTimeout(context.Background(), 45*time.Second)
				defer cancel()
				cmd := exec.CommandContext(ctx, "node", runner)
				cmd.Stdin = bytes.NewReader(input)
				var stderr bytes.Buffer
				cmd.Stderr = &stderr
				output, err := cmd.Output()
				if err != nil {
					t.Fatalf("browser: %v\n%s\n%s", err, stderr.String(), output)
				}
				var browser struct {
					Assets        []json.RawMessage `json:"assets"`
					NodeAssetID   string            `json:"nodeAssetId"`
					RepairCreated int               `json:"repairCreated"`
					LocalAsset    struct {
						Title string   `json:"title"`
						Tags  []string `json:"tags"`
					} `json:"localAsset"`
				}
				if err := json.Unmarshal(output, &browser); err != nil {
					t.Fatalf("browser output: %v: %s", err, output)
				}
				wantWrites := 0
				if scenario == "remote-absent" || (strings.HasPrefix(scenario, "edit-") && !strings.HasSuffix(scenario, "conflict")) {
					wantWrites = 1
				}
				if len(browser.Assets) != wantWrites {
					t.Fatalf("browser PUT count: got %d, want %d", len(browser.Assets), wantWrites)
				}
				// 将浏览器实际生成的记录送到 PUT 所用的 repository，不在测试中重新推导 ID。
				for _, payload := range browser.Assets {
					var asset model.Asset
					if err := json.Unmarshal(payload, &asset); err != nil {
						t.Fatal(err)
					}
					asset.UserID, asset.PayloadJSON = task.UserID, string(payload)
					if err := s.repo.UpsertAsset(&asset); err != nil {
						t.Fatal(err)
					}
				}
				final, err := s.repo.Assets(task.UserID)
				if err != nil || len(final) != 1 || browser.NodeAssetID != assets[0].ID || browser.RepairCreated != 0 {
					t.Errorf("device=%d backend=%s browser=%s repair=%d final=%d err=%v", device, assets[0].ID, browser.NodeAssetID, browser.RepairCreated, len(final), err)
				}
				if len(browser.Assets) == 1 && len(final) == 1 && final[0].PayloadJSON != string(browser.Assets[0]) {
					t.Error("stored DB payload must preserve the complete browser PUT including metadata")
				}
				if (scenario == "reopen-edited" || scenario == "agent-reopen-edited") && (final[0].Title != "用户自定义标题" || browser.LocalAsset.Title != "用户自定义标题" || len(browser.LocalAsset.Tags) != 2 || browser.LocalAsset.Tags[0] != "精选") {
					t.Errorf("remote edit overwritten: DB title=%s local=%+v", final[0].Title, browser.LocalAsset)
				}
				t.Logf("device=%d backend=1 browser=%d final=%d repairCreated=%d sameID=%s", device, len(browser.Assets), len(final), browser.RepairCreated, browser.NodeAssetID)
			}
		})
	}
}
