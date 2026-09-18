package app

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

const paymentExportLimit = 10_000

type PaymentOrderQuery struct {
	Status, Keyword, ProviderID, TimeField, From, To string
}

type PaymentReconciliationQuery struct {
	ProviderID, Status, From, To string
}

func paymentDateRange(from, to string) (time.Time, time.Time, error) {
	var start, end time.Time
	var err error
	if from != "" {
		start, err = time.ParseInLocation("2006-01-02", from, paymentBillLocation)
		if err != nil {
			return start, end, BadAuthRequest("开始日期格式必须为 YYYY-MM-DD")
		}
	}
	if to != "" {
		end, err = time.ParseInLocation("2006-01-02", to, paymentBillLocation)
		if err != nil {
			return start, end, BadAuthRequest("结束日期格式必须为 YYYY-MM-DD")
		}
		if !start.IsZero() && end.Before(start) {
			return start, end, BadAuthRequest("结束日期不能早于开始日期")
		}
		end = end.AddDate(0, 0, 1)
	}
	return start, end, nil
}

func (q PaymentOrderQuery) filter() (repository.PaymentOrderFilter, error) {
	f := repository.PaymentOrderFilter{Status: strings.TrimSpace(q.Status), Keyword: strings.TrimSpace(q.Keyword), ProviderID: strings.TrimSpace(q.ProviderID), TimeField: q.TimeField}
	switch f.Status {
	case "", "all", "created", "pending", "closing", "closed", "credited", "create_failed":
	default:
		return f, BadAuthRequest("无效的订单状态")
	}
	switch f.TimeField {
	case "", "created", "paid", "credited":
	default:
		return f, BadAuthRequest("无效的订单时间口径")
	}
	var err error
	f.From, f.Until, err = paymentDateRange(q.From, q.To)
	return f, err
}

func (q PaymentReconciliationQuery) filter() (repository.PaymentReconciliationFilter, error) {
	f := repository.PaymentReconciliationFilter{ProviderID: strings.TrimSpace(q.ProviderID), Status: strings.TrimSpace(q.Status), From: q.From, To: q.To}
	switch f.Status {
	case "", "all", "running", "completed", "failed":
	default:
		return f, BadAuthRequest("无效的对账状态")
	}
	_, _, err := paymentDateRange(q.From, q.To)
	return f, err
}

func validatePaymentResult(result string) error {
	switch result {
	case "", "all", "abnormal", "matched", "recovered", "local_order_not_found", "provider_record_missing", "amount_mismatch", "trade_no_mismatch", "credit_failed":
		return nil
	default:
		return BadAuthRequest("无效的对账结果")
	}
}

func (s *Service) AdminPaymentOrdersCSV(ctx context.Context, actor *model.User, query PaymentOrderQuery) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter, err := query.filter()
	if err != nil {
		return nil, err
	}
	orders, users, err := s.repo.WithContext(ctx).ExportPaymentOrders(filter, paymentExportLimit+1)
	if err != nil {
		return nil, err
	}
	if err := checkPaymentExportSize(len(orders)); err != nil {
		return nil, err
	}
	rows := [][]string{{"订单ID", "商户订单号", "渠道交易号", "用户ID", "用户名", "显示名称", "邮箱", "商品名称", "支付渠道", "金额（元）", "币种", "积分", "订单状态", "渠道状态", "创建时间（北京时间）", "支付时间（北京时间）", "入账时间（北京时间）", "关闭时间（北京时间）"}}
	for _, order := range orders {
		user := users[order.UserID]
		trade := ""
		if order.ProviderTradeNo != nil {
			trade = *order.ProviderTradeNo
		}
		rows = append(rows, []string{paymentCSVIdentifier(order.ID), paymentCSVIdentifier(order.MerchantOrderNo), paymentCSVIdentifier(trade), paymentCSVIdentifier(order.UserID), user.Username, user.DisplayName, user.Email, order.ProductName, s.paymentExportProviderName(order.ProviderID), paymentDecimal(order.AmountFen, 2, false), order.Currency, paymentDecimal(order.CreditsMicrocredits, 6, true), paymentExportLabel(string(order.Status)), order.ProviderStatus, paymentCSVTime(&order.CreatedAt), paymentCSVTime(order.ProviderPaidAt), paymentCSVTime(order.CreditedAt), paymentCSVTime(order.ClosedAt)})
	}
	return paymentCSV(rows)
}

func (s *Service) AdminPaymentReconciliationsCSV(ctx context.Context, actor *model.User, query PaymentReconciliationQuery) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	filter, err := query.filter()
	if err != nil {
		return nil, err
	}
	runs, err := s.repo.WithContext(ctx).ExportPaymentReconciliations(filter, paymentExportLimit+1)
	if err != nil {
		return nil, err
	}
	if err := checkPaymentExportSize(len(runs)); err != nil {
		return nil, err
	}
	rows := [][]string{{"对账记录ID", "账单日期", "支付渠道", "执行状态", "总笔数", "一致笔数", "自动补发笔数", "异常笔数", "失败原因", "发起人ID／系统", "开始时间（北京时间）", "完成时间（北京时间）"}}
	for _, run := range runs {
		actor := run.StartedBy
		if actor == "system" {
			actor = "系统"
		}
		rows = append(rows, []string{paymentCSVIdentifier(run.ID), run.BillDate, s.paymentExportProviderName(run.ProviderID), paymentExportLabel(string(run.Status)), strconv.Itoa(run.TotalItems), strconv.Itoa(run.MatchItems), strconv.Itoa(run.RecoveredItems), strconv.Itoa(run.ErrorItems), run.Error, paymentCSVIdentifier(actor), paymentCSVTime(&run.StartedAt), paymentCSVTime(run.CompletedAt)})
	}
	return paymentCSV(rows)
}

func (s *Service) AdminPaymentReconciliationItemsCSV(ctx context.Context, actor *model.User, runID, result string) ([]byte, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if err := validatePaymentResult(result); err != nil {
		return nil, err
	}
	run, items, err := s.repo.WithContext(ctx).ExportPaymentReconciliationItems(runID, result, paymentExportLimit+1)
	if errors.Is(err, repository.ErrPaymentReconciliationRunning) {
		return nil, NewAppError(http.StatusConflict, "对账正在执行，请完成后再导出")
	}
	if err != nil {
		return nil, err
	}
	if run.Status != model.PaymentReconciliationCompleted {
		return nil, NewAppError(http.StatusConflict, "本次对账未完成，请导出汇总查看失败原因")
	}
	if err := checkPaymentExportSize(len(items)); err != nil {
		return nil, err
	}
	rows := [][]string{{"对账记录ID", "账单日期", "支付渠道", "本地订单ID", "商户订单号", "渠道交易号", "记录金额（元）", "金额来源", "币种", "对账结果", "是否已解决", "异常说明", "对账开始时间（北京时间）", "对账完成时间（北京时间）"}}
	for _, item := range items {
		source, resolved := "渠道账单", "否"
		if item.Result == model.PaymentReconciliationProviderRecordMissing {
			source = "本地订单"
		}
		if item.Resolved {
			resolved = "是"
		}
		rows = append(rows, []string{paymentCSVIdentifier(run.ID), run.BillDate, s.paymentExportProviderName(run.ProviderID), paymentCSVIdentifier(item.PaymentOrderID), paymentCSVIdentifier(item.MerchantOrderNo), paymentCSVIdentifier(item.ProviderTradeNo), paymentDecimal(item.AmountFen, 2, false), source, item.Currency, paymentExportLabel(string(item.Result)), resolved, item.Detail, paymentCSVTime(&run.StartedAt), paymentCSVTime(run.CompletedAt)})
	}
	return paymentCSV(rows)
}

func checkPaymentExportSize(size int) error {
	if size > paymentExportLimit {
		return BadAuthRequest("单次最多导出 10000 行，请缩小筛选范围后重试")
	}
	return nil
}

func paymentCSV(rows [][]string) ([]byte, error) {
	var buffer bytes.Buffer
	buffer.WriteString("\xEF\xBB\xBF")
	writer := csv.NewWriter(&buffer)
	writer.UseCRLF = true
	for _, row := range rows {
		for i, value := range row {
			row[i] = paymentCSVText(value)
		}
		if err := writer.Write(row); err != nil {
			return nil, err
		}
	}
	writer.Flush()
	return buffer.Bytes(), writer.Error()
}

func paymentCSVText(value string) string {
	trimmed := strings.TrimLeftFunc(value, func(r rune) bool { return unicode.IsSpace(r) || unicode.IsControl(r) || r == '\uFEFF' })
	if strings.ContainsAny(value, "\t\r\n") || (trimmed != "" && strings.ContainsRune("=+-@", rune(trimmed[0]))) {
		return "'" + value
	}
	return value
}

func paymentCSVIdentifier(value string) string {
	// CSV cannot declare text types. Prefix numeric/scientific IDs with a literal
	// apostrophe, never a formula; generic CSV consumers may remove this prefix.
	if value != "" {
		if _, err := strconv.ParseFloat(strings.TrimSpace(value), 64); err == nil {
			return "'" + value
		}
	}
	return value
}

func paymentDecimal(value int64, places int, trim bool) string {
	// Format integers directly to avoid rounding microcredits through float64.
	digits := strconv.FormatInt(value, 10)
	sign := ""
	if strings.HasPrefix(digits, "-") {
		sign, digits = "-", digits[1:]
	}
	if len(digits) <= places {
		digits = strings.Repeat("0", places+1-len(digits)) + digits
	}
	result := sign + digits[:len(digits)-places] + "." + digits[len(digits)-places:]
	if trim {
		result = strings.TrimRight(strings.TrimRight(result, "0"), ".")
	}
	return result
}

func paymentCSVTime(value *time.Time) string {
	if value == nil || value.IsZero() {
		return ""
	}
	return value.In(paymentBillLocation).Format("2006-01-02 15:04:05")
}

func (s *Service) paymentExportProviderName(id string) string {
	if s.paymentRegistry != nil {
		if provider, ok := s.paymentRegistry.Get(id); ok {
			return provider.Descriptor().Name
		}
	}
	return id
}

func paymentExportLabel(value string) string {
	labels := map[string]string{"created": "创建中", "pending": "待支付", "closing": "关单中", "closed": "已关闭", "credited": "已入账", "create_failed": "下单失败", "running": "执行中", "completed": "已完成", "failed": "失败", "matched": "一致", "recovered": "已自动补发", "local_order_not_found": "本地订单缺失", "provider_record_missing": "渠道记录缺失", "amount_mismatch": "金额不一致", "trade_no_mismatch": "交易号不一致", "credit_failed": "补发失败"}
	if label, ok := labels[value]; ok {
		return label
	}
	return value
}
