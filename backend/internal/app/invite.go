package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"math/big"
	"strings"
	"time"

	"yingce/backend/internal/invite"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// ===== 策略读取与配置 =====

func (s *Service) readInvitePolicy() (invite.InvitePolicy, error) {
	setting, err := s.repo.SystemSetting(invite.SettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return invite.DefaultInvitePolicy(), nil
	}
	if err != nil {
		return invite.InvitePolicy{}, err
	}
	return invite.ParseInvitePolicy(setting.ValueJSON)
}

// InvitePublicPolicy 匿名可访问：注册页与用户端按此决定邀请码输入框、按钮与文案。
func (s *Service) InvitePublicPolicy() (invite.PublicPolicy, error) {
	policy, err := s.readInvitePolicy()
	if err != nil {
		return invite.PublicPolicy{}, err
	}
	return invite.PublicProjection(&policy), nil
}

// InviteSettingView 管理端完整配置视图（含商品覆盖与审计信息）。
type InviteSettingView struct {
	invite.InvitePolicy
	UpdatedBy string    `json:"updatedBy"`
	CreatedAt time.Time `json:"createdAt"`
	UpdatedAt time.Time `json:"updatedAt"`
}

func (s *Service) AdminInviteSetting(actor *model.User) (*InviteSettingView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	setting, err := s.repo.SystemSetting(invite.SettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		defaults := invite.DefaultInvitePolicy()
		return &InviteSettingView{InvitePolicy: defaults}, nil
	}
	if err != nil {
		return nil, err
	}
	policy, err := invite.ParseInvitePolicy(setting.ValueJSON)
	if err != nil {
		return nil, err
	}
	return &InviteSettingView{InvitePolicy: policy, UpdatedBy: setting.UpdatedBy, CreatedAt: setting.CreatedAt, UpdatedAt: setting.UpdatedAt}, nil
}

func (s *Service) UpdateInviteSetting(actor *model.User, req invite.InvitePolicy) (*InviteSettingView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	policy := req
	if err := invite.NormalizeAndValidate(&policy); err != nil {
		return nil, kernel.BadAuthRequest(err.Error())
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		return nil, err
	}
	setting := model.SystemSetting{Key: invite.SettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	audit, err := newAdminAuditEvent(actor, "invite_policy.update", "system_setting", invite.SettingKey,
		"更新邀请配置", map[string]any{"enabled": policy.Enabled, "level": policy.Level,
			"withdrawEnabled": policy.WithdrawEnabled, "transferEnabled": policy.TransferEnabled})
	if err != nil {
		return nil, err
	}
	if err := s.repo.UpdateInvitePolicy(&setting, policy, *audit); err != nil {
		return nil, err
	}
	return &InviteSettingView{InvitePolicy: policy, UpdatedBy: actor.ID, CreatedAt: setting.CreatedAt, UpdatedAt: setting.UpdatedAt}, nil
}

// ===== 支付入账的邀请奖励指令组装 =====

// inviteRewardInstructionForOrder 依据策略与单品覆盖组装奖励指令；收款人由支付事务读取。
func (s *Service) inviteRewardInstructionForOrder(order *model.PaymentOrder) (*invite.InviteRewardInstruction, error) {
	if order == nil || order.UserID == "" || order.AmountFen <= 0 {
		return nil, nil
	}
	source := model.InviteRewardSourceProduct
	itemID := order.ProductID
	policy, err := s.readInvitePolicy()
	if err != nil {
		return nil, err
	}
	if !policy.Enabled || !invite.ScopeAllows(&policy, string(source)) {
		return nil, nil
	}
	l1Rate, l2Rate := invite.ResolveRates(&policy, string(source), itemID)
	levels := make([]invite.RewardLevel, 0, 2)
	if l1Rate > 0 {
		levels = append(levels, invite.RewardLevel{Level: 1, RateBP: l1Rate})
	}
	if l2Rate > 0 {
		levels = append(levels, invite.RewardLevel{Level: 2, RateBP: l2Rate})
	}
	if len(levels) == 0 {
		return nil, nil
	}
	return &invite.InviteRewardInstruction{
		InviteeID: order.UserID, Source: source,
		RewardCountLimit: policy.RewardCountLimit, Levels: levels,
	}, nil
}

// ===== 用户端概览与记录 =====

// RewardAccountView 奖励账户对外视图。
type RewardAccountView struct {
	TotalMicroYuan       int64 `json:"totalMicroYuan"`
	AvailableMicroYuan   int64 `json:"availableMicroYuan"`
	FrozenMicroYuan      int64 `json:"frozenMicroYuan"`
	UsedMicroYuan        int64 `json:"usedMicroYuan"`
	TodayRewardMicroYuan int64 `json:"todayRewardMicroYuan"`
}

// InvitedByView 我的上线信息。
type InvitedByView struct {
	L1Username string `json:"l1Username"`
	L2Username string `json:"l2Username"`
}

// InviteOverview 邀请页面首屏数据。
type InviteOverview struct {
	Policy       invite.PublicPolicy `json:"policy"`
	Account      RewardAccountView   `json:"account"`
	InviteCode   string              `json:"inviteCode"`
	InvitedBy    *InvitedByView      `json:"invitedBy,omitempty"`
	InviteeCount int64               `json:"inviteeCount"`
}

func (s *Service) InviteOverview(user *model.User) (*InviteOverview, error) {
	if user == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	policy, err := s.readInvitePolicy()
	if err != nil {
		return nil, err
	}
	account, err := s.repo.RewardAccount(user.ID)
	if err != nil {
		return nil, err
	}
	code, err := s.repo.EnsureUserInviteCode(user.ID)
	if err != nil {
		return nil, err
	}
	todayStart := time.Date(time.Now().Year(), time.Now().Month(), time.Now().Day(), 0, 0, 0, 0, time.Local)
	todayReward, err := s.repo.InviteRewardsCreditedSince(user.ID, todayStart)
	if err != nil {
		return nil, err
	}
	inviteeCount, err := s.repo.CountDownline(user.ID)
	if err != nil {
		return nil, err
	}
	overview := &InviteOverview{
		Policy: invite.PublicProjection(&policy),
		Account: RewardAccountView{
			TotalMicroYuan: account.TotalMicroYuan, AvailableMicroYuan: account.AvailableMicroYuan,
			FrozenMicroYuan: account.FrozenMicroYuan, UsedMicroYuan: account.UsedMicroYuan,
			TodayRewardMicroYuan: todayReward,
		},
		InviteCode: code, InviteeCount: inviteeCount,
	}
	record, err := s.repo.InviteRecord(user.ID)
	if err != nil {
		return nil, err
	}
	if record != nil && (record.L1InviterID != "" || record.L2InviterID != "") {
		view := &InvitedByView{}
		ids := make([]string, 0, 2)
		if record.L1InviterID != "" {
			ids = append(ids, record.L1InviterID)
		}
		if record.L2InviterID != "" {
			ids = append(ids, record.L2InviterID)
		}
		users, err := s.repo.UsersByIDs(ids)
		if err != nil {
			return nil, err
		}
		if u, ok := users[record.L1InviterID]; ok {
			view.L1Username = inviteDisplayname(u)
		}
		if u, ok := users[record.L2InviterID]; ok {
			view.L2Username = inviteDisplayname(u)
		}
		overview.InvitedBy = view
	}
	return overview, nil
}

func inviteDisplayname(user model.User) string {
	if strings.TrimSpace(user.DisplayName) != "" {
		return user.DisplayName
	}
	return user.Username
}

// InviteRecordsPage 用户端邀请记录分页。
type InviteRecordsPageView struct {
	Records  []repository.UserInviteRecordView `json:"records"`
	Total    int64                             `json:"total"`
	Page     int                               `json:"page"`
	PageSize int                               `json:"pageSize"`
}

func (s *Service) InviteRecordsPage(user *model.User, page, pageSize int) (*InviteRecordsPageView, error) {
	if user == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	page, limit := normalizeAdminPage(page, pageSize)
	records, total, err := s.repo.UserInviteRecords(user.ID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &InviteRecordsPageView{Records: records, Total: total, Page: page, PageSize: limit}, nil
}

// ===== 提现 =====

// WithdrawAccountInfo 收款信息。加密落库，仅管理端详情解密展示。
type WithdrawAccountInfo struct {
	Account    string `json:"account,omitempty"` // 微信绑定手机号 / 支付宝账号
	RealName   string `json:"realName,omitempty"`
	QRCodeURL  string `json:"qrCodeUrl,omitempty"`
	BankName   string `json:"bankName,omitempty"`
	CardNumber string `json:"cardNumber,omitempty"`
	HolderName string `json:"holderName,omitempty"`
}

// WithdrawAccountView 用户端自己的收款信息（预填表单用）。
type WithdrawAccountView struct {
	Method string              `json:"method"`
	Info   WithdrawAccountInfo `json:"info"`
}

func (s *Service) GetWithdrawAccount(user *model.User) (*WithdrawAccountView, error) {
	if user == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	saved, err := s.repo.WithdrawAccount(user.ID)
	if err != nil {
		return nil, err
	}
	if saved == nil {
		return nil, nil
	}
	info, err := s.decryptWithdrawAccount(saved.AccountCipher)
	if err != nil {
		return nil, err
	}
	return &WithdrawAccountView{Method: string(saved.Method), Info: *info}, nil
}

func (s *Service) SaveWithdrawAccount(user *model.User, method string, info WithdrawAccountInfo) error {
	if user == nil {
		return kernel.Unauthorized("请先登录")
	}
	policy, err := s.readInvitePolicy()
	if err != nil {
		return err
	}
	if err := validateWithdrawAccount(&policy, model.WithdrawMethod(method), info); err != nil {
		return err
	}
	cipher, err := s.encryptWithdrawAccount(info)
	if err != nil {
		return err
	}
	return s.repo.SaveWithdrawAccount(&model.WithdrawAccount{
		UserID: user.ID, Method: model.WithdrawMethod(method), AccountCipher: cipher, UpdatedAt: time.Now(),
	})
}

func validateWithdrawAccount(policy *invite.InvitePolicy, method model.WithdrawMethod, info WithdrawAccountInfo) error {
	for _, value := range []string{info.Account, info.RealName, info.BankName, info.HolderName} {
		if len([]rune(value)) > 160 {
			return kernel.BadAuthRequest("收款信息最多 160 个字符")
		}
	}
	if len(info.CardNumber) > 32 {
		return kernel.BadAuthRequest("银行卡号过长")
	}
	if len(info.QRCodeURL) > 500 {
		return kernel.BadAuthRequest("收款码链接过长")
	}
	if policy.WithdrawEnabled {
		allowed := false
		for _, candidate := range policy.WithdrawMethods {
			if candidate == string(method) {
				allowed = true
			}
		}
		if !allowed {
			return kernel.BadAuthRequest("当前未开放该提现方式")
		}
	}
	switch method {
	case model.WithdrawMethodWechat, model.WithdrawMethodAlipay:
		if strings.TrimSpace(info.Account) == "" {
			return kernel.BadAuthRequest("请填写收款手机号或账号")
		}
		if strings.TrimSpace(info.RealName) == "" {
			return kernel.BadAuthRequest("请填写收款实名")
		}
	case model.WithdrawMethodBank:
		if strings.TrimSpace(info.BankName) == "" {
			return kernel.BadAuthRequest("请填写开户行")
		}
		if strings.TrimSpace(info.CardNumber) == "" {
			return kernel.BadAuthRequest("请填写银行卡号")
		}
		if strings.TrimSpace(info.HolderName) == "" {
			return kernel.BadAuthRequest("请填写持卡人姓名")
		}
	default:
		return kernel.BadAuthRequest("提现方式不支持")
	}
	return nil
}

func (s *Service) encryptWithdrawAccount(info WithdrawAccountInfo) (cipher string, err error) {
	encoded, err := json.Marshal(info)
	if err != nil {
		return "", err
	}
	return s.encryptSettingSecret(string(encoded))
}

func (s *Service) decryptWithdrawAccount(cipher string) (*WithdrawAccountInfo, error) {
	plain, err := s.decryptSettingSecret(cipher)
	if err != nil {
		return nil, err
	}
	info := &WithdrawAccountInfo{}
	if err := json.Unmarshal([]byte(plain), info); err != nil {
		return nil, errors.New("收款信息解析失败")
	}
	return info, nil
}

// WithdrawalCreateRequest 用户发起提现。金额以分提交，服务端 ×1e4 转微元。
type WithdrawalCreateRequest struct {
	AmountFen   int64               `json:"amountFen"`
	Method      string              `json:"method"`
	Account     WithdrawAccountInfo `json:"account"`
	SaveAccount bool                `json:"saveAccount"`
}

// WithdrawalsPage 用户端提现记录分页。
type WithdrawalsPageView struct {
	Records  []model.WithdrawRequest `json:"records"`
	Total    int64                   `json:"total"`
	Page     int                     `json:"page"`
	PageSize int                     `json:"pageSize"`
}

func (s *Service) CreateWithdrawal(user *model.User, req WithdrawalCreateRequest) (*model.WithdrawRequest, error) {
	if user == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	policy, err := s.readInvitePolicy()
	if err != nil {
		return nil, err
	}
	if !policy.WithdrawEnabled {
		return nil, kernel.BadAuthRequest("当前未开放提现")
	}
	method := model.WithdrawMethod(strings.TrimSpace(req.Method))
	if err := validateWithdrawAccount(&policy, method, req.Account); err != nil {
		return nil, err
	}
	if req.AmountFen <= 0 {
		return nil, kernel.BadAuthRequest("请填写提现金额")
	}
	if req.AmountFen < policy.WithdrawMinFen {
		return nil, kernel.BadAuthRequest(fmt.Sprintf("单次提现最低 %s 元", formatFen(policy.WithdrawMinFen)))
	}
	if req.AmountFen > math.MaxInt64/10_000 {
		return nil, kernel.BadAuthRequest("提现金额超出可处理范围")
	}
	amountMicro := req.AmountFen * 10_000
	feeMicro := req.AmountFen * policy.WithdrawFeeBP
	actualMicro := amountMicro - feeMicro
	cipher, err := s.encryptWithdrawAccount(req.Account)
	if err != nil {
		return nil, err
	}
	request := &model.WithdrawRequest{
		ID: kernel.NewID(), UserID: user.ID, AmountMicroYuan: amountMicro,
		FeeMicroYuan: feeMicro, ActualMicroYuan: actualMicro, Method: method,
		AccountCipher: cipher, Status: model.WithdrawStatusPending,
		CreatedAt: time.Now(), UpdatedAt: time.Now(),
	}
	var saved *model.WithdrawAccount
	if req.SaveAccount {
		saved = &model.WithdrawAccount{UserID: user.ID, Method: method, AccountCipher: cipher, UpdatedAt: time.Now()}
	}
	if err := s.repo.CreateWithdrawRequest(request, policy.WithdrawDailyLimit, saved); err != nil {
		if errors.Is(err, repository.ErrRewardInsufficientBalance) {
			return nil, kernel.QuotaExceeded("可用奖励余额不足")
		}
		if errors.Is(err, repository.ErrWithdrawDailyLimit) {
			return nil, kernel.QuotaExceeded("今日提现次数已达上限")
		}
		return nil, err
	}
	return request, nil
}

func (s *Service) UserWithdrawals(user *model.User, page, pageSize int) (*WithdrawalsPageView, error) {
	if user == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	page, limit := normalizeAdminPage(page, pageSize)
	records, total, err := s.repo.WithdrawRequestsByUser(user.ID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &WithdrawalsPageView{Records: records, Total: total, Page: page, PageSize: limit}, nil
}

// ===== 划转 =====

// TransferCreateRequest 用户发起划转。
type TransferCreateRequest struct {
	AmountFen int64 `json:"amountFen"`
}

// TransfersPage 用户端划转记录分页。
type TransfersPageView struct {
	Records  []model.TransferRecord `json:"records"`
	Total    int64                  `json:"total"`
	Page     int                    `json:"page"`
	PageSize int                    `json:"pageSize"`
}

func (s *Service) CreateTransfer(user *model.User, req TransferCreateRequest) (*model.TransferRecord, *model.CreditAccount, error) {
	if user == nil {
		return nil, nil, kernel.Unauthorized("请先登录")
	}
	policy, err := s.readInvitePolicy()
	if err != nil {
		return nil, nil, err
	}
	if !policy.TransferEnabled {
		return nil, nil, kernel.BadAuthRequest("当前未开放划转")
	}
	if req.AmountFen <= 0 {
		return nil, nil, kernel.BadAuthRequest("请填写划转金额")
	}
	if req.AmountFen < policy.TransferMinFen {
		return nil, nil, kernel.BadAuthRequest(fmt.Sprintf("单次划转最低 %s 元", formatFen(policy.TransferMinFen)))
	}
	if req.AmountFen > math.MaxInt64/10_000 {
		return nil, nil, kernel.BadAuthRequest("划转金额超出可处理范围")
	}
	amountMicro := req.AmountFen * 10_000
	credits := new(big.Int).Mul(big.NewInt(amountMicro), big.NewInt(policy.TransferRateMilli))
	credits.Quo(credits, big.NewInt(1000))
	if !credits.IsInt64() {
		return nil, nil, kernel.BadAuthRequest("兑换积分超出可处理范围")
	}
	creditsMicro := credits.Int64()
	if creditsMicro <= 0 {
		return nil, nil, kernel.BadAuthRequest("划转金额过小，无法兑换积分")
	}
	record, account, err := s.repo.CreateTransfer(user.ID, amountMicro, policy.TransferRateMilli, creditsMicro)
	if err != nil {
		if errors.Is(err, repository.ErrRewardInsufficientBalance) {
			return nil, nil, kernel.QuotaExceeded("可用奖励余额不足")
		}
		return nil, nil, err
	}
	return record, account, nil
}

func (s *Service) UserTransfers(user *model.User, page, pageSize int) (*TransfersPageView, error) {
	if user == nil {
		return nil, kernel.Unauthorized("请先登录")
	}
	page, limit := normalizeAdminPage(page, pageSize)
	records, total, err := s.repo.TransfersByUser(user.ID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &TransfersPageView{Records: records, Total: total, Page: page, PageSize: limit}, nil
}

// formatFen 以元为单位展示分金额（去除多余的 0）。
func formatFen(fen int64) string {
	yuan := float64(fen) / 100
	return strings.TrimRight(strings.TrimRight(fmt.Sprintf("%.2f", yuan), "0"), ".")
}
