package service

import (
	"context"
	"errors"
	"fmt"
	"net/http"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/payment"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

var paymentBillLocation = time.FixedZone("Asia/Shanghai", 8*60*60)

type RunPaymentReconciliationRequest struct {
	ProviderID string `json:"providerId"`
	BillDate   string `json:"billDate"`
}

type AdminPaymentReconciliationPage struct {
	Runs  []model.PaymentReconciliationRun `json:"runs"`
	Total int64                            `json:"total"`
	Page  int                              `json:"page"`
	Limit int                              `json:"limit"`
}

type AdminPaymentReconciliationItemPage struct {
	Run   model.PaymentReconciliationRun    `json:"run"`
	Items []model.PaymentReconciliationItem `json:"items"`
	Total int64                             `json:"total"`
	Page  int                               `json:"page"`
	Limit int                               `json:"limit"`
}

func (s *Service) RunPaymentReconciliation(ctx context.Context, actor *model.User, request RunPaymentReconciliationRequest) (*model.PaymentReconciliationRun, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.runPaymentReconciliation(ctx, actor, strings.TrimSpace(request.ProviderID), strings.TrimSpace(request.BillDate))
}

func (s *Service) runPaymentReconciliation(ctx context.Context, actor *model.User, providerID, billDateValue string) (*model.PaymentReconciliationRun, error) {
	provider, ok := s.paymentRegistry.Get(providerID)
	if !ok {
		return nil, BadAuthRequest("未知支付渠道")
	}
	billDate, err := parsePaymentBillDate(billDateValue)
	if err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	config, err := s.repo.LatestPaymentProviderConfig(providerID)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("支付渠道尚未配置")
	}
	if err != nil {
		return nil, err
	}
	values, err := s.decryptPaymentConfig(config)
	if err != nil {
		return nil, err
	}
	if err := provider.ValidateConfig(values); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	startedBy := "system"
	if actor != nil {
		startedBy = actor.ID
	}
	run, started, err := s.repo.BeginPaymentReconciliation(&model.PaymentReconciliationRun{
		ID: newID(), ProviderID: providerID, ConfigID: config.ID, BillDate: billDateValue,
		Status: model.PaymentReconciliationRunning, StartedBy: startedBy, StartedAt: time.Now(),
	})
	if err != nil || !started {
		return run, err
	}
	if actor != nil {
		if err := s.appendAdminAudit(actor, "payment_reconciliation.run", "payment_provider", providerID, "执行支付渠道对账", map[string]any{"billDate": billDateValue, "runId": run.ID}); err != nil {
			_ = s.repo.FailPaymentReconciliation(run.ID, safePaymentError(err))
			return nil, err
		}
	}

	start := billDate.In(paymentBillLocation)
	end := start.AddDate(0, 0, 1)
	localCredited, err := s.repo.CreditedPaymentOrdersBetween(providerID, start, end)
	if err != nil {
		return s.failPaymentReconciliation(run, err)
	}
	records, err := provider.DownloadTradeBill(ctx, values, billDate)
	if errors.Is(err, payment.ErrTradeBillNotFound) && len(localCredited) == 0 {
		candidateCount, countErr := s.repo.UnresolvedPaymentOrderCandidateCountOverlapping(providerID, start, end)
		if countErr != nil {
			return s.failPaymentReconciliation(run, countErr)
		}
		if candidateCount == 0 {
			records = []payment.BillRecord{}
			err = nil
		}
	}
	if err != nil {
		return s.failPaymentReconciliation(run, err)
	}

	items, matched, recovered, failed, err := s.comparePaymentReconciliation(ctx, provider, values, run, billDate, records, localCredited)
	if err != nil {
		return s.failPaymentReconciliation(run, err)
	}
	if err := s.repo.CompletePaymentReconciliation(run.ID, items, matched, recovered, failed); err != nil {
		return s.failPaymentReconciliation(run, err)
	}
	return s.repo.PaymentReconciliationRun(run.ID)
}

func (s *Service) comparePaymentReconciliation(ctx context.Context, provider payment.Provider, values payment.Config, run *model.PaymentReconciliationRun, billDate time.Time, records []payment.BillRecord, localCredited []model.PaymentOrder) ([]model.PaymentReconciliationItem, int, int, int, error) {
	items := make([]model.PaymentReconciliationItem, 0, len(records)+len(localCredited))
	seen := make(map[string]struct{}, len(records))
	matched, recovered, failed := 0, 0, 0
	for _, record := range records {
		merchantOrderNo := strings.TrimSpace(record.MerchantOrderNo)
		if merchantOrderNo == "" {
			continue
		}
		if _, duplicate := seen[merchantOrderNo]; duplicate {
			continue
		}
		seen[merchantOrderNo] = struct{}{}
		item := model.PaymentReconciliationItem{
			ID: newID(), RunID: run.ID, ProviderID: run.ProviderID,
			MerchantOrderNo: merchantOrderNo, ProviderTradeNo: strings.TrimSpace(record.ProviderTradeNo),
			AmountFen: record.AmountFen, Currency: record.Currency, CreatedAt: time.Now(),
		}
		order, err := s.repo.PaymentOrderByMerchant(run.ProviderID, merchantOrderNo)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			item.Result = model.PaymentReconciliationLocalOrderNotFound
			item.Detail = "渠道账单存在成功交易，但本地订单不存在"
			items = append(items, item)
			failed++
			continue
		}
		if err != nil {
			return nil, 0, 0, 0, err
		}
		item.PaymentOrderID = order.ID
		if record.AmountFen != order.AmountFen || record.Currency != order.Currency {
			item.Result = model.PaymentReconciliationAmountMismatch
			item.Detail = fmt.Sprintf("渠道金额 %d %s，本地金额 %d %s", record.AmountFen, record.Currency, order.AmountFen, order.Currency)
			items = append(items, item)
			failed++
			continue
		}
		if order.ProviderTradeNo != nil && *order.ProviderTradeNo != "" && *order.ProviderTradeNo != record.ProviderTradeNo {
			item.Result = model.PaymentReconciliationTradeNoMismatch
			item.Detail = "渠道交易号与本地已记录交易号不一致"
			items = append(items, item)
			failed++
			continue
		}
		if order.Status == model.PaymentOrderCredited {
			item.Result = model.PaymentReconciliationMatched
			item.Resolved = true
			items = append(items, item)
			matched++
			continue
		}

		// A downloaded bill is a reconciliation hint, not sufficient payment
		// authorization. This is especially important for Alipay bill URLs that
		// may use the provider-documented HTTP download host. Confirm every
		// recovery through the signed API response before granting credits.
		confirmed, confirmErr := provider.QueryOrder(ctx, values, payment.QueryRequest{MerchantOrderNo: merchantOrderNo})
		if confirmErr != nil {
			item.Result = model.PaymentReconciliationCreditFailed
			item.Detail = "渠道账单显示已支付，但签名查单确认失败：" + safePaymentReconciliationError(confirmErr)
			items = append(items, item)
			failed++
			continue
		}
		if strings.TrimSpace(confirmed.MerchantOrderNo) != merchantOrderNo || !confirmed.Paid {
			item.Result = model.PaymentReconciliationCreditFailed
			item.Detail = "渠道账单显示已支付，但签名查单未确认该订单已支付"
			items = append(items, item)
			failed++
			continue
		}
		if confirmed.AmountFen != order.AmountFen || confirmed.Currency != order.Currency {
			item.Result = model.PaymentReconciliationAmountMismatch
			item.Detail = fmt.Sprintf("签名查单金额 %d %s，本地金额 %d %s", confirmed.AmountFen, confirmed.Currency, order.AmountFen, order.Currency)
			items = append(items, item)
			failed++
			continue
		}
		if strings.TrimSpace(confirmed.ProviderTradeNo) == "" || strings.TrimSpace(confirmed.ProviderTradeNo) != strings.TrimSpace(record.ProviderTradeNo) {
			item.Result = model.PaymentReconciliationTradeNoMismatch
			item.Detail = "渠道账单交易号与签名查单交易号不一致"
			items = append(items, item)
			failed++
			continue
		}
		paidAt := confirmed.PaidAt
		if paidAt.IsZero() {
			paidAt = record.PaidAt
		}
		if paidAt.IsZero() {
			paidAt = billDate.Add(12 * time.Hour)
		}
		_, _, creditErr := s.repo.CompletePaymentOrder(run.ProviderID, merchantOrderNo, repository.PaymentEvidence{
			ProviderTradeNo: confirmed.ProviderTradeNo, ProviderStatus: confirmed.ProviderStatus,
			AmountFen: confirmed.AmountFen, Currency: confirmed.Currency, PaidAt: paidAt,
		})
		if creditErr != nil {
			item.Result = model.PaymentReconciliationCreditFailed
			item.Detail = "渠道账单确认已支付，但自动补发积分失败：" + safePaymentError(creditErr)
			items = append(items, item)
			failed++
			continue
		}
		item.Result = model.PaymentReconciliationRecovered
		item.Resolved = true
		item.Detail = "已根据渠道账单自动补发积分"
		items = append(items, item)
		recovered++
	}
	for _, order := range localCredited {
		if _, ok := seen[order.MerchantOrderNo]; ok {
			continue
		}
		tradeNo := ""
		if order.ProviderTradeNo != nil {
			tradeNo = *order.ProviderTradeNo
		}
		items = append(items, model.PaymentReconciliationItem{
			ID: newID(), RunID: run.ID, ProviderID: run.ProviderID, PaymentOrderID: order.ID,
			MerchantOrderNo: order.MerchantOrderNo, ProviderTradeNo: tradeNo,
			AmountFen: order.AmountFen, Currency: order.Currency,
			Result: model.PaymentReconciliationProviderRecordMissing,
			Detail: "本地订单已入账，但渠道成功交易账单中未找到对应记录", CreatedAt: time.Now(),
		})
		failed++
	}
	return items, matched, recovered, failed, nil
}

func (s *Service) failPaymentReconciliation(run *model.PaymentReconciliationRun, cause error) (*model.PaymentReconciliationRun, error) {
	if run != nil {
		_ = s.repo.FailPaymentReconciliation(run.ID, safePaymentReconciliationError(cause))
		if latest, err := s.repo.PaymentReconciliationRun(run.ID); err == nil {
			run = latest
		}
	}
	return run, WrapAppError(http.StatusBadGateway, "支付渠道对账失败，请稍后重试", cause)
}

func safePaymentReconciliationError(err error) string {
	if err == nil {
		return ""
	}
	if errors.Is(err, payment.ErrTradeBillNotFound) {
		return "TRADE_BILL_NOT_FOUND"
	}
	var providerErr *payment.ProviderError
	if errors.As(err, &providerErr) && strings.TrimSpace(providerErr.Code) != "" {
		return truncateRunes(providerErr.Code, 1000)
	}
	// Reconciliation runs are admin-only diagnostics. Parser and persistence
	// errors contain no provider credentials and are more actionable than only
	// storing their Go concrete type.
	return truncateRunes(strings.TrimSpace(err.Error()), 1000)
}

func (s *Service) AdminPaymentReconciliationPage(actor *model.User, providerID, status string, page, limit int) (*AdminPaymentReconciliationPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	runs, total, err := s.repo.AdminPaymentReconciliationRuns(providerID, status, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &AdminPaymentReconciliationPage{Runs: runs, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminPaymentReconciliationItems(actor *model.User, runID, result string, page, limit int) (*AdminPaymentReconciliationItemPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	run, err := s.repo.PaymentReconciliationRun(runID)
	if err != nil {
		return nil, err
	}
	items, total, err := s.repo.PaymentReconciliationItems(run.ID, result, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &AdminPaymentReconciliationItemPage{Run: *run, Items: items, Total: total, Page: page, Limit: limit}, nil
}

func parsePaymentBillDate(value string) (time.Time, error) {
	parsed, err := time.ParseInLocation("2006-01-02", strings.TrimSpace(value), paymentBillLocation)
	if err != nil {
		return time.Time{}, errors.New("账单日期格式必须为 YYYY-MM-DD")
	}
	today := time.Now().In(paymentBillLocation)
	today = time.Date(today.Year(), today.Month(), today.Day(), 0, 0, 0, 0, paymentBillLocation)
	if !parsed.Before(today) {
		return time.Time{}, errors.New("只能对账昨天及更早的账单")
	}
	if parsed.Before(today.AddDate(0, -3, 0)) {
		return time.Time{}, errors.New("首期仅支持最近三个月的账单对账")
	}
	return parsed, nil
}

func (s *Service) maybeRunDailyPaymentReconciliation(ctx context.Context) {
	now := time.Now().In(paymentBillLocation)
	if now.Hour() < 10 || (now.Hour() == 10 && now.Minute() < 15) {
		return
	}
	billDate := now.AddDate(0, 0, -1).Format("2006-01-02")
	for _, descriptor := range s.paymentRegistry.Descriptors() {
		config, err := s.repo.LatestPaymentProviderConfig(descriptor.ID)
		if err != nil {
			continue
		}
		// Disabling a channel stops new orders, but must not stop T+1
		// reconciliation for payments created before it was disabled.
		provider, ok := s.paymentRegistry.Get(descriptor.ID)
		if !ok {
			continue
		}
		values, err := s.decryptPaymentConfig(config)
		if err != nil || provider.ValidateConfig(values) != nil {
			continue
		}
		existing, err := s.repo.PaymentReconciliationRunByDate(descriptor.ID, billDate)
		if err == nil {
			if existing.Status == model.PaymentReconciliationCompleted || (existing.Status == model.PaymentReconciliationRunning && existing.UpdatedAt.After(time.Now().Add(-30*time.Minute))) || (existing.Status == model.PaymentReconciliationFailed && existing.UpdatedAt.After(time.Now().Add(-30*time.Minute))) {
				continue
			}
		} else if !errors.Is(err, gorm.ErrRecordNotFound) {
			continue
		}
		providerContext, cancel := context.WithTimeout(ctx, 2*time.Minute)
		if _, err := s.runPaymentReconciliation(providerContext, nil, descriptor.ID, billDate); err != nil {
			// The persisted run contains a safe error code. The worker retries
			// failed T+1 runs after the cooldown above.
		}
		cancel()
	}
}
