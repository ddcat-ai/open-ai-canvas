package service

import (
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

const creditPolicySettingKey = "credit_policy"

type CreditPolicy struct {
	SignupBonusMicrocredits  int64            `json:"signupBonusMicrocredits"`
	CheckinBonusMicrocredits int64            `json:"checkinBonusMicrocredits"`
	DefaultMultiplierBPS     int64            `json:"defaultMultiplierBasisPoints"`
	ModelMultiplierBPS       map[string]int64 `json:"modelMultiplierBasisPoints"`
}

type PublicCreditPolicy struct {
	SignupBonusMicrocredits  int64 `json:"signupBonusMicrocredits"`
	CheckinBonusMicrocredits int64 `json:"checkinBonusMicrocredits"`
	CheckedInToday           bool  `json:"checkedInToday"`
}

func defaultCreditPolicy() CreditPolicy {
	return CreditPolicy{SignupBonusMicrocredits: 100 * CreditScale, CheckinBonusMicrocredits: 10 * CreditScale, DefaultMultiplierBPS: 10_000, ModelMultiplierBPS: map[string]int64{}}
}

func validateCreditPolicy(policy CreditPolicy) error {
	if policy.SignupBonusMicrocredits < 0 || policy.CheckinBonusMicrocredits < 0 {
		return BadAuthRequest("注册和签到奖励不能小于 0")
	}
	if policy.SignupBonusMicrocredits > 1_000_000*CreditScale || policy.CheckinBonusMicrocredits > 100_000*CreditScale {
		return BadAuthRequest("积分奖励超出允许范围")
	}
	if policy.DefaultMultiplierBPS <= 0 || policy.DefaultMultiplierBPS > 1_000_000 {
		return BadAuthRequest("默认模型倍率必须在 0.0001-100 之间")
	}
	for modelKey, multiplier := range policy.ModelMultiplierBPS {
		if strings.TrimSpace(modelKey) == "" || multiplier <= 0 || multiplier > 1_000_000 {
			return BadAuthRequest("模型倍率配置无效")
		}
	}
	return nil
}

func (s *Service) creditPolicy() (CreditPolicy, error) {
	setting, err := s.repo.SystemSetting(creditPolicySettingKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return defaultCreditPolicy(), nil
	}
	if err != nil {
		return CreditPolicy{}, err
	}
	var policy CreditPolicy
	if json.Unmarshal([]byte(setting.ValueJSON), &policy) != nil {
		return CreditPolicy{}, errors.New("积分策略配置格式无效")
	}
	if policy.ModelMultiplierBPS == nil {
		policy.ModelMultiplierBPS = map[string]int64{}
	}
	if err := validateCreditPolicy(policy); err != nil {
		return CreditPolicy{}, err
	}
	return policy, nil
}

func (s *Service) AdminCreditPolicy(actor *model.User) (CreditPolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CreditPolicy{}, err
	}
	return s.creditPolicy()
}

func (s *Service) UpdateCreditPolicy(actor *model.User, policy CreditPolicy) (CreditPolicy, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return CreditPolicy{}, err
	}
	if policy.ModelMultiplierBPS == nil {
		policy.ModelMultiplierBPS = map[string]int64{}
	}
	if err := validateCreditPolicy(policy); err != nil {
		return CreditPolicy{}, err
	}
	encoded, err := json.Marshal(policy)
	if err != nil {
		return CreditPolicy{}, err
	}
	setting := model.SystemSetting{Key: creditPolicySettingKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	current, err := s.repo.SystemSetting(creditPolicySettingKey)
	if err == nil {
		setting.CreatedAt = current.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return CreditPolicy{}, err
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return CreditPolicy{}, err
	}
	if err := s.appendAdminAudit(actor, "credit_policy.update", "system_setting", creditPolicySettingKey, "更新积分策略", policy); err != nil {
		return CreditPolicy{}, err
	}
	return policy, nil
}

func (s *Service) ensureSignupBonus(userID string) error {
	policy, err := s.creditPolicy()
	if err != nil || policy.SignupBonusMicrocredits == 0 {
		return err
	}
	_, _, err = s.repo.GrantCreditsOnce(userID, model.CreditLedgerSignupBonus, policy.SignupBonusMicrocredits, "signup:"+userID, "新用户默认积分")
	return err
}

func (s *Service) CheckinCredits(user *model.User) (*model.CreditAccount, bool, error) {
	if user == nil {
		return nil, false, Unauthorized("请先登录")
	}
	policy, err := s.creditPolicy()
	if err != nil {
		return nil, false, err
	}
	if policy.CheckinBonusMicrocredits == 0 {
		return nil, false, BadAuthRequest("当前未开启签到奖励")
	}
	day := time.Now().UTC().Format("2006-01-02")
	return s.repo.GrantCreditsOnce(user.ID, model.CreditLedgerCheckinBonus, policy.CheckinBonusMicrocredits, "checkin:"+user.ID+":"+day, "每日签到奖励")
}

func (s *Service) publicCreditPolicy(userID string) (PublicCreditPolicy, error) {
	policy, err := s.creditPolicy()
	if err != nil {
		return PublicCreditPolicy{}, err
	}
	reference := "checkin:" + userID + ":" + time.Now().UTC().Format("2006-01-02")
	checked, err := s.repo.CreditLedgerReferenceExists(reference)
	return PublicCreditPolicy{SignupBonusMicrocredits: policy.SignupBonusMicrocredits, CheckinBonusMicrocredits: policy.CheckinBonusMicrocredits, CheckedInToday: checked}, err
}

// 全程使用整数基点并向上取整，避免浮点误差造成少扣积分。
func creditAmount(base int64, multiplierBPS int64) (int64, error) {
	if base < 0 || multiplierBPS <= 0 {
		return 0, errors.New("积分计费参数无效")
	}
	if base > (1<<63-1)/multiplierBPS {
		return 0, errors.New("积分计费金额溢出")
	}
	amount := (base*multiplierBPS + 9_999) / 10_000
	if amount < 0 {
		return 0, fmt.Errorf("积分计费金额无效：%d", amount)
	}
	return amount, nil
}
