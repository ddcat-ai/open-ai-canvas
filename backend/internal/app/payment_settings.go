// 充值计价货币设置：管理员选择默认充值货币（默认 USD），新建商品默认使用它，用户端优先展示该货币的商品。
// 每个商品仍保存自己的货币，切换默认货币不会改写已有商品价格。
//
// 支付渠道按自己的结算货币收款（易支付可配置，其余官方渠道为 CNY）。商品货币与渠道结算货币不同时，
// 下单按管理员配置的 USD/CNY 汇率换算实收金额并写入订单快照；未配置汇率时拒绝跨币种下单。

package app

import (
	"encoding/json"
	"errors"
	"fmt"
	"math/big"
	"sort"
	"strconv"
	"strings"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

const (
	paymentSettingsKey = "payment_settings"
	// paymentRateScale 是汇率定点精度：1 USD = rate / 1e6 CNY。
	paymentRateScale        = int64(1_000_000)
	maxPaymentRateMicros    = 10_000 * paymentRateScale
	defaultPaymentCurrency  = model.PriceCurrencyUSD
	paymentRateFractionMax  = 6
	paymentRateInvalidError = "USD/CNY 汇率必须是 0.000001 至 10000 之间、最多 6 位小数的数字"
)

type PaymentSettings struct {
	DefaultCurrency string `json:"defaultCurrency"`
	// UsdCnyRate 是 1 USD 兑换的 CNY 数量（十进制字符串，如 "7.2"）；为空表示未配置，跨币种渠道不可下单。
	UsdCnyRate string `json:"usdCnyRate"`
}

func normalizePaymentCurrency(value string) (string, error) {
	switch strings.ToUpper(strings.TrimSpace(value)) {
	case "":
		return defaultPaymentCurrency, nil
	case model.PriceCurrencyCNY:
		return model.PriceCurrencyCNY, nil
	case model.PriceCurrencyUSD:
		return model.PriceCurrencyUSD, nil
	default:
		return "", BadAuthRequest("充值货币只支持 CNY 或 USD")
	}
}

// parsePaymentRate 把十进制汇率解析为定点整数，拒绝科学计数法、负数和超过 6 位的小数，避免浮点误差进入金额计算。
func parsePaymentRate(value string) (int64, error) {
	value = strings.TrimSpace(value)
	if value == "" {
		return 0, nil
	}
	whole, fraction, hasFraction := strings.Cut(value, ".")
	if whole == "" || len(whole) > 5 || (hasFraction && (fraction == "" || len(fraction) > paymentRateFractionMax)) {
		return 0, BadAuthRequest(paymentRateInvalidError)
	}
	for _, char := range whole + fraction {
		if char < '0' || char > '9' {
			return 0, BadAuthRequest(paymentRateInvalidError)
		}
	}
	wholeValue, err := strconv.ParseInt(whole, 10, 64)
	if err != nil {
		return 0, BadAuthRequest(paymentRateInvalidError)
	}
	fractionValue := int64(0)
	if fraction != "" {
		padded := fraction + strings.Repeat("0", paymentRateFractionMax-len(fraction))
		fractionValue, err = strconv.ParseInt(padded, 10, 64)
		if err != nil {
			return 0, BadAuthRequest(paymentRateInvalidError)
		}
	}
	micros := wholeValue*paymentRateScale + fractionValue
	if micros <= 0 || micros > maxPaymentRateMicros {
		return 0, BadAuthRequest(paymentRateInvalidError)
	}
	return micros, nil
}

// formatPaymentRate 输出去掉末尾 0 的规范十进制字符串，保证保存与回显一致。
func formatPaymentRate(micros int64) string {
	if micros <= 0 {
		return ""
	}
	text := fmt.Sprintf("%d.%06d", micros/paymentRateScale, micros%paymentRateScale)
	return strings.TrimSuffix(strings.TrimRight(text, "0"), ".")
}

func normalizePaymentSettings(value PaymentSettings) (PaymentSettings, error) {
	currency, err := normalizePaymentCurrency(value.DefaultCurrency)
	if err != nil {
		return PaymentSettings{}, err
	}
	rate, err := parsePaymentRate(value.UsdCnyRate)
	if err != nil {
		return PaymentSettings{}, err
	}
	return PaymentSettings{DefaultCurrency: currency, UsdCnyRate: formatPaymentRate(rate)}, nil
}

// convertPaymentAmount 把商品金额（最小单位）换算为渠道结算货币的最小单位，四舍五入到分。
// 返回实收金额和本次使用的汇率快照；同币种时汇率为 0。
func convertPaymentAmount(amountFen int64, from, to string, rateMicros int64) (int64, int64, error) {
	if from == to {
		return amountFen, 0, nil
	}
	if rateMicros <= 0 {
		return 0, 0, BadAuthRequest(fmt.Sprintf("该支付渠道以 %s 结算，管理员尚未配置 USD/CNY 汇率，暂不能购买 %s 商品", to, from))
	}
	amount := big.NewInt(amountFen)
	rate := big.NewInt(rateMicros)
	scale := big.NewInt(paymentRateScale)
	numerator, denominator := new(big.Int), new(big.Int)
	switch {
	case from == model.PriceCurrencyUSD && to == model.PriceCurrencyCNY:
		numerator.Mul(amount, rate)
		denominator.Set(scale)
	case from == model.PriceCurrencyCNY && to == model.PriceCurrencyUSD:
		numerator.Mul(amount, scale)
		denominator.Set(rate)
	default:
		return 0, 0, BadAuthRequest(fmt.Sprintf("不支持从 %s 换算为 %s", from, to))
	}
	// 四舍五入：(n + d/2) / d。
	numerator.Add(numerator, new(big.Int).Quo(denominator, big.NewInt(2)))
	charge := new(big.Int).Quo(numerator, denominator)
	if !charge.IsInt64() || charge.Int64() <= 0 {
		return 0, 0, BadAuthRequest("换算后的支付金额无效，请检查汇率或商品价格")
	}
	return charge.Int64(), rateMicros, nil
}

func (s *Service) paymentSettings() (PaymentSettings, error) {
	setting, err := s.repo.SystemSetting(paymentSettingsKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return PaymentSettings{DefaultCurrency: defaultPaymentCurrency}, nil
	}
	if err != nil {
		return PaymentSettings{}, err
	}
	var value PaymentSettings
	if json.Unmarshal([]byte(setting.ValueJSON), &value) != nil {
		return PaymentSettings{}, errors.New("充值设置格式无效")
	}
	return normalizePaymentSettings(value)
}

func (s *Service) paymentRateMicros() (int64, error) {
	settings, err := s.paymentSettings()
	if err != nil {
		return 0, err
	}
	return parsePaymentRate(settings.UsdCnyRate)
}

func (s *Service) AdminPaymentSettings(actor *model.User) (PaymentSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PaymentSettings{}, err
	}
	return s.paymentSettings()
}

// PublicPaymentSettings 返回用户端充值面板需要的默认货币和汇率（用于预估跨币种实付金额）。
func (s *Service) PublicPaymentSettings(actor *model.User) (PaymentSettings, error) {
	if actor == nil {
		return PaymentSettings{}, Unauthorized("请先登录")
	}
	return s.paymentSettings()
}

// UpdatePaymentSettings 整体替换充值设置；调用方需同时提交默认货币与汇率。
func (s *Service) UpdatePaymentSettings(actor *model.User, req PaymentSettings) (PaymentSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return PaymentSettings{}, err
	}
	next, err := normalizePaymentSettings(req)
	if err != nil {
		return PaymentSettings{}, err
	}
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
	if err := s.appendAdminAudit(actor, "payment_settings.update", "system_setting", paymentSettingsKey, "更新充值货币与汇率", next); err != nil {
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
