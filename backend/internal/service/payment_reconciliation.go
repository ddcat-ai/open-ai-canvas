package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	"golang.org/x/text/encoding/simplifiedchinese"
	"golang.org/x/text/transform"
	"gorm.io/gorm"
	"infinite-canvas/backend/internal/model"
)

type PaymentReconciliationRequest struct {
	ChannelID string `json:"channelId"`
	TradeDate string `json:"tradeDate"`
}

type PaymentReconciliationResult struct {
	Run       model.PaymentReconciliationRun       `json:"run"`
	Anomalies []model.PaymentReconciliationAnomaly `json:"anomalies"`
}

type PaymentReconciliationPage struct {
	Runs  []model.PaymentReconciliationRun `json:"runs"`
	Total int64                            `json:"total"`
	Page  int                              `json:"page"`
	Limit int                              `json:"limit"`
}

type wechatTradeBillRow struct {
	OrderID               string
	ProviderTransactionID string
	State                 string
	Currency              string
	AmountFen             int64
	RefundFen             int64
	PaidAt                time.Time
}

func (s *Service) ReconcilePaymentChannel(ctx context.Context, actor *model.User, request PaymentReconciliationRequest) (*PaymentReconciliationResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	// Archived channels remain available for historical callbacks and
	// reconciliation; archiving only prevents creation of new orders.
	channel, err := s.repo.PaymentChannelIncludingArchived(strings.TrimSpace(request.ChannelID))
	if err != nil {
		return nil, mapPaymentNotFound(err, "支付渠道不存在")
	}
	tradeDate, err := time.Parse("2006-01-02", strings.TrimSpace(request.TradeDate))
	if err != nil {
		return nil, BadAuthRequest("对账日期格式必须为 YYYY-MM-DD")
	}
	chinaZone := time.FixedZone("CST", 8*60*60)
	nowInChina := time.Now().In(chinaZone)
	today := time.Date(nowInChina.Year(), nowInChina.Month(), nowInChina.Day(), 0, 0, 0, 0, chinaZone)
	requestedDay := time.Date(tradeDate.Year(), tradeDate.Month(), tradeDate.Day(), 0, 0, 0, 0, chinaZone)
	if requestedDay.After(today) {
		return nil, BadAuthRequest("不能对未来日期执行对账")
	}
	if channel.ActiveConfigVersionID == "" {
		return nil, BadAuthRequest("支付渠道尚未配置")
	}
	run := model.PaymentReconciliationRun{
		ChannelID: channel.ID, Provider: channel.Provider, TradeDate: requestedDay.Format("2006-01-02"),
		Status: model.PaymentReconciliationRunning, RequestedBy: actor.ID,
	}
	now := time.Now().UTC()
	run.StartedAt = &now
	if err := s.repo.CreatePaymentReconciliationRun(&run); err != nil {
		return nil, err
	}
	failRun := func(cause error) (*PaymentReconciliationResult, error) {
		_ = s.repo.CompletePaymentReconciliationRun(run.ID, model.PaymentReconciliationFailed, 0, 0, 0, 0, 0, "", truncateRunes(cause.Error(), 1000))
		return nil, cause
	}
	provider, err := s.payments().Get(channel.Provider)
	if err != nil {
		return failRun(WrapAppError(http.StatusServiceUnavailable, "支付服务商不可用", err))
	}
	_, rawConfig, err := s.paymentConfig(channel.ActiveConfigVersionID)
	if err != nil {
		return failRun(err)
	}
	bill, err := provider.DownloadTradeBill(ctx, rawConfig, run.TradeDate)
	if err != nil {
		return failRun(WrapAppError(http.StatusBadGateway, "下载支付账单失败", err))
	}
	rows, err := parseWechatTradeBill(bill.Content, chinaZone)
	if err != nil {
		return failRun(WrapAppError(http.StatusBadGateway, "解析支付账单失败", err))
	}

	start := requestedDay.UTC()
	end := requestedDay.Add(24 * time.Hour).UTC()
	localOrders, err := s.repo.RechargeOrdersForReconciliation(channel.ID, start, end)
	if err != nil {
		return failRun(err)
	}
	localByID := make(map[string]model.CreditRechargeOrder, len(localOrders))
	for _, order := range localOrders {
		localByID[order.ID] = order
	}
	seen := make(map[string]bool, len(rows))
	anomalies := make([]model.PaymentReconciliationAnomaly, 0)
	providerOrderCount, providerAmountFen := int64(0), int64(0)
	reconciledAt := time.Now().UTC()
	addAnomaly := func(item model.PaymentReconciliationAnomaly) error {
		item.RunID = run.ID
		if err := s.repo.CreatePaymentReconciliationAnomaly(&item); err != nil {
			return err
		}
		anomalies = append(anomalies, item)
		return nil
	}

	for _, row := range rows {
		succeeded := wechatTradeStateSucceeded(row.State)
		if !succeeded && row.RefundFen <= 0 {
			continue
		}
		if succeeded {
			providerOrderCount++
			providerAmountFen += row.AmountFen
			seen[row.OrderID] = true
		}
		order, ok := localByID[row.OrderID]
		if !ok {
			loaded, loadErr := s.repo.RechargeOrder(row.OrderID)
			if errors.Is(loadErr, gorm.ErrRecordNotFound) {
				if row.RefundFen > 0 {
					if err := addAnomaly(model.PaymentReconciliationAnomaly{Type: "unexpected_refund", ProviderTransactionID: row.ProviderTransactionID, ExpectedAmountFen: 0, ActualAmountFen: row.RefundFen, Detail: "平台禁止退款，但微信账单检测到无本地订单的退款金额，请人工核对商户平台操作"}); err != nil {
						return failRun(err)
					}
				}
				if succeeded {
					if err := addAnomaly(model.PaymentReconciliationAnomaly{Type: "provider_only", ProviderTransactionID: row.ProviderTransactionID, ActualAmountFen: row.AmountFen, Detail: "微信账单存在成功交易，但本地订单不存在"}); err != nil {
						return failRun(err)
					}
				}
				continue
			}
			if loadErr != nil {
				return failRun(loadErr)
			}
			order = *loaded
		}
		if order.ChannelID != channel.ID || order.Provider != channel.Provider {
			if err := addAnomaly(model.PaymentReconciliationAnomaly{OrderID: order.ID, Type: "channel_mismatch", ProviderTransactionID: row.ProviderTransactionID, ExpectedAmountFen: order.AmountFen, ActualAmountFen: row.AmountFen, Detail: "账单交易命中了其他支付渠道的本地订单"}); err != nil {
				return failRun(err)
			}
			continue
		}
		if row.RefundFen > 0 {
			_ = s.repo.MarkRechargeReviewRequired(order.ID, "UNEXPECTED_REFUND", "微信账单检测到平台外退款，请人工核对商户平台操作")
			if err := addAnomaly(model.PaymentReconciliationAnomaly{OrderID: order.ID, Type: "unexpected_refund", ProviderTransactionID: row.ProviderTransactionID, ExpectedAmountFen: 0, ActualAmountFen: row.RefundFen, Detail: "平台禁止退款，但微信账单检测到退款金额，请人工核对商户平台操作"}); err != nil {
				return failRun(err)
			}
		}
		if !succeeded {
			continue
		}
		if order.AmountFen != row.AmountFen || !strings.EqualFold(order.Currency, row.Currency) {
			_ = s.repo.MarkRechargeReviewRequired(order.ID, "RECONCILIATION_AMOUNT_MISMATCH", "微信账单金额或币种与订单快照不一致")
			if err := addAnomaly(model.PaymentReconciliationAnomaly{OrderID: order.ID, Type: "amount_mismatch", ProviderTransactionID: row.ProviderTransactionID, ExpectedAmountFen: order.AmountFen, ActualAmountFen: row.AmountFen, Detail: "微信账单金额或币种与订单快照不一致"}); err != nil {
				return failRun(err)
			}
			continue
		}
		if order.ProviderTransactionID != nil && *order.ProviderTransactionID != row.ProviderTransactionID {
			if err := addAnomaly(model.PaymentReconciliationAnomaly{OrderID: order.ID, Type: "transaction_id_mismatch", ProviderTransactionID: row.ProviderTransactionID, ExpectedAmountFen: order.AmountFen, ActualAmountFen: row.AmountFen, Detail: "微信支付交易号与本地订单记录不一致"}); err != nil {
				return failRun(err)
			}
			continue
		}
		if order.Status != model.CreditRechargeOrderCredited {
			if _, creditErr := s.repo.ConfirmRechargePaid(order.ID, row.ProviderTransactionID, row.AmountFen, row.Currency, row.PaidAt, ""); creditErr != nil {
				_ = s.repo.MarkRechargeReviewRequired(order.ID, "RECONCILIATION_CREDIT_FAILED", "对账发现成功支付，但自动补发积分失败")
				if err := addAnomaly(model.PaymentReconciliationAnomaly{OrderID: order.ID, Type: "credit_failed", ProviderTransactionID: row.ProviderTransactionID, ExpectedAmountFen: order.AmountFen, ActualAmountFen: row.AmountFen, Detail: "对账发现成功支付，但自动补发积分失败"}); err != nil {
					return failRun(err)
				}
				continue
			}
		}
		if err := s.repo.MarkRechargeReconciled(order.ID, reconciledAt); err != nil {
			return failRun(err)
		}
	}

	localOrderCount, localAmountFen := int64(0), int64(0)
	refreshedLocalOrders, err := s.repo.RechargeOrdersForReconciliation(channel.ID, start, end)
	if err != nil {
		return failRun(err)
	}
	for _, order := range refreshedLocalOrders {
		if order.Status != model.CreditRechargeOrderCredited {
			continue
		}
		localOrderCount++
		localAmountFen += order.AmountFen
		if !seen[order.ID] {
			transactionID := ""
			if order.ProviderTransactionID != nil {
				transactionID = *order.ProviderTransactionID
			}
			if err := addAnomaly(model.PaymentReconciliationAnomaly{OrderID: order.ID, Type: "local_only", ProviderTransactionID: transactionID, ExpectedAmountFen: order.AmountFen, Detail: "本地订单已到账，但当日微信成功交易账单中未找到"}); err != nil {
				return failRun(err)
			}
		}
	}
	if err := s.repo.CompletePaymentReconciliationRun(run.ID, model.PaymentReconciliationSucceeded, providerOrderCount, providerAmountFen, localOrderCount, localAmountFen, int64(len(anomalies)), bill.Digest, ""); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_reconciliation.run", "payment_reconciliation_run", run.ID, "执行支付渠道交易对账", map[string]any{"channelId": channel.ID, "tradeDate": run.TradeDate, "anomalyCount": len(anomalies)}); err != nil {
		return nil, err
	}
	completedRun, err := s.repo.PaymentReconciliationRun(run.ID)
	if err != nil {
		return nil, err
	}
	return &PaymentReconciliationResult{Run: *completedRun, Anomalies: anomalies}, nil
}

func (s *Service) PaymentReconciliationRuns(actor *model.User, channelID string, page int, limit int) (*PaymentReconciliationPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizePaymentPage(page, limit)
	items, total, err := s.repo.ListPaymentReconciliationRuns(channelID, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &PaymentReconciliationPage{Runs: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) PaymentReconciliationAnomalies(actor *model.User, runID string) ([]model.PaymentReconciliationAnomaly, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.repo.ListPaymentReconciliationAnomalies(strings.TrimSpace(runID))
}

func (s *Service) ResolvePaymentReconciliationAnomaly(actor *model.User, runID string, anomalyID string, note string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	runID = strings.TrimSpace(runID)
	anomalyID = strings.TrimSpace(anomalyID)
	if runID == "" || anomalyID == "" {
		return BadAuthRequest("缺少对账异常标识")
	}
	note = truncateRunes(strings.TrimSpace(note), 500)
	if note == "" {
		return BadAuthRequest("请填写核查备注")
	}
	updated, err := s.repo.ResolvePaymentReconciliationAnomaly(runID, anomalyID, actor.ID, note)
	if err != nil {
		return err
	}
	if !updated {
		return NotFound("对账异常不存在或已核查")
	}
	return s.appendAdminAudit(actor, "payment_reconciliation.anomaly.resolve", "payment_reconciliation_anomaly", anomalyID, "标记支付对账异常已核查", map[string]any{"runId": runID, "note": note})
}

func parseWechatTradeBill(content []byte, location *time.Location) ([]wechatTradeBillRow, error) {
	reader := io.Reader(bytes.NewReader(content))
	if !utf8.Valid(content) {
		reader = transform.NewReader(bytes.NewReader(content), simplifiedchinese.GB18030.NewDecoder())
	}
	csvReader := csv.NewReader(reader)
	csvReader.FieldsPerRecord = -1
	csvReader.LazyQuotes = true
	records, err := csvReader.ReadAll()
	if err != nil {
		return nil, err
	}
	headerIndex := -1
	var header map[string]int
	for index, record := range records {
		candidate := make(map[string]int, len(record))
		for column, value := range record {
			candidate[normalizeWechatBillValue(value)] = column
		}
		if _, hasMerchantOrderID := candidate["商户订单号"]; hasMerchantOrderID {
			headerIndex, header = index, candidate
			break
		}
	}
	if headerIndex < 0 {
		return nil, errors.New("WeChat Pay bill is missing the merchant order header")
	}
	column := func(names ...string) int {
		for _, name := range names {
			if index, ok := header[name]; ok {
				return index
			}
		}
		return -1
	}
	orderColumn := column("商户订单号")
	transactionColumn := column("微信订单号", "微信支付订单号")
	stateColumn := column("交易状态")
	currencyColumn := column("货币种类", "币种")
	amountColumn := column("订单金额", "总金额", "应结订单金额")
	refundColumn := column("申请退款金额", "退款金额")
	timeColumn := column("交易时间", "支付完成时间")
	if orderColumn < 0 || transactionColumn < 0 || stateColumn < 0 || amountColumn < 0 {
		return nil, errors.New("WeChat Pay bill is missing required trade columns")
	}
	rows := make([]wechatTradeBillRow, 0, len(records)-headerIndex-1)
	for _, record := range records[headerIndex+1:] {
		valueAt := func(index int) string {
			if index < 0 || index >= len(record) {
				return ""
			}
			return normalizeWechatBillValue(record[index])
		}
		orderID := valueAt(orderColumn)
		if orderID == "" || strings.Contains(orderID, "总交易单数") {
			continue
		}
		amountFen, amountErr := decimalYuanToFen(valueAt(amountColumn))
		if amountErr != nil {
			return nil, fmt.Errorf("parse order %s amount: %w", orderID, amountErr)
		}
		refundFen := int64(0)
		if refundValue := valueAt(refundColumn); refundValue != "" {
			refundFen, _ = decimalYuanToFen(refundValue)
		}
		paidAt := time.Time{}
		if paidValue := valueAt(timeColumn); paidValue != "" {
			for _, layout := range []string{"2006-01-02 15:04:05", time.RFC3339} {
				if parsed, parseErr := time.ParseInLocation(layout, paidValue, location); parseErr == nil {
					paidAt = parsed.UTC()
					break
				}
			}
		}
		currency := strings.ToUpper(valueAt(currencyColumn))
		if currency == "" {
			currency = "CNY"
		}
		rows = append(rows, wechatTradeBillRow{
			OrderID: orderID, ProviderTransactionID: valueAt(transactionColumn), State: valueAt(stateColumn),
			Currency: currency, AmountFen: amountFen, RefundFen: refundFen, PaidAt: paidAt,
		})
	}
	return rows, nil
}

func normalizeWechatBillValue(value string) string {
	value = strings.TrimSpace(strings.TrimPrefix(value, "\ufeff"))
	value = strings.TrimSpace(strings.TrimPrefix(value, "`"))
	return value
}

func decimalYuanToFen(value string) (int64, error) {
	value = normalizeWechatBillValue(value)
	value = strings.NewReplacer("¥", "", "￥", "", ",", "").Replace(value)
	if value == "" {
		return 0, nil
	}
	negative := strings.HasPrefix(value, "-")
	value = strings.TrimPrefix(value, "-")
	parts := strings.Split(value, ".")
	if len(parts) > 2 || parts[0] == "" {
		return 0, errors.New("invalid decimal amount")
	}
	yuan, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil {
		return 0, err
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > 2 {
		return 0, errors.New("amount has more than two decimal places")
	}
	fraction += strings.Repeat("0", 2-len(fraction))
	fen := int64(0)
	if fraction != "" {
		fen, err = strconv.ParseInt(fraction, 10, 64)
		if err != nil {
			return 0, err
		}
	}
	total := yuan*100 + fen
	if negative {
		total = -total
	}
	return total, nil
}

func wechatTradeStateSucceeded(state string) bool {
	state = strings.TrimSpace(state)
	return strings.EqualFold(state, "SUCCESS") || state == "支付成功" || state == "交易成功"
}
