package app

import (
	"encoding/json"
	"fmt"
	"net/url"
	"os"
	"testing"
	"time"

	"gorm.io/driver/postgres"
	"gorm.io/gorm"
	"gorm.io/gorm/logger"
	"yingce/backend/internal/database"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

// TestCloudAgentVideoFramesPostgres 验证 Agent 的帧选择进入任务输入、协议角色和持久化草稿。
// 测试使用独立 schema，结束后删除测试表；不调用外部模型、不提交收费任务。
func TestCloudAgentVideoFramesPostgres(t *testing.T) {
	dsn := os.Getenv("CANVAS_TEST_POSTGRES_DSN")
	if dsn == "" {
		t.Skip("CANVAS_TEST_POSTGRES_DSN is not configured")
	}
	options := &gorm.Config{Logger: logger.Default.LogMode(logger.Silent)}
	admin, err := gorm.Open(postgres.Open(dsn), options)
	if err != nil {
		t.Fatal(err)
	}
	adminSQL, err := admin.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = adminSQL.Close() })
	schema := fmt.Sprintf("agent_video_frames_%d", time.Now().UnixNano())
	if err := admin.Exec("CREATE SCHEMA " + schema).Error; err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() {
		if err := admin.Exec("DROP SCHEMA " + schema + " CASCADE").Error; err != nil {
			t.Error(err)
		}
	})
	parsed, err := url.Parse(dsn)
	if err != nil {
		t.Fatal(err)
	}
	query := parsed.Query()
	query.Set("search_path", schema)
	parsed.RawQuery = query.Encode()
	db, err := gorm.Open(postgres.Open(parsed.String()), options)
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(database.Models()...); err != nil {
		t.Fatal(err)
	}
	s := &Service{repo: repository.New(db), dataDir: t.TempDir()}
	doc := map[string]any{"nodes": []map[string]any{
		{"id": "first", "type": "image", "metadata": map[string]any{"storageKey": "resource:first", "status": "success"}},
		{"id": "last", "type": "image", "metadata": map[string]any{"storageKey": "resource:last", "status": "success"}},
	}, "connections": []any{}}
	raw, err := json.Marshal(doc)
	if err != nil {
		t.Fatal(err)
	}
	for _, row := range []any{
		&model.CanvasProject{ID: "canvas", UserID: "user", PayloadJSON: string(raw)},
		&model.Resource{ID: "first", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png"},
		&model.Resource{ID: "last", UserID: "user", Kind: "image", Status: "ready", MimeType: "image/png"},
	} {
		if err := db.Create(row).Error; err != nil {
			t.Fatal(err)
		}
	}
	// 故意把尾帧放在参考数组前面，帧角色必须来自明确字段，而不是数组顺序。
	a := cloudAgentMediaArgs{Mode: "video", Prompt: "猫咪做饭", ChannelID: "channel", ChannelModelKey: "video", NodeID: "target", Title: "镜头视频", ReferenceNodeIDs: []string{"last", "first"}, VideoStartFrameNodeID: "first", VideoEndFrameNodeID: "last"}
	state := &cloudAgentRuntime{Request: CloudAgentRequest{CanvasID: "canvas"}}
	req, plan, err := s.prepareCloudAgentMedia(&model.CloudAgentExecution{ID: "run", UserID: "user"}, state, agentMediaCall(a))
	if err != nil {
		t.Fatal(err)
	}
	encoded, err := json.Marshal(req.Input)
	if err != nil {
		t.Fatal(err)
	}
	var input canvasGenerationInput
	if err := json.Unmarshal(encoded, &input); err != nil {
		t.Fatal(err)
	}
	if input.Metadata["videoStartFrameNodeId"] != "first" || input.Metadata["videoEndFrameNodeId"] != "last" {
		t.Fatalf("任务输入丢失帧选择：%v", input.Metadata)
	}
	for i := range input.ReferenceImages {
		input.ReferenceImages[i].DataURL = "data:image/png;base64,aGVsbG8="
	}
	references := protocolVideoImageReferences(input)
	if len(references) != 2 || references[0].ID != "last" || references[0].Role != "last_frame" || references[1].ID != "first" || references[1].Role != "first_frame" {
		t.Fatalf("协议收到错误的首尾帧：%+v", references)
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		t.Fatal(err)
	}
	if err := createCloudAgentMediaNode(s.repo, "user", "canvas", plan, nil, policy); err != nil {
		t.Fatal(err)
	}
	canvas, err := s.repo.CanvasProjectForUser("user", "canvas")
	if err != nil {
		t.Fatal(err)
	}
	saved, err := creationDocument(canvas.PayloadJSON)
	if err != nil {
		t.Fatal(err)
	}
	node := cloudAgentNodeByID(creationMaps(saved["nodes"]), "target")
	if node == nil {
		t.Fatal("草稿节点未保存")
	}
	metadata := node["metadata"].(map[string]any)
	if metadata["videoStartFrameNodeId"] != "first" || metadata["videoEndFrameNodeId"] != "last" || len(creationMaps(saved["connections"])) != 2 {
		t.Fatalf("草稿未保存帧选择和引用连线：%v", saved)
	}
}
