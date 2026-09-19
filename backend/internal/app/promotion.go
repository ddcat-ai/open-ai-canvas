package app

import (
	"crypto/rand"
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/kernel"
	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const promotionPolicySettingKey = "promotion_policy"

// PromotionPolicy 是推广中心可配置策略：返佣比例、冻结天数与提现门槛。
// 是否开放推广中心由特性开关 promotionEnabled 决定，策略只回答“开启后怎么算”。
type PromotionPolicy struct {
	RatioBPS                  int64 `json:"ratioBasisPoints"`
	FreezeDays                int   `json:"freezeDays"`
	MinWithdrawalMicrocredits int64 `json:"minWithdrawalMicrocredits"`
}

func defaultPromotionPolicy() PromotionPolicy {
	return PromotionPolicy{RatioBPS: 300, FreezeDays: 3, MinWithdrawalMicrocredits: 10 * CreditScale}
}

// PublicPromotionEnabled 供未登录的注册页判断推广邀请是否可用，只暴露一个布尔值。
func (s *Service) PublicPromotionEnabled() (bool, error) {
	return s.promotionEnabled()
}

// PublicInviteCodeValid 供注册页在未登录状态校验邀请码是否真实存在。
// 只返回是否存在，不返回邀请人身份，避免通过注册页探测用户信息。
func (s *Service) PublicInviteCodeValid(code string) (bool, error) {
	code = strings.ToUpper(strings.TrimSpace(code))
	if code == "" {
		return false, nil
	}
	if _, err := s.repo.InviteCodeByCode(code); err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return false, nil
		}
		return false, err
	}
	return true, nil
}

// promotionEnabled 是推广中心的唯一开关：入口可见性、邀请绑定、返佣结算与提现都以它为准。
func (s *Service) promotionEnabled() (bool, error) {
	features, err := s.FeatureAvailability()
	if err != nil {
		return false, err
	}
	if features == nil {
		return false, nil
	}
	return features.PromotionEnabled, nil
}

func validatePromotionPolicy(policy PromotionPolicy) error {
	if policy.RatioBPS < 0 || policy.RatioBPS > 10_000 {
		return BadAuthRequest("返佣比例必须在 0%-100% 之间")
	}
	if policy.FreezeDays < 0 || policy.FreezeDays > 365 {
		return BadAuthRequest("冻结天数必须在 0-365 天之间")
	}
	if policy.MinWithdrawalMicrocredits < 0 {
		return BadAuthRequest("最低提现额度不能为负数")
	}
	return nil
}

func (s *Service) promotionPolicy() (PromotionPolicy, error) {
	setting, err := s.repo.SystemSetting(promotionPolicySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultPromotionPolicy(), nil
	}
	if err != nil {
		return PromotionPolicy{}, err
	}
	policy := defaultPromotionPolicy()
	if json.Unmarshal([]byte(setting.ValueJSON), &policy) != nil {
		return PromotionPolicy{}, errors.New("推广策略配置格式无效")
	}
	if err := validatePromotionPolicy(policy); err != nil {
		return PromotionPolicy{}, err
	}
	return policy, nil
}

func (s *Service) AdminPromotionPolicy(actor *model.User) (PromotionPolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PromotionPolicy{}, err
	}
	return s.promotionPolicy()
}

func (s *Service) UpdatePromotionPolicy(actor *model.User, policy PromotionPolicy) (PromotionPolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PromotionPolicy{}, err
	}
	if err := validatePromotionPolicy(policy); err != nil {
		return PromotionPolicy{}, err
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		return PromotionPolicy{}, err
	}
	setting := model.SystemSetting{Key: promotionPolicySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	current, err := s.repo.SystemSetting(promotionPolicySettingKey)
	if err == nil {
		setting.CreatedAt = current.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return PromotionPolicy{}, err
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return PromotionPolicy{}, err
	}
	if err := s.appendAdminAudit(actor, "promotion.policy.update", "system", promotionPolicySettingKey, "更新推广策略", map[string]any{"ratioBasisPoints": policy.RatioBPS, "freezeDays": policy.FreezeDays, "minWithdrawalMicrocredits": policy.MinWithdrawalMicrocredits}); err != nil {
		return PromotionPolicy{}, err
	}
	return s.promotionPolicy()
}

// PromotionOverview 是推广中心首屏指标，单位均为微积分。
type PromotionOverview struct {
	Enabled                   bool   `json:"enabled"`
	InviteCode                string `json:"inviteCode"`
	RatioBPS                  int64  `json:"ratioBasisPoints"`
	FreezeDays                int    `json:"freezeDays"`
	InvitedCount              int64  `json:"invitedCount"`
	FrozenMicrocredits        int64  `json:"frozenMicrocredits"`
	AvailableMicrocredits     int64  `json:"availableMicrocredits"`
	ReviewMicrocredits        int64  `json:"reviewMicrocredits"`
	TransferredMicrocredits   int64  `json:"transferredMicrocredits"`
	WithdrawnMicrocredits     int64  `json:"withdrawnMicrocredits"`
	TotalMicrocredits         int64  `json:"totalMicrocredits"`
	UnfrozenMicrocredits      int64  `json:"unfrozenMicrocredits"`
	MinWithdrawalMicrocredits int64  `json:"minWithdrawalMicrocredits"`
}

// PromotionInvitationItem 是推广记录列表项，对外不暴露内部 ID 关系以外的信息。
type PromotionInvitationItem struct {
	ID                      string    `json:"id"`
	InviteeID               string    `json:"inviteeId"`
	InviteeName             string    `json:"inviteeName"`
	InviteeContact          string    `json:"inviteeContact"`
	Source                  string    `json:"source"`
	ContributedMicrocredits int64     `json:"contributedMicrocredits"`
	CommissionMicrocredits  int64     `json:"commissionMicrocredits"`
	CreatedAt               time.Time `json:"createdAt"`
}

type PromotionInvitationPageResult struct {
	Items []PromotionInvitationItem `json:"items"`
	Total int64                     `json:"total"`
	Page  int                       `json:"page"`
	Limit int                       `json:"limit"`
}

type PromotionCommissionPageResult struct {
	Items []model.CommissionRecord `json:"items"`
	Total int64                    `json:"total"`
	Page  int                      `json:"page"`
	Limit int                      `json:"limit"`
}

type PromotionWithdrawalPageResult struct {
	Items []model.WithdrawalRequest `json:"items"`
	Total int64                     `json:"total"`
	Page  int                       `json:"page"`
	Limit int                       `json:"limit"`
}

// PromotionWithdrawalRequest 是用户提交提现的入参。
type PromotionWithdrawalRequest struct {
	AmountMicrocredits int64  `json:"amountMicrocredits"`
	Channel            string `json:"channel"`
	Account            string `json:"account"`
	AccountName        string `json:"accountName"`
}

// PromotionTransferRequest 是返佣转入账户积分的入参；RequestID 由前端生成，重试时复用。
type PromotionTransferRequest struct {
	AmountMicrocredits int64  `json:"amountMicrocredits"`
	RequestID          string `json:"requestId"`
}

func normalizePromotionPage(page int, limit int) (int, int) {
	if page < 1 {
		page = 1
	}
	if limit <= 0 || limit > 100 {
		limit = 20
	}
	return page, limit
}

// formatCreditAmount 把微积分转成用户可读的积分文本，用于错误提示。
func formatCreditAmount(microcredits int64) string {
	return strconv.FormatFloat(float64(microcredits)/float64(CreditScale), 'f', -1, 64)
}

func newInviteCode() (string, error) {
	// 去掉 0/O/1/I 等易混淆字符，方便用户口述或手抄邀请码。
	const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"
	var builder strings.Builder
	for index := 0; index < 8; index++ {
		value, err := rand.Int(rand.Reader, big.NewInt(int64(len(alphabet))))
		if err != nil {
			return "", err
		}
		builder.WriteByte(alphabet[value.Int64()])
	}
	return builder.String(), nil
}

// EnsureInviteCode 返回用户邀请码，首次访问推广中心时生成。
func (s *Service) EnsureInviteCode(userID string) (string, error) {
	existing, err := s.repo.InviteCodeForUser(userID)
	if err == nil {
		return existing.Code, nil
	}
	if !errors.Is(err, gorm.ErrRecordNotFound) {
		return "", err
	}
	for attempt := 0; attempt < 5; attempt++ {
		code, generateErr := newInviteCode()
		if generateErr != nil {
			return "", generateErr
		}
		if err := s.repo.SaveInviteCode(&model.InviteCode{ID: kernel.NewID(), UserID: userID, Code: code}); err != nil {
			return "", err
		}
		saved, lookupErr := s.repo.InviteCodeForUser(userID)
		if lookupErr == nil {
			return saved.Code, nil
		}
		if !errors.Is(lookupErr, gorm.ErrRecordNotFound) {
			return "", lookupErr
		}
	}
	return "", errors.New("生成邀请码失败，请稍后重试")
}

func normalizeInvitationSource(source string) string {
	switch strings.TrimSpace(source) {
	case "link", "code", "manual":
		return strings.TrimSpace(source)
	default:
		return "link"
	}
}

// BindInvitation 建立邀请关系。注册流程调用它，失败不应阻断注册。
func (s *Service) BindInvitation(inviteeID string, code string, source string) error {
	inviteeID = strings.TrimSpace(inviteeID)
	code = strings.ToUpper(strings.TrimSpace(code))
	if inviteeID == "" || code == "" {
		return nil
	}
	enabled, err := s.promotionEnabled()
	if err != nil {
		return err
	}
	if !enabled {
		return BadAuthRequest("推广邀请暂时未启用")
	}
	owner, err := s.repo.InviteCodeByCode(code)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return BadAuthRequest("邀请码不存在或已失效")
	}
	if err != nil {
		return err
	}
	if owner.UserID == inviteeID {
		return BadAuthRequest("不能绑定自己的邀请码")
	}
	if _, err := s.repo.InvitationForInvitee(inviteeID); err == nil {
		// 邀请关系只在首次绑定时生效，避免被邀请人反复改绑刷返佣。
		return nil
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return err
	}
	_, err = s.repo.SaveInvitation(&model.Invitation{
		ID: kernel.NewID(), InviterID: owner.UserID, InviteeID: inviteeID,
		Code: code, Source: normalizeInvitationSource(source),
	})
	return err
}

func (s *Service) PromotionOverview(user *model.User) (*PromotionOverview, error) {
	enabled, err := s.promotionEnabled()
	if err != nil {
		return nil, err
	}
	policy, err := s.promotionPolicy()
	if err != nil {
		return nil, err
	}
	code, err := s.EnsureInviteCode(user.ID)
	if err != nil {
		return nil, err
	}
	// 冻结期到期是时间事件，这里做惰性解冻，避免再引入定时任务失败路径。
	if _, err := s.repo.ReleaseDueCommissions(user.ID, time.Now()); err != nil {
		return nil, err
	}
	invited, err := s.repo.CountInvitations(user.ID)
	if err != nil {
		return nil, err
	}
	totals, err := s.repo.CommissionTotals(user.ID)
	if err != nil {
		return nil, err
	}
	return &PromotionOverview{
		Enabled:                   enabled,
		InviteCode:                code,
		RatioBPS:                  policy.RatioBPS,
		FreezeDays:                policy.FreezeDays,
		InvitedCount:              invited,
		FrozenMicrocredits:        totals.FrozenMicrocredits,
		AvailableMicrocredits:     totals.AvailableMicrocredits,
		ReviewMicrocredits:        totals.ReviewMicrocredits,
		TransferredMicrocredits:   totals.TransferredMicrocredits,
		WithdrawnMicrocredits:     totals.WithdrawnMicrocredits,
		TotalMicrocredits:         totals.TotalMicrocredits,
		UnfrozenMicrocredits:      totals.TotalMicrocredits - totals.FrozenMicrocredits,
		MinWithdrawalMicrocredits: policy.MinWithdrawalMicrocredits,
	}, nil
}

func (s *Service) PromotionInvitations(user *model.User, page int, limit int) (*PromotionInvitationPageResult, error) {
	page, limit = normalizePromotionPage(page, limit)
	rows, total, err := s.repo.PromotionInvitationPage(user.ID, (page-1)*limit, limit)
	if err != nil {
		return nil, err
	}
	items := make([]PromotionInvitationItem, 0, len(rows))
	for _, row := range rows {
		items = append(items, PromotionInvitationItem{
			ID: row.ID, InviteeID: row.InviteeID, InviteeName: row.InviteeName, InviteeContact: row.InviteeContact,
			Source: row.Source, ContributedMicrocredits: row.ContributedMicrocredits,
			CommissionMicrocredits: row.CommissionMicrocredits, CreatedAt: row.CreatedAt,
		})
	}
	return &PromotionInvitationPageResult{Items: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) PromotionCommissions(user *model.User, status string, page int, limit int) (*PromotionCommissionPageResult, error) {
	page, limit = normalizePromotionPage(page, limit)
	if _, err := s.repo.ReleaseDueCommissions(user.ID, time.Now()); err != nil {
		return nil, err
	}
	records, total, err := s.repo.CommissionRecordsForUser(user.ID, strings.TrimSpace(status), (page-1)*limit, limit)
	if err != nil {
		return nil, err
	}
	return &PromotionCommissionPageResult{Items: records, Total: total, Page: page, Limit: limit}, nil
}

// SettlePaymentCommission 在充值入账成功后为邀请人记一笔冻结返佣。
// 重复回调由返佣流水的 reference_key 兜底，不会重复返佣。
func (s *Service) SettlePaymentCommission(order *model.PaymentOrder) error {
	if order == nil || order.UserID == "" || order.CreditsMicrocredits <= 0 {
		return nil
	}
	enabled, err := s.promotionEnabled()
	if err != nil {
		return err
	}
	if !enabled {
		return nil
	}
	policy, err := s.promotionPolicy()
	if err != nil {
		return err
	}
	if policy.RatioBPS <= 0 {
		return nil
	}
	invitation, err := s.repo.InvitationForInvitee(order.UserID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil
	}
	if err != nil {
		return err
	}
	amount := order.CreditsMicrocredits * policy.RatioBPS / 10_000
	if amount <= 0 {
		return nil
	}
	_, err = s.repo.SaveCommissionRecord(&model.CommissionRecord{
		ID:                 kernel.NewID(),
		InviterID:          invitation.InviterID,
		InviteeID:          order.UserID,
		SourceType:         "payment_topup",
		SourceID:           order.ID,
		BaseMicrocredits:   order.CreditsMicrocredits,
		RatioBPS:           policy.RatioBPS,
		AmountMicrocredits: amount,
		Status:             model.CommissionFrozen,
		AvailableAt:        time.Now().AddDate(0, 0, policy.FreezeDays),
		ReferenceKey:       "commission:payment:" + order.ID,
	})
	return err
}

func (s *Service) TransferPromotionCommission(user *model.User, req PromotionTransferRequest) (*model.CreditAccount, error) {
	enabled, err := s.promotionEnabled()
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, BadAuthRequest("推广中心暂未开放")
	}
	if req.AmountMicrocredits <= 0 {
		return nil, BadAuthRequest("转入积分必须大于 0")
	}
	requestID := strings.TrimSpace(req.RequestID)
	if requestID == "" {
		return nil, BadAuthRequest("缺少请求标识，请重试")
	}
	if _, err := s.repo.ReleaseDueCommissions(user.ID, time.Now()); err != nil {
		return nil, err
	}
	account, err := s.repo.TransferCommissionToCredits(
		user.ID, req.AmountMicrocredits,
		"promotion-transfer:"+user.ID+":"+truncateRunes(requestID, 80),
		"推广返佣转入账户积分",
	)
	if errors.Is(err, repository.ErrCommissionInsufficient) {
		return nil, BadAuthRequest("可用返佣不足")
	}
	return account, err
}

func normalizeWithdrawalChannel(channel string) string {
	switch strings.TrimSpace(channel) {
	case "alipay", "wechat", "bank":
		return strings.TrimSpace(channel)
	default:
		return ""
	}
}

func (s *Service) CreatePromotionWithdrawal(user *model.User, req PromotionWithdrawalRequest) (*model.WithdrawalRequest, error) {
	enabled, err := s.promotionEnabled()
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, BadAuthRequest("推广中心暂未开放")
	}
	policy, err := s.promotionPolicy()
	if err != nil {
		return nil, err
	}
	if req.AmountMicrocredits <= 0 {
		return nil, BadAuthRequest("提现金额必须大于 0")
	}
	if policy.MinWithdrawalMicrocredits > 0 && req.AmountMicrocredits < policy.MinWithdrawalMicrocredits {
		return nil, BadAuthRequest(fmt.Sprintf("最低提现额度为 %s 积分", formatCreditAmount(policy.MinWithdrawalMicrocredits)))
	}
	channel := normalizeWithdrawalChannel(req.Channel)
	if channel == "" {
		return nil, BadAuthRequest("请选择提现方式")
	}
	account := strings.TrimSpace(req.Account)
	if account == "" {
		return nil, BadAuthRequest("请填写收款账号")
	}
	if _, err := s.repo.ReleaseDueCommissions(user.ID, time.Now()); err != nil {
		return nil, err
	}
	request := &model.WithdrawalRequest{
		ID:                 kernel.NewID(),
		UserID:             user.ID,
		AmountMicrocredits: req.AmountMicrocredits,
		Channel:            channel,
		Account:            truncateRunes(account, 160),
		AccountName:        truncateRunes(strings.TrimSpace(req.AccountName), 80),
		Status:             model.WithdrawalPending,
	}
	if err := s.repo.CreateWithdrawalWithAllocation(request); err != nil {
		if errors.Is(err, repository.ErrCommissionInsufficient) {
			return nil, BadAuthRequest("可用返佣不足")
		}
		return nil, err
	}
	return request, nil
}

func (s *Service) PromotionWithdrawals(user *model.User, page int, limit int) (*PromotionWithdrawalPageResult, error) {
	page, limit = normalizePromotionPage(page, limit)
	requests, total, err := s.repo.WithdrawalPage(user.ID, "", (page-1)*limit, limit)
	if err != nil {
		return nil, err
	}
	return &PromotionWithdrawalPageResult{Items: requests, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminPromotionWithdrawals(actor *model.User, status string, page int, limit int) (*PromotionWithdrawalPageResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizePromotionPage(page, limit)
	requests, total, err := s.repo.WithdrawalPage("", strings.TrimSpace(status), (page-1)*limit, limit)
	if err != nil {
		return nil, err
	}
	return &PromotionWithdrawalPageResult{Items: requests, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminReviewPromotionWithdrawal(actor *model.User, id string, approve bool, note string) (*model.WithdrawalRequest, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	if id == "" {
		return nil, BadAuthRequest("提现申请 ID 不能为空")
	}
	note = strings.TrimSpace(note)
	if !approve && note == "" {
		return nil, BadAuthRequest("驳回时必须填写原因")
	}
	target, err := s.repo.Withdrawal(id)
	if err != nil {
		return nil, err
	}
	updated, err := s.repo.ReviewWithdrawal(actor.ID, id, approve, truncateRunes(note, 500))
	if errors.Is(err, repository.ErrWithdrawalNotPending) {
		return nil, BadAuthRequest("该提现申请已处理，不能重复审核")
	}
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "promotion.withdrawal.review", "withdrawal", id, "审核推广提现申请", map[string]any{
		"approve": approve, "userId": target.UserID, "amountMicrocredits": target.AmountMicrocredits, "note": truncateRunes(note, 500),
	}); err != nil {
		return nil, err
	}
	return updated, nil
}
