package service

import (
	"bytes"
	"context"
	"encoding/csv"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type PaymentReconciliationPage struct {
	Runs  []model.PaymentReconciliationRun `json:"runs"`
	Total int64                            `json:"total"`
	Page  int                              `json:"page"`
	Limit int                              `json:"limit"`
}

type PaymentReconciliationDetail struct {
	Run         model.PaymentReconciliationRun          `json:"run"`
	Differences []model.PaymentReconciliationDifference `json:"differences"`
}

type wechatTradeBillRow struct {
	AppID           string
	MerchantID      string
	TransactionID   string
	OutTradeNo      string
	TradeState      string
	AmountFen       int64
	IsRefund        bool
	RefundID        string
	RefundAmountFen int64
}

func (s *Service) AdminPaymentReconciliationRuns(actor *model.User, page int, limit int) (*PaymentReconciliationPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	runs, total, err := s.repo.PaymentReconciliationRuns(limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &PaymentReconciliationPage{Runs: runs, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminPaymentReconciliationDetail(actor *model.User, id string) (*PaymentReconciliationDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	run, err := s.repo.PaymentReconciliationRun(strings.TrimSpace(id))
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, NotFound("对账任务不存在")
	}
	if err != nil {
		return nil, err
	}
	differences, err := s.repo.PaymentReconciliationDifferences(run.ID)
	if err != nil {
		return nil, err
	}
	return &PaymentReconciliationDetail{Run: *run, Differences: differences}, nil
}

func (s *Service) AdminRunPaymentReconciliation(ctx context.Context, actor *model.User, channelID string, billDate string) (*PaymentReconciliationDetail, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	date, err := validateReconciliationDate(billDate)
	if err != nil {
		return nil, err
	}
	run, err := s.runPaymentReconciliation(ctx, strings.TrimSpace(channelID), date, actor.ID, true)
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "payment_reconciliation.run", "payment_reconciliation", run.ID, "执行微信支付交易账单对账", map[string]any{"channelId": channelID, "billDate": date}); err != nil {
		return nil, err
	}
	return s.AdminPaymentReconciliationDetail(actor, run.ID)
}

func (s *Service) runPaymentReconciliation(ctx context.Context, channelID string, billDate string, createdBy string, force bool) (*model.PaymentReconciliationRun, error) {
	channel, err := s.repo.PaymentChannel(channelID)
	if err != nil {
		return nil, err
	}
	version, err := s.repo.PaymentChannelVersion(channel.ActiveVersionID)
	if err != nil {
		return nil, err
	}
	now := time.Now()
	run := &model.PaymentReconciliationRun{
		ID: newID(), MerchantID: version.MerchantID, ChannelID: channel.ID, ChannelVersionID: version.ID,
		BillDate: billDate, Status: model.PaymentReconciliationPending, CreatedBy: createdBy, CreatedAt: now, UpdatedAt: now,
	}
	run, _, err = s.repo.CreateOrGetPaymentReconciliationRun(run)
	if err != nil {
		return nil, err
	}
	if run.Status == model.PaymentReconciliationCompleted {
		return run, nil
	}
	if run.Status == model.PaymentReconciliationRunning && time.Since(run.UpdatedAt) < 30*time.Minute {
		return run, nil
	}
	if run.Status == model.PaymentReconciliationFailed && !force && time.Since(run.UpdatedAt) < 30*time.Minute {
		return run, nil
	}
	claimTime := time.Now()
	claimed, err := s.repo.ClaimPaymentReconciliationRun(run.ID, claimTime.Add(-30*time.Minute), claimTime)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return s.repo.PaymentReconciliationRun(run.ID)
	}
	run.Status = model.PaymentReconciliationRunning
	provider, err := s.paymentProvider(ctx, *version)
	if err != nil {
		return nil, s.failPaymentReconciliation(run.ID, err)
	}
	content, billHash, err := provider.DownloadTradeBill(ctx, billDate)
	if err != nil {
		return nil, s.failPaymentReconciliation(run.ID, err)
	}
	billRows, err := parseWechatTradeBill(content)
	if err != nil {
		return nil, s.failPaymentReconciliation(run.ID, err)
	}
	location := paymentLocation()
	date, _ := time.ParseInLocation("2006-01-02", billDate, location)
	localOrders, err := s.repo.SuccessfulPaymentOrdersForMerchant(version.MerchantID, date, date.AddDate(0, 0, 1))
	if err != nil {
		return nil, s.failPaymentReconciliation(run.ID, err)
	}
	differences, matched, successCount, refundCount := s.comparePaymentReconciliation(run.ID, billRows, localOrders)
	run.BillHash = billHash
	run.WechatOrderCount = successCount
	run.LocalOrderCount = len(localOrders)
	run.MatchedCount = matched
	run.DifferenceCount = len(differences)
	run.ExternalRefundCount = refundCount
	if err := s.repo.CompletePaymentReconciliationRun(run, differences, time.Now()); err != nil {
		return nil, err
	}
	return s.repo.PaymentReconciliationRun(run.ID)
}

func (s *Service) comparePaymentReconciliation(runID string, billRows []wechatTradeBillRow, localOrders []model.PaymentOrder) ([]model.PaymentReconciliationDifference, int, int, int) {
	now := time.Now()
	localByOutTradeNo := make(map[string]model.PaymentOrder, len(localOrders))
	for _, order := range localOrders {
		localByOutTradeNo[order.OutTradeNo] = order
	}
	billSeen := make(map[string]struct{}, len(billRows))
	differences := make([]model.PaymentReconciliationDifference, 0)
	matched := 0
	successCount := 0
	refundCount := 0
	add := func(kind string, row wechatTradeBillRow, order *model.PaymentOrder, description string) {
		difference := model.PaymentReconciliationDifference{
			ID: newID(), RunID: runID, Type: kind, OutTradeNo: row.OutTradeNo,
			TransactionID: row.TransactionID, WechatAmountFen: row.AmountFen,
			WechatRefundFen: row.RefundAmountFen,
			Description:     description, CreatedAt: now,
		}
		if order != nil {
			difference.PaymentOrderID = order.ID
			difference.LocalAmountFen = order.AmountFen
			difference.LocalStatus = string(order.Status)
		}
		differences = append(differences, difference)
	}
	for _, row := range billRows {
		if row.IsRefund {
			refundCount++
			localOrder, err := s.repo.PaymentOrderByOutTradeNo(row.OutTradeNo)
			if err != nil {
				localOrder = nil
			}
			add("external_refund", row, localOrder, "检测到微信商户平台外部退款；系统不会自动扣回积分，请人工核对")
			continue
		}
		successCount++
		billSeen[row.OutTradeNo] = struct{}{}
		order, found := localByOutTradeNo[row.OutTradeNo]
		if !found {
			localOrder, err := s.repo.PaymentOrderByOutTradeNo(row.OutTradeNo)
			if err == nil {
				add("local_status_mismatch", row, localOrder, "微信账单已支付，但本地订单尚未处于成功到账状态")
			} else {
				add("wechat_order_missing_local", row, nil, "微信成功账单存在交易，但本地没有对应订单")
			}
			continue
		}
		rowMatched := true
		if order.AmountFen != row.AmountFen {
			add("amount_mismatch", row, &order, "微信账单金额与本地订单金额不一致")
			rowMatched = false
		}
		if order.TransactionID == nil || *order.TransactionID != row.TransactionID {
			add("transaction_mismatch", row, &order, "微信交易号与本地成功订单不一致")
			rowMatched = false
		}
		if rowMatched {
			matched++
		}
	}
	for _, order := range localOrders {
		if _, found := billSeen[order.OutTradeNo]; found {
			continue
		}
		row := wechatTradeBillRow{OutTradeNo: order.OutTradeNo, AmountFen: 0}
		if order.TransactionID != nil {
			row.TransactionID = *order.TransactionID
		}
		add("local_order_missing_wechat", row, &order, "本地订单已成功到账，但微信成功账单中不存在")
	}
	return differences, matched, successCount, refundCount
}

func (s *Service) failPaymentReconciliation(runID string, cause error) error {
	_ = s.repo.FailPaymentReconciliationRun(runID, truncateRunes(cause.Error(), 1000), time.Now())
	return WrapAppError(502, "微信交易账单对账失败", cause)
}

func parseWechatTradeBill(content []byte) ([]wechatTradeBillRow, error) {
	content = bytes.TrimPrefix(content, []byte{0xEF, 0xBB, 0xBF})
	reader := csv.NewReader(bytes.NewReader(content))
	reader.FieldsPerRecord = -1
	reader.LazyQuotes = true
	records, err := reader.ReadAll()
	if err != nil {
		return nil, fmt.Errorf("解析微信交易账单 CSV：%w", err)
	}
	headerIndex := -1
	columns := map[string]int{}
	for index, record := range records {
		for columnIndex, raw := range record {
			name := normalizeWechatBillField(raw)
			if name != "" {
				columns[name] = columnIndex
			}
		}
		if _, ok := columns["商户订单号"]; ok {
			if _, ok := columns["微信订单号"]; ok {
				headerIndex = index
				break
			}
		}
		columns = map[string]int{}
	}
	if headerIndex < 0 {
		return nil, errors.New("微信交易账单缺少订单号表头")
	}
	amountColumn, ok := columns["订单金额"]
	if !ok {
		amountColumn, ok = columns["应结订单金额"]
	}
	if !ok {
		return nil, errors.New("微信交易账单缺少订单金额表头")
	}
	rows := make([]wechatTradeBillRow, 0, len(records)-headerIndex-1)
	for _, record := range records[headerIndex+1:] {
		if len(record) == 0 || strings.HasPrefix(normalizeWechatBillField(record[0]), "总交易单数") {
			continue
		}
		outTradeNo := billField(record, columns["商户订单号"])
		transactionID := billField(record, columns["微信订单号"])
		if outTradeNo == "" || transactionID == "" {
			continue
		}
		amountFen, err := parseYuanFen(billField(record, amountColumn))
		if err != nil {
			return nil, fmt.Errorf("解析订单 %s 的账单金额：%w", outTradeNo, err)
		}
		refundID := billFieldByName(record, columns, "微信退款单号")
		refundAmount := int64(0)
		if rawRefundAmount := billFieldByName(record, columns, "退款金额"); rawRefundAmount != "" && rawRefundAmount != "0" && rawRefundAmount != "0.00" {
			refundAmount, err = parseYuanFen(rawRefundAmount)
			if err != nil {
				return nil, fmt.Errorf("解析订单 %s 的退款金额：%w", outTradeNo, err)
			}
		}
		tradeState := billFieldByName(record, columns, "交易状态")
		rows = append(rows, wechatTradeBillRow{
			AppID: billFieldByName(record, columns, "公众账号ID"), MerchantID: billFieldByName(record, columns, "商户号"),
			TransactionID: transactionID, OutTradeNo: outTradeNo,
			TradeState: tradeState, AmountFen: amountFen, IsRefund: refundID != "" || refundAmount > 0 || strings.Contains(strings.ToUpper(tradeState), "REFUND"),
			RefundID: refundID, RefundAmountFen: refundAmount,
		})
	}
	return rows, nil
}

func normalizeWechatBillField(value string) string {
	return strings.TrimSpace(strings.TrimPrefix(strings.TrimPrefix(value, "\ufeff"), "`"))
}

func billField(record []string, index int) string {
	if index < 0 || index >= len(record) {
		return ""
	}
	return normalizeWechatBillField(record[index])
}

func billFieldByName(record []string, columns map[string]int, name string) string {
	index, ok := columns[name]
	if !ok {
		return ""
	}
	return billField(record, index)
}

func parseYuanFen(value string) (int64, error) {
	value = strings.TrimSpace(strings.TrimPrefix(value, "¥"))
	if value == "" {
		return 0, errors.New("金额为空")
	}
	parts := strings.Split(value, ".")
	if len(parts) > 2 {
		return 0, errors.New("金额格式无效")
	}
	yuan, err := strconv.ParseInt(parts[0], 10, 64)
	if err != nil || yuan < 0 {
		return 0, errors.New("金额格式无效")
	}
	fraction := ""
	if len(parts) == 2 {
		fraction = parts[1]
	}
	if len(fraction) > 2 {
		return 0, errors.New("金额精度超过分")
	}
	fraction += strings.Repeat("0", 2-len(fraction))
	fen := int64(0)
	if fraction != "" {
		fen, err = strconv.ParseInt(fraction, 10, 64)
		if err != nil {
			return 0, errors.New("金额格式无效")
		}
	}
	return yuan*100 + fen, nil
}

func validateReconciliationDate(value string) (string, error) {
	location := paymentLocation()
	date, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(value), location)
	if err != nil {
		return "", BadAuthRequest("账单日期格式必须为 YYYY-MM-DD")
	}
	now := time.Now().In(location)
	today := time.Date(now.Year(), now.Month(), now.Day(), 0, 0, 0, 0, location)
	if !date.Before(today) || date.Before(today.AddDate(0, -3, 0)) {
		return "", BadAuthRequest("只能对账最近三个月内且早于今天的账单")
	}
	return date.Format("2006-01-02"), nil
}

func paymentLocation() *time.Location {
	location, err := time.LoadLocation("Asia/Shanghai")
	if err != nil {
		return time.FixedZone("Asia/Shanghai", 8*60*60)
	}
	return location
}

func (s *Service) startPaymentReconciliationScheduler(ctx context.Context) {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		s.runScheduledPaymentReconciliation(ctx)
		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				s.runScheduledPaymentReconciliation(ctx)
			}
		}
	})
}

func (s *Service) runScheduledPaymentReconciliation(ctx context.Context) {
	now := time.Now().In(paymentLocation())
	if now.Hour() < 10 || now.Hour() == 10 && now.Minute() < 15 {
		return
	}
	channels, err := s.repo.PaymentChannels()
	if err != nil {
		return
	}
	billDate := now.AddDate(0, 0, -1).Format("2006-01-02")
	seenMerchants := make(map[string]struct{})
	for _, channel := range channels {
		if channel.ActiveVersionID == "" {
			continue
		}
		version, err := s.repo.PaymentChannelVersion(channel.ActiveVersionID)
		if err != nil {
			continue
		}
		if _, seen := seenMerchants[version.MerchantID]; seen {
			continue
		}
		seenMerchants[version.MerchantID] = struct{}{}
		_, _ = s.runPaymentReconciliation(ctx, channel.ID, billDate, "", false)
	}
}
