// 充值计价货币设置：管理员选择默认充值货币，新建商品默认使用它，用户端优先展示该货币的商品。
// 每个商品仍保存自己的货币，切换默认货币不会改写已有商品价格。

package app

import (
	"encoding/json"
	"errors"
	"sort"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const paymentSettingsKey = "payment_settings"

type PaymentSettings struct {
	DefaultCurrency string `json:"defaultCurrency"`
}

func normalizePaymentCurrency(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "", model.PriceCurrencyCNY:
		return model.PriceCurrencyCNY, nil
	case model.PriceCurrencyUSD:
		return model.PriceCurrencyUSD, nil
	default:
		return "", BadAuthRequest("充值货币只支持 CNY 或 USD")
	}
}

func (s *Service) paymentSettings() (PaymentSettings, error) {
	setting, err := s.repo.SystemSetting(paymentSettingsKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PaymentSettings{DefaultCurrency: model.PriceCurrencyCNY}, nil
	}
	if err != nil {
		return PaymentSettings{}, err
	}
	var value PaymentSettings
	if json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return PaymentSettings{}, errors.New("充值设置格式无效")
	}
	currency, err := normalizePaymentCurrency(value.DefaultCurrency)
	if err != nil {
		return PaymentSettings{}, err
	}
	return PaymentSettings{DefaultCurrency: currency}, nil
}

func (s *Service) AdminPaymentSettings(actor *model.User) (PaymentSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PaymentSettings{}, err
	}
	return s.paymentSettings()
}

// PublicPaymentSettings 返回用户端充值面板需要的默认货币。
func (s *Service) PublicPaymentSettings(actor *model.User) (PaymentSettings, error) {
	if actor == nil {
		return PaymentSettings{}, Unauthorized("请先登录")
	}
	return s.paymentSettings()
}

func (s *Service) UpdatePaymentSettings(actor *model.User, req PaymentSettings) (PaymentSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PaymentSettings{}, err
	}
	currency, err := normalizePaymentCurrency(req.DefaultCurrency)
	if err != nil {
		return PaymentSettings{}, err
	}
	next := PaymentSettings{DefaultCurrency: currency}
	encoded, err := json.Marshal(next)
	if err != nil {
		return PaymentSettings{}, err
	}
	setting := model.SystemSetting{Key: paymentSettingsKey, ValueJSON: string(encoded), UpdatedBy: actor.ID}
	current, err := s.repo.SystemSetting(paymentSettingsKey)
	if err == nil {
		setting.CreatedAt = current.CreatedAt
	} else if !errors.Is(err, gorm.ErrRecordNotFound) {
		return PaymentSettings{}, err
	}
	if err := s.repo.SaveSystemSetting(&setting); err != nil {
		return PaymentSettings{}, err
	}
	if err := s.appendAdminAudit(actor, "payment_settings.update", "system_setting", paymentSettingsKey, "更新默认充值货币", next); err != nil {
		return PaymentSettings{}, err
	}
	return next, nil
}

// sortTopupProductsByCurrency 把默认货币的商品排在前面，同货币内保持原有排序。
func sortTopupProductsByCurrency(products []model.TopupProduct, defaultCurrency string) {
	sort.SliceStable(products, func(i, j int) bool {
		left := firstNonEmpty(products[i].Currency, model.PriceCurrencyCNY) == defaultCurrency
		right := firstNonEmpty(products[j].Currency, model.PriceCurrencyCNY) == defaultCurrency
		return left && !right
	})
}
