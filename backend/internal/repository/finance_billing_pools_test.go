package repository

import (
	"errors"
	"strings"
	"testing"
	"time"

	"gorm.io/driver/sqlite"
	"gorm.io/gorm"
	_ "modernc.org/sqlite"
	"yingce/backend/internal/model"
)

func setupBillingPoolTestRepo(t *testing.T) *Repository {
	t.Helper()
	db, err := gorm.Open(sqlite.New(sqlite.Config{DriverName: "sqlite", DSN: "file:" + newRepositoryID() + "?mode=memory&cache=shared"}), &gorm.Config{})
	if err != nil {
		t.Fatalf("gorm.Open() error = %v", err)
	}
	if err := db.AutoMigrate(
		&model.User{},
		&model.CreditAccount{},
		&model.CreditLedgerEntry{},
		&model.BillingOrder{},
		&model.Task{},
		&model.ApiCallLog{},
		&model.RedeemBatch{},
		&model.RedeemCode{},
	); err != nil {
		t.Fatalf("AutoMigrate() error = %v", err)
	}
	return New(db)
}

func seedRedeemCodeWithCapability(t *testing.T, repo *Repository, batchID, codeID, plainCode, allowedCap string, amount int64) {
	t.Helper()
	batch := &model.RedeemBatch{
		ID:                 batchID,
		AmountMicrocredits: amount,
		Count:              1,
		Note:               "test-" + batchID,
		AllowedCapability:  allowedCap,
		CreatedBy:          "admin-1",
	}
	code := model.RedeemCode{
		ID:                 codeID,
		BatchID:            batchID,
		CodeHash:           plainCode,
		CodeSuffix:         "0001",
		AmountMicrocredits: amount,
		Status:             model.RedeemCodeUnused,
	}
	if err := repo.CreateRedeemBatch(batch, []model.RedeemCode{code}); err != nil {
		t.Fatalf("CreateRedeemBatch() error = %v", err)
	}
}

func TestRedeemCodeRoutesCreditsToCapabilityPool(t *testing.T) {
	repo := setupBillingPoolTestRepo(t)
	userID := "user-pools"

	seedRedeemCodeWithCapability(t, repo, "batch-img", "code-img", "hash-img", model.RedeemCapabilityImage, 300)
	seedRedeemCodeWithCapability(t, repo, "batch-vid", "code-vid", "hash-vid", model.RedeemCapabilityVideo, 200)
	seedRedeemCodeWithCapability(t, repo, "batch-all", "code-all", "hash-all", model.RedeemCapabilityAll, 100)

	acc, err := repo.RedeemCode(userID, "hash-img", "127.0.0.1")
	if err != nil {
		t.Fatalf("RedeemCode(image) error = %v", err)
	}
	if acc.ImageAvailableMicrocredits != 300 || acc.AvailableMicrocredits != 0 || acc.VideoAvailableMicrocredits != 0 {
		t.Fatalf("after image redeem got acc=%+v", acc)
	}

	acc, err = repo.RedeemCode(userID, "hash-vid", "127.0.0.1")
	if err != nil {
		t.Fatalf("RedeemCode(video) error = %v", err)
	}
	if acc.VideoAvailableMicrocredits != 200 || acc.ImageAvailableMicrocredits != 300 || acc.AvailableMicrocredits != 0 {
		t.Fatalf("after video redeem got acc=%+v", acc)
	}

	acc, err = repo.RedeemCode(userID, "hash-all", "127.0.0.1")
	if err != nil {
		t.Fatalf("RedeemCode(all) error = %v", err)
	}
	if acc.AvailableMicrocredits != 100 || acc.ImageAvailableMicrocredits != 300 || acc.VideoAvailableMicrocredits != 200 {
		t.Fatalf("after general redeem got acc=%+v", acc)
	}
}

func TestBillingPoolsIsolateCapabilitiesAndAllowAgent(t *testing.T) {
	repo := setupBillingPoolTestRepo(t)
	userID := "user-isolation"
	seedRedeemCodeWithCapability(t, repo, "batch-img-only", "code-img-only", "hash-img-only", model.RedeemCapabilityImage, 300)
	if _, err := repo.RedeemCode(userID, "hash-img-only", "127.0.0.1"); err != nil {
		t.Fatalf("RedeemCode() error = %v", err)
	}

	// 1) 视频任务严禁使用仅图片积分。
	videoOrder := &model.BillingOrder{
		ID: "order-video", UserID: userID, IdempotencyKey: "k-video",
		Capability: "video", Scene: "image_to_video", BillingMode: "fixed_request",
		AmountMicrocredits: 50, Status: model.BillingStatusReserved,
	}
	err := repo.ReserveBillingOrder(videoOrder)
	if !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("video order with only image credits got err = %v, want ErrInsufficientCredits", err)
	}
	if !strings.Contains(err.Error(), "仅限图片") {
		t.Fatalf("video error should explain image-only restriction, got %q", err.Error())
	}

	// 2) 非 Agent 普通文本/音频也不能用仅图片积分。
	audioOrder := &model.BillingOrder{
		ID: "order-audio", UserID: userID, IdempotencyKey: "k-audio",
		Capability: "audio", Scene: "audio", BillingMode: "fixed_request",
		AmountMicrocredits: 20, Status: model.BillingStatusReserved,
	}
	if err := repo.ReserveBillingOrder(audioOrder); !errors.Is(err, ErrInsufficientCredits) {
		t.Fatalf("audio order with only image credits got err = %v, want ErrInsufficientCredits", err)
	}

	// 3) Agent 对话步骤（cloud_agent_step）不受专用卡密限制。
	agentOrder := &model.BillingOrder{
		ID: "order-agent", UserID: userID, IdempotencyKey: "k-agent",
		Capability: "text", Scene: "cloud_agent_step", BillingMode: "token",
		AmountMicrocredits: 20, ReservedAmountMicrocredits: 20, Status: model.BillingStatusReserved,
	}
	if err := repo.ReserveBillingOrder(agentOrder); err != nil {
		t.Fatalf("cloud_agent_step reserve error = %v", err)
	}
	if agentOrder.ImageReservedMicrocredits != 20 {
		t.Fatalf("agent order ImageReservedMicrocredits = %d, want 20", agentOrder.ImageReservedMicrocredits)
	}
	acc, err := repo.CreditAccount(userID)
	if err != nil {
		t.Fatalf("CreditAccount() error = %v", err)
	}
	if acc.ImageAvailableMicrocredits != 280 || acc.ImageReservedMicrocredits != 20 {
		t.Fatalf("after agent reserve acc=%+v", acc)
	}

	// 退款原路精确退回图片池（绝不变为通用积分）。
	if err := repo.RefundBillingOrder(agentOrder.ID, "cancel"); err != nil {
		t.Fatalf("RefundBillingOrder(agentOrder) error = %v", err)
	}
	acc, err = repo.CreditAccount(userID)
	if err != nil {
		t.Fatalf("CreditAccount() after refund error = %v", err)
	}
	if acc.ImageAvailableMicrocredits != 300 || acc.ImageReservedMicrocredits != 0 || acc.AvailableMicrocredits != 0 {
		t.Fatalf("after agent refund acc=%+v", acc)
	}

	// 4) 充值/赠送 100 通用积分后，混合图片订单优先耗用图片券、差额从通用补扣、结算后按专用先花&通用先退返回。
	seedRedeemCodeWithCapability(t, repo, "batch-topup", "code-topup", "hash-topup", model.RedeemCapabilityAll, 100)
	if _, err := repo.RedeemCode(userID, "hash-topup", "127.0.0.1"); err != nil {
		t.Fatalf("RedeemCode(topup) error = %v", err)
	}
	// 账户此时：Image=300, General=100。发起 350 积分图片订单：ImageReserved=300, GeneralReserved=50。
	imgOrder := &model.BillingOrder{
		ID: "order-img-mixed", UserID: userID, IdempotencyKey: "k-img-mixed",
		Capability: "image", Scene: "image", BillingMode: "token",
		InputTokenPriceMicrocredits: 1_000_000, OutputTokenPriceMicrocredits: 1_000_000,
		MultiplierBasisPoints: 10_000,
		AmountMicrocredits:    350, ReservedAmountMicrocredits: 350, Status: model.BillingStatusReserved,
	}
	if err := repo.ReserveBillingOrder(imgOrder); err != nil {
		t.Fatalf("ReserveBillingOrder(img-mixed) error = %v", err)
	}
	if imgOrder.ImageReservedMicrocredits != 300 || imgOrder.VideoReservedMicrocredits != 0 {
		t.Fatalf("mixed img order reserved split = %+v", imgOrder)
	}
	// 上游实耗 310 积分 (OutputTokens=310)：应先用掉 300 图片券 + 10 通用，余下 40 通用退回 General！
	if err := repo.db.Create(&model.ApiCallLog{
		ID: "call-img-mixed", BillingOrderID: imgOrder.ID, Status: model.ApiCallStatusSucceeded,
		UsageAvailable: true, OutputTokens: 310, CreatedAt: time.Now(),
	}).Error; err != nil {
		t.Fatalf("seed ApiCallLog error = %v", err)
	}
	if err := repo.SettleBillingOrder(imgOrder.ID, "req-img"); err != nil {
		t.Fatalf("SettleBillingOrder(img-mixed) error = %v", err)
	}
	acc, err = repo.CreditAccount(userID)
	if err != nil {
		t.Fatalf("CreditAccount() error = %v", err)
	}
	// 期望：ImageAvailable=0, ImageReserved=0, GeneralAvailable=100-10=90, GeneralReserved=0
	if acc.ImageAvailableMicrocredits != 0 || acc.ImageReservedMicrocredits != 0 || acc.AvailableMicrocredits != 90 || acc.ReservedMicrocredits != 0 {
		t.Fatalf("after mixed settle acc=%+v, want image=0 general=90 reserved=0", acc)
	}
}
