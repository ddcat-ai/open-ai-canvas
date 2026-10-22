package app

import (
	"context"
	"fmt"
	"path/filepath"
	"testing"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
)

// newThumbnailBackfillTestService 构造只迁移 resources 表的 sqlite 服务，
// 用于验证回填的候选筛选、游标分批与并发处理（不涉及真实对象存储）。
// 用临时文件库而不是内存库：回填是并发写库，内存 shared-cache 库是表级锁
// （SQLITE_LOCKED，busy_timeout 不生效），与生产 DSN（WAL + busy_timeout）行为不同。
func newThumbnailBackfillTestService(t *testing.T) (*Service, *gorm.DB) {
	t.Helper()
	dsn := filepath.Join(t.TempDir(), "backfill.db") + "?_busy_timeout=5000&_journal_mode=WAL&_foreign_keys=on&_synchronous=NORMAL"
	db, err := gorm.Open(sqlite.Open(dsn), &gorm.Config{})
	if err != nil {
		t.Fatal(err)
	}
	sqlDB, err := db.DB()
	if err != nil {
		t.Fatal(err)
	}
	// 关闭连接池，否则 Windows 下 TempDir 清理会因文件仍被占用而失败。
	t.Cleanup(func() { _ = sqlDB.Close() })
	if err := db.AutoMigrate(&model.Resource{}); err != nil {
		t.Fatal(err)
	}
	return &Service{repo: repository.New(db)}, db
}

func seedThumbnailBackfillResource(t *testing.T, db *gorm.DB, resource model.Resource) {
	t.Helper()
	if resource.Status == "" {
		resource.Status = model.ResourceStatusReady
	}
	if resource.Kind == "" {
		resource.Kind = "image"
	}
	if resource.Provider == "" {
		resource.Provider = "s3"
	}
	if resource.MimeType == "" {
		resource.MimeType = "image/png"
	}
	if err := db.Create(&resource).Error; err != nil {
		t.Fatal(err)
	}
}

// TestBackfillCandidatesFilter 覆盖候选筛选：只有「已就绪 + image + 非本地 +
// 缩略图状态为空/none/failed」的资源才会被捞出来。
func TestBackfillCandidatesFilter(t *testing.T) {
	_, db := newThumbnailBackfillTestService(t)
	now := time.Now()

	seedThumbnailBackfillResource(t, db, model.Resource{ID: "empty-status", UserID: "u1", CreatedAt: now})
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "none-status", UserID: "u1", CreatedAt: now.Add(time.Second), ThumbnailStatus: model.ThumbnailStatusNone})
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "failed-status", UserID: "u1", CreatedAt: now.Add(2 * time.Second), ThumbnailStatus: model.ThumbnailStatusFailed})
	// 以下行都不应入选。
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "ready-status", UserID: "u1", CreatedAt: now.Add(3 * time.Second), ThumbnailStatus: model.ThumbnailStatusReady})
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "processing-status", UserID: "u1", CreatedAt: now.Add(4 * time.Second), ThumbnailStatus: model.ThumbnailStatusProcessing})
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "local-provider", UserID: "u1", CreatedAt: now.Add(5 * time.Second), Provider: "local"})
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "not-image", UserID: "u1", CreatedAt: now.Add(6 * time.Second), Kind: "video"})
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "pending", UserID: "u1", CreatedAt: now.Add(7 * time.Second), Status: model.ResourceStatusPending})

	repo := repository.New(db)
	candidates, err := repo.ThumbnailBackfillCandidates(time.Time{}, "", 50)
	if err != nil {
		t.Fatal(err)
	}
	got := make(map[string]bool, len(candidates))
	for _, candidate := range candidates {
		got[candidate.ID] = true
	}
	for _, want := range []string{"empty-status", "none-status", "failed-status"} {
		if !got[want] {
			t.Errorf("候选缺少 %s", want)
		}
	}
	if len(candidates) != 3 {
		t.Fatalf("候选数量 = %d，期望 3，实际 %v", len(candidates), got)
	}
}

// TestBackfillCandidatesCursorPaginates 覆盖游标分页：按 (created_at, id) 递增读取，
// 不重复、不遗漏，且同一 created_at 的多行也能正确翻页。
func TestBackfillCandidatesCursorPaginates(t *testing.T) {
	_, db := newThumbnailBackfillTestService(t)
	now := time.Now()
	const total = 7
	for index := 0; index < total; index++ {
		// 故意让三行共享同一 created_at，验证 id 作为次级游标。
		createdAt := now.Add(time.Duration(index/3) * time.Second)
		seedThumbnailBackfillResource(t, db, model.Resource{
			ID:        fmt.Sprintf("r-%d", index),
			UserID:    "u1",
			CreatedAt: createdAt,
		})
	}

	repo := repository.New(db)
	seen := make(map[string]int, total)
	var cursorTime time.Time
	var cursorID string
	for round := 0; round < 10; round++ {
		batch, err := repo.ThumbnailBackfillCandidates(cursorTime, cursorID, 3)
		if err != nil {
			t.Fatal(err)
		}
		if len(batch) == 0 {
			break
		}
		for _, resource := range batch {
			seen[resource.ID]++
		}
		last := batch[len(batch)-1]
		cursorTime, cursorID = last.CreatedAt, last.ID
	}
	if len(seen) != total {
		t.Fatalf("游标分页读到 %d 条，期望 %d：%v", len(seen), total, seen)
	}
	for id, count := range seen {
		if count != 1 {
			t.Errorf("%s 被重复读取 %d 次", id, count)
		}
	}
}

// TestBackfillResourceThumbnailsNoCandidates 覆盖空库/无候选场景：应立即返回，
// 不 panic、不阻塞（真实网络路径不会被触发）。
func TestBackfillResourceThumbnailsNoCandidates(t *testing.T) {
	service, _ := newThumbnailBackfillTestService(t)
	done := make(chan struct{})
	go func() {
		defer close(done)
		service.BackfillResourceThumbnails(context.Background())
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("无候选时回填未及时返回")
	}
}

// TestBackfillResourceThumbnailsStopsOnCancel 覆盖 context 取消：已取消的 ctx
// 不应再开始处理新资源，应立即返回。
func TestBackfillResourceThumbnailsStopsOnCancel(t *testing.T) {
	service, db := newThumbnailBackfillTestService(t)
	// 故意放入候选行：若取消未被尊重，就会尝试访问对象存储并卡住/报错。
	seedThumbnailBackfillResource(t, db, model.Resource{ID: "r1", UserID: "u1", CreatedAt: time.Now()})

	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	done := make(chan struct{})
	go func() {
		defer close(done)
		service.BackfillResourceThumbnails(ctx)
	}()
	select {
	case <-done:
	case <-time.After(5 * time.Second):
		t.Fatal("ctx 已取消但回填未及时返回")
	}

	// 取消后该行不应被标记任何终态（未被处理）。
	var resource model.Resource
	if err := db.First(&resource, "id = ?", "r1").Error; err != nil {
		t.Fatal(err)
	}
	if resource.ThumbnailStatus != "" {
		t.Fatalf("取消后资源被处理，thumbnail_status = %q", resource.ThumbnailStatus)
	}
}

// TestBackfillBatchCountsFailuresWithoutAborting 覆盖单条失败不中断：
// 测试库没有对象存储配置表，解析存储设置必失败，因此每个资源都会落到 failed。
// 断言整批仍被完整处理、计数准确、失败状态已落库。
func TestBackfillBatchCountsFailuresWithoutAborting(t *testing.T) {
	service, db := newThumbnailBackfillTestService(t)
	const total = 5
	batch := make([]model.Resource, 0, total)
	now := time.Now()
	for index := 0; index < total; index++ {
		resource := model.Resource{
			ID: fmt.Sprintf("r-%d", index), UserID: "u1", Kind: "image",
			Status: model.ResourceStatusReady, Provider: "s3",
			MimeType: "image/png", CreatedAt: now.Add(time.Duration(index) * time.Second),
		}
		seedThumbnailBackfillResource(t, db, resource)
		batch = append(batch, resource)
	}

	counts := service.processThumbnailBackfillBatch(context.Background(), batch)
	if counts.total() != total {
		t.Fatalf("处理条数 = %d，期望 %d（单条失败不应中断整批）", counts.total(), total)
	}
	if counts.failed != total {
		t.Fatalf("失败计数 = %d，期望 %d", counts.failed, total)
	}
	var failedRows int64
	if err := db.Model(&model.Resource{}).Where("thumbnail_status = ?", model.ThumbnailStatusFailed).Count(&failedRows).Error; err != nil {
		t.Fatal(err)
	}
	if failedRows != total {
		t.Fatalf("落库 failed 行数 = %d，期望 %d", failedRows, total)
	}
}

// TestBackfillBatchEmpty 覆盖空批次直接返回。
func TestBackfillBatchEmpty(t *testing.T) {
	service, _ := newThumbnailBackfillTestService(t)
	counts := service.processThumbnailBackfillBatch(context.Background(), nil)
	if counts.total() != 0 {
		t.Fatalf("空批次计数 = %d，期望 0", counts.total())
	}
}

// TestBackfillResourceThumbnailsNilSafe 覆盖零值服务/空 ctx 的防御分支。
func TestBackfillResourceThumbnailsNilSafe(t *testing.T) {
	var service *Service
	service.BackfillResourceThumbnails(context.Background())

	empty := &Service{}
	empty.BackfillResourceThumbnails(context.Background())
}
