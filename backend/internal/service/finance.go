package service

import (
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"

	"gorm.io/gorm"
)

const CreditScale int64 = 1_000_000

type WalletSummary struct {
	Account model.CreditAccount       `json:"account"`
	Entries []model.CreditLedgerEntry `json:"entries"`
	Total   int64                     `json:"total"`
	Page    int                       `json:"page"`
	Limit   int                       `json:"limit"`
	Policy  PublicCreditPolicy        `json:"policy"`
}

type RedeemBatchPage struct {
	Batches []model.RedeemBatch `json:"batches"`
	Total   int64               `json:"total"`
	Page    int                 `json:"page"`
	Limit   int                 `json:"limit"`
}

type AdminRedeemCodeDetail struct {
	ID                  string     `json:"id"`
	Code                string     `json:"code,omitempty"`
	CodeSuffix          string     `json:"codeSuffix"`
	Status              string     `json:"status"`
	RedeemedBy          string     `json:"redeemedBy,omitempty"`
	RedeemedUsername    string     `json:"redeemedUsername,omitempty"`
	RedeemedDisplayName string     `json:"redeemedDisplayName,omitempty"`
	RedeemedAt          *time.Time `json:"redeemedAt"`
	RedeemedIP          string     `json:"redeemedIp,omitempty"`
	ExpiresAt           *time.Time `json:"expiresAt"`
	AmountMicrocredits  int64      `json:"amountMicrocredits"`
}

type AdminRedeemCodePage struct {
	Batch              model.RedeemBatch       `json:"batch"`
	Codes              []AdminRedeemCodeDetail `json:"codes"`
	PlaintextAvailable bool                    `json:"plaintextAvailable"`
	Total              int64                   `json:"total"`
	Page               int                     `json:"page"`
	Limit              int                     `json:"limit"`
}

type BillingOrderPage struct {
	Orders []model.BillingOrder `json:"orders"`
	Total  int64                `json:"total"`
	Page   int                  `json:"page"`
	Limit  int                  `json:"limit"`
}

type CreateRedeemBatchRequest struct {
	AmountMicrocredits int64      `json:"amountMicrocredits"`
	Count              int        `json:"count"`
	Note               string     `json:"note"`
	ExpiresAt          *time.Time `json:"expiresAt"`
}

type CreateRedeemBatchResult struct {
	Batch model.RedeemBatch `json:"batch"`
	Codes []string          `json:"codes"`
}

type AdminCreditAdjustmentRequest struct {
	AmountMicrocredits int64  `json:"amountMicrocredits"`
	Note               string `json:"note"`
}

type ResolveBillingRequest struct {
	Action string `json:"action"`
	Note   string `json:"note"`
}

type ResolveBillingBatchRequest struct {
	IDs    []string `json:"ids"`
	Action string   `json:"action"`
	Note   string   `json:"note"`
}

type ResolveBillingBatchFailure struct {
	ID      string `json:"id"`
	Message string `json:"message"`
}

type ResolveBillingBatchResult struct {
	ResolvedCount int                          `json:"resolvedCount"`
	Failed        []ResolveBillingBatchFailure `json:"failed"`
}

type tokenBillingEstimate struct {
	InputTokens  int64
	OutputTokens int64
}

func (s *Service) Wallet(user *model.User, entryType string, page int, limit int) (*WalletSummary, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	if page <= 0 {
		page = 1
	}
	if limit <= 0 || limit > 100 {
		limit = 30
	}
	account, err := s.repo.CreditAccount(user.ID)
	if err != nil {
		return nil, err
	}
	entries, total, err := s.repo.CreditLedger(user.ID, strings.TrimSpace(entryType), limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	policy, err := s.publicCreditPolicy(user.ID)
	if err != nil {
		return nil, err
	}
	return &WalletSummary{Account: *account, Entries: entries, Total: total, Page: page, Limit: limit, Policy: policy}, nil
}

func (s *Service) RedeemCredits(user *model.User, code string, redeemedIP string) (*model.CreditAccount, error) {
	if user == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	code = strings.ToLower(strings.TrimSpace(code))
	if len(code) != 32 {
		return nil, BadAuthRequest("兑换码无效或已使用")
	}
	account, err := s.repo.RedeemCode(user.ID, hashRedeemCode(code), truncateRunes(strings.TrimSpace(redeemedIP), 64))
	if errors.Is(err, repository.ErrRedeemCodeInvalid) {
		return nil, BadAuthRequest("兑换码无效或已使用")
	}
	return account, err
}

func (s *Service) AdminCreateRedeemBatch(actor *model.User, req CreateRedeemBatchRequest) (*CreateRedeemBatchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if req.AmountMicrocredits <= 0 {
		return nil, BadAuthRequest("兑换码积分必须大于 0")
	}
	if req.Count <= 0 || req.Count > 5000 {
		return nil, BadAuthRequest("单批兑换码数量需为 1-5000")
	}
	if req.ExpiresAt != nil && !req.ExpiresAt.After(time.Now()) {
		return nil, BadAuthRequest("兑换码过期时间必须晚于当前时间")
	}
	batch := model.RedeemBatch{ID: newID(), AmountMicrocredits: req.AmountMicrocredits, Count: req.Count, Note: truncateRunes(strings.TrimSpace(req.Note), 500), CreatedBy: actor.ID, ExpiresAt: req.ExpiresAt}
	codes := make([]string, 0, req.Count)
	items := make([]model.RedeemCode, 0, req.Count)
	for range req.Count {
		plain, err := newRedeemCode()
		if err != nil {
			return nil, err
		}
		codes = append(codes, plain)
		items = append(items, model.RedeemCode{
			ID: newID(), BatchID: batch.ID, CodeHash: hashRedeemCode(plain), CodeSuffix: plain[len(plain)-4:],
			AmountMicrocredits: req.AmountMicrocredits, Status: model.RedeemCodeUnused, ExpiresAt: req.ExpiresAt,
		})
	}
	encodedCodes, err := json.Marshal(codes)
	if err != nil {
		return nil, err
	}
	batch.CodesCipher, err = s.encryptSettingSecret(string(encodedCodes))
	if err != nil {
		return nil, err
	}
	// SQLite 只有一个写入器；批次生成串行进入短事务，避免并发生成占满连接池拖住全站读取。
	s.redeemBatchMu.Lock()
	defer s.redeemBatchMu.Unlock()
	if err := s.repo.CreateRedeemBatch(&batch, items); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "redeem_batch.create", "redeem_batch", batch.ID, "创建兑换码批次", map[string]any{"count": batch.Count, "amountMicrocredits": batch.AmountMicrocredits}); err != nil {
		return nil, err
	}
	return &CreateRedeemBatchResult{Batch: batch, Codes: codes}, nil
}

func (s *Service) AdminRedeemCodePage(actor *model.User, batchID string, status string, page int, limit int) (*AdminRedeemCodePage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	batch, err := s.repo.RedeemBatch(strings.TrimSpace(batchID))
	if err != nil {
		return nil, err
	}
	page, limit = normalizeAdminPage(page, limit)
	rows, total, err := s.repo.AdminRedeemCodes(batch.ID, strings.TrimSpace(status), limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	plainCodes, err := s.redeemBatchPlainCodes(batch.CodesCipher)
	if err != nil {
		return nil, err
	}
	plainByHash := make(map[string]string, len(plainCodes))
	for _, code := range plainCodes {
		plainByHash[hashRedeemCode(code)] = code
	}
	now := time.Now()
	details := make([]AdminRedeemCodeDetail, 0, len(rows))
	for _, row := range rows {
		status := string(row.Status)
		if row.Status == model.RedeemCodeUnused && row.ExpiresAt != nil && !row.ExpiresAt.After(now) {
			status = "expired"
		}
		details = append(details, AdminRedeemCodeDetail{
			ID: row.ID, Code: plainByHash[row.CodeHash], CodeSuffix: row.CodeSuffix, Status: status,
			RedeemedBy: row.RedeemedBy, RedeemedUsername: row.RedeemedUsername, RedeemedDisplayName: row.RedeemedDisplayName,
			RedeemedAt: row.RedeemedAt, RedeemedIP: row.RedeemedIP, ExpiresAt: row.ExpiresAt, AmountMicrocredits: row.AmountMicrocredits,
		})
	}
	batch.CodesCipher = ""
	return &AdminRedeemCodePage{Batch: *batch, Codes: details, PlaintextAvailable: len(plainCodes) > 0, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) redeemBatchPlainCodes(ciphertext string) ([]string, error) {
	if strings.TrimSpace(ciphertext) == "" {
		return nil, nil
	}
	encoded, err := s.decryptSettingSecret(ciphertext)
	if err != nil {
		return nil, fmt.Errorf("兑换码批次密文无法解密：%w", err)
	}
	var codes []string
	if err := json.Unmarshal([]byte(encoded), &codes); err != nil {
		return nil, errors.New("兑换码批次密文内容无效")
	}
	return codes, nil
}

func (s *Service) AdminRedeemBatchPage(actor *model.User, query AdminListQuery) (*RedeemBatchPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	items, total, err := s.repo.AdminRedeemBatches(query.Keyword, query.Status, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &RedeemBatchPage{Batches: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) AdminAdjustCredits(actor *model.User, userID string, req AdminCreditAdjustmentRequest) (*model.CreditAccount, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if req.AmountMicrocredits == 0 {
		return nil, BadAuthRequest("调账积分不能为 0")
	}
	note := strings.TrimSpace(req.Note)
	if note == "" {
		return nil, BadAuthRequest("请填写调账原因")
	}
	if _, err := s.repo.User(userID); err != nil {
		return nil, err
	}
	account, err := s.repo.AdjustCredits(userID, actor.ID, req.AmountMicrocredits, truncateRunes(note, 500))
	if errors.Is(err, repository.ErrInsufficientCredits) {
		return nil, BadAuthRequest("用户可用积分不足，不能执行本次扣减")
	}
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "credits.adjust", "user", userID, "管理员调整用户积分", map[string]any{"amountMicrocredits": req.AmountMicrocredits, "note": truncateRunes(note, 500)}); err != nil {
		return nil, err
	}
	return account, nil
}

func (s *Service) AdminBillingOrderPage(actor *model.User, query AdminListQuery) (*BillingOrderPage, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.Limit)
	items, total, err := s.repo.AdminBillingOrders(query.Status, query.Keyword, limit, (page-1)*limit)
	if err != nil {
		return nil, err
	}
	return &BillingOrderPage{Orders: items, Total: total, Page: page, Limit: limit}, nil
}

func (s *Service) ResolveBillingOrder(actor *model.User, id string, req ResolveBillingRequest) (*model.BillingOrder, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	note := strings.TrimSpace(req.Note)
	if note == "" {
		return nil, BadAuthRequest("请填写核对依据")
	}
	action := strings.TrimSpace(req.Action)
	if action != "settle" && action != "refund" {
		return nil, BadAuthRequest("请选择结算或退款")
	}
	return s.resolveBillingOrder(actor, strings.TrimSpace(id), action, note)
}

func (s *Service) ResolveBillingOrders(actor *model.User, req ResolveBillingBatchRequest) (*ResolveBillingBatchResult, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	note := strings.TrimSpace(req.Note)
	if note == "" {
		return nil, BadAuthRequest("请填写核对依据")
	}
	action := strings.TrimSpace(req.Action)
	if action != "settle" && action != "refund" {
		return nil, BadAuthRequest("请选择结算或退款")
	}
	seen := make(map[string]struct{}, len(req.IDs))
	ids := make([]string, 0, len(req.IDs))
	for _, rawID := range req.IDs {
		id := strings.TrimSpace(rawID)
		if id == "" {
			return nil, BadAuthRequest("计费订单 ID 无效")
		}
		if _, exists := seen[id]; exists {
			continue
		}
		seen[id] = struct{}{}
		ids = append(ids, id)
	}
	if len(ids) == 0 {
		return nil, BadAuthRequest("请选择要处理的计费订单")
	}
	if len(ids) > 100 {
		return nil, BadAuthRequest("单次最多处理 100 条计费订单")
	}

	// 批量资金操作逐单提交并明确返回失败项，避免部分成功时给出整体成功的错误反馈。
	result := &ResolveBillingBatchResult{Failed: make([]ResolveBillingBatchFailure, 0)}
	for _, id := range ids {
		if _, err := s.resolveBillingOrder(actor, id, action, note); err != nil {
			result.Failed = append(result.Failed, ResolveBillingBatchFailure{ID: id, Message: err.Error()})
			continue
		}
		result.ResolvedCount++
	}
	return result, nil
}

func (s *Service) resolveBillingOrder(actor *model.User, id string, action string, note string) (*model.BillingOrder, error) {
	order, err := s.repo.BillingOrder(id)
	if err != nil {
		return nil, err
	}
	if order.Status != model.BillingStatusUncertain && order.Status != model.BillingStatusRunning && order.Status != model.BillingStatusReserved {
		return nil, BadAuthRequest("当前订单不需要人工核对")
	}
	switch action {
	case "settle":
		err = s.SettleBilling(id, order.ProviderRequestID)
	case "refund":
		err = s.RefundBilling(id, note)
	}
	if err != nil {
		return nil, err
	}
	if err := s.repo.RecordBillingResolution(id, actor.ID, truncateRunes(note, 500)); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "billing.resolve", "user", order.UserID, "人工核对用户计费订单", map[string]any{"billingOrderId": id, "action": action, "note": truncateRunes(note, 500)}); err != nil {
		return nil, err
	}
	return s.repo.BillingOrder(id)
}

func (s *Service) AdminDisableRedeemBatch(actor *model.User, batchID string) (int64, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return 0, err
	}
	if _, err := s.repo.RedeemBatch(strings.TrimSpace(batchID)); err != nil {
		return 0, err
	}
	count, err := s.repo.DisableRedeemBatch(batchID, time.Now())
	if err != nil {
		return 0, err
	}
	if count == 0 {
		return 0, BadAuthRequest("该批次没有可禁用的兑换码")
	}
	if err := s.appendAdminAudit(actor, "redeem_batch.disable", "redeem_batch", batchID, "禁用批次内全部未使用兑换码", map[string]any{"disabledCount": count}); err != nil {
		return 0, err
	}
	return count, nil
}

func (s *Service) AdminDisableRedeemCode(actor *model.User, batchID string, codeID string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	disabled, err := s.repo.DisableRedeemCode(batchID, codeID, time.Now())
	if err != nil {
		return err
	}
	if !disabled {
		return BadAuthRequest("兑换码不存在、已使用、已禁用或已过期")
	}
	return s.appendAdminAudit(actor, "redeem_code.disable", "redeem_code", codeID, "禁用单个兑换码", map[string]any{"batchId": batchID})
}

func (s *Service) taskBillingOrder(userID string, task *model.Task, input map[string]any) (*model.BillingOrder, error) {
	enabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, nil
	}
	if task.LogicalModelID != "" {
		return s.newLogicalModelBillingOrder(userID, task, input)
	}
	config, _ := input["config"].(map[string]any)
	if config == nil {
		return nil, nil
	}
	channelID := strings.TrimSpace(fmt.Sprint(config["channelId"]))
	if channelID == "" {
		channelID = systemChannelIDFromBaseURL(fmt.Sprint(config["baseUrl"]))
	}
	if channelID == "" {
		return nil, nil
	}
	modelKey := strings.TrimPrefix(strings.TrimSpace(fmt.Sprint(config["model"])), "models/")
	capability := normalizeCapability(fmt.Sprint(input["mode"]))
	if capability == "" {
		capability = capabilityFromTaskType(task.Type)
	}
	scene := firstNonEmpty(strings.TrimSpace(task.Operation), task.Type)
	return s.newBillingOrder(userID, task.ID, "task:"+task.ID+":"+newID(), channelID, modelKey, capability, scene, billingQuantity(capability, config["videoSeconds"]), estimateTaskBillingTokens(input, capability))
}

func (s *Service) newLogicalModelBillingOrder(userID string, task *model.Task, input map[string]any) (*model.BillingOrder, error) {
	logicalModel, err := s.repo.LogicalModel(task.LogicalModelID)
	if err != nil || (!logicalModel.Enabled && logicalModel.ArchivedAt == nil) || logicalModel.ActiveRevisionID != task.LogicalModelRevisionID {
		return nil, BadAuthRequest("所选模型计费配置已失效，请重新选择")
	}
	route, err := s.repo.LogicalModelRoute(task.RouteID)
	if err != nil || route.LogicalModelRevisionID != task.LogicalModelRevisionID || route.ChannelModelID != task.ChannelModelID {
		return nil, BadAuthRequest("所选模型供应线路已更新，请重新选择")
	}
	channelModel, err := s.repo.ChannelModel(task.ChannelModelID)
	if err != nil {
		return nil, BadAuthRequest("所选模型供应线路已更新，请重新选择")
	}
	config, _ := input["config"].(map[string]any)
	capability := normalizeCapability(fmt.Sprint(input["mode"]))
	if capability == "" {
		capability = capabilityFromTaskType(task.Type)
	}
	if logicalModel.PricePolicy == "channel" {
		order, priceErr := s.newBillingOrderWithPriceTier(userID, task.ID, "task:"+task.ID+":"+newID(), channelModel.ChannelID, channelModel.ModelKey, capability, firstNonEmpty(strings.TrimSpace(task.Operation), task.Type), billingQuantity(capability, config["videoSeconds"]), estimateTaskBillingTokens(input, capability), strings.TrimSpace(fmt.Sprint(config["priceTierId"])))
		if priceErr != nil {
			return nil, priceErr
		}
		// 用户账单只显示前台模型，供应线路仍保留在内部归属字段中。
		order.Model = logicalModel.Code
		return order, nil
	}
	if logicalModel.PricePolicy != "unified" {
		return nil, BadAuthRequest("当前模型价格策略无效")
	}
	quantity := int64(1)
	tokenEstimate := estimateTaskBillingTokens(input, capability)
	amount := int64(0)
	switch logicalModel.BillingMode {
	case "fixed_request":
		amount = logicalModel.UnitPriceMicrocredits
	case "per_second":
		quantity = billingQuantity(capability, config["videoSeconds"])
		if capability != "video" || quantity <= 0 {
			return nil, BadAuthRequest("当前模型按时长计费，但请求未提供有效时长")
		}
		amount, err = creditAmount(logicalModel.UnitPriceMicrocredits, quantity, 10_000)
	case "token":
		if channelModel.Capability != capability || !supportsTokenBilling(capability, channelModel.Protocol) {
			return nil, BadAuthRequest("当前供应线路不支持前台模型的 Token 计费方式")
		}
		pricing := &model.ChannelModel{InputTokenPriceMicrocredits: logicalModel.InputPriceMicrocredits, OutputTokenPriceMicrocredits: logicalModel.OutputPriceMicrocredits, CachedTokenPriceMicrocredits: logicalModel.CachedPriceMicrocredits}
		amount, err = tokenEstimateAmount(pricing, tokenEstimate, 10_000)
		quantity = tokenEstimate.InputTokens + tokenEstimate.OutputTokens
	default:
		return nil, BadAuthRequest("当前模型计费方式暂不支持")
	}
	if err != nil {
		return nil, err
	}
	if amount <= 0 {
		return nil, BadAuthRequest("当前模型尚未配置有效的用户价格")
	}
	revision, err := s.repo.LogicalModelRevision(task.LogicalModelRevisionID)
	if err != nil {
		return nil, err
	}
	return &model.BillingOrder{
		ID: newID(), UserID: userID, IdempotencyKey: "task:" + task.ID + ":" + newID(), TaskID: task.ID,
		ChannelID: channelModel.ChannelID, ChannelModelID: channelModel.ID, Model: logicalModel.Code, Capability: capability,
		Scene: truncateRunes(firstNonEmpty(strings.TrimSpace(task.Operation), task.Type), 80), BillingMode: logicalModel.BillingMode, PriceVersion: int64(revision.Version),
		UnitPriceMicrocredits: logicalModel.UnitPriceMicrocredits, MultiplierBasisPoints: 10_000, Quantity: quantity, AmountMicrocredits: amount,
		ReservedAmountMicrocredits: amount, InputTokenPriceMicrocredits: logicalModel.InputPriceMicrocredits,
		OutputTokenPriceMicrocredits: logicalModel.OutputPriceMicrocredits, CachedTokenPriceMicrocredits: logicalModel.CachedPriceMicrocredits,
		Status: model.BillingStatusReserved,
	}, nil
}

func (s *Service) ReserveProxyBilling(userID string, channelID string, modelKey string, capability string, scene string, idempotencyKey string, quantity int64) (*model.BillingOrder, error) {
	return s.ReserveProxyBillingWithBody(userID, channelID, modelKey, capability, scene, idempotencyKey, quantity, nil)
}

func (s *Service) ReserveProxyBillingWithBody(userID string, channelID string, modelKey string, capability string, scene string, idempotencyKey string, quantity int64, requestBody []byte) (*model.BillingOrder, error) {
	enabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return nil, err
	}
	if !enabled {
		return nil, nil
	}
	if strings.TrimSpace(idempotencyKey) == "" {
		idempotencyKey = newID()
	}
	order, err := s.newBillingOrder(userID, "", "proxy:"+idempotencyKey, channelID, modelKey, capability, firstNonEmpty(strings.TrimSpace(scene), "system_proxy"), quantity, estimateProxyTokens(requestBody))
	if err != nil {
		return nil, err
	}
	if err := s.repo.ReserveBillingOrder(order); err != nil {
		if errors.Is(err, repository.ErrInsufficientCredits) {
			return nil, BadAuthRequest("积分不足，请先使用兑换码充值")
		}
		return nil, err
	}
	return order, nil
}

func (s *Service) newBillingOrder(userID string, taskID string, idempotencyKey string, channelID string, modelKey string, capability string, scene string, requestedQuantity int64, tokenEstimate tokenBillingEstimate) (*model.BillingOrder, error) {
	return s.newBillingOrderWithPriceTier(userID, taskID, idempotencyKey, channelID, modelKey, capability, scene, requestedQuantity, tokenEstimate, "")
}

func (s *Service) newBillingOrderWithPriceTier(userID string, taskID string, idempotencyKey string, channelID string, modelKey string, capability string, scene string, requestedQuantity int64, tokenEstimate tokenBillingEstimate, priceTierID string) (*model.BillingOrder, error) {
	item, err := s.repo.ChannelModelByKey(channelID, modelKey)
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, BadAuthRequest("当前模型暂时不可用，请重新选择")
	}
	if err != nil {
		return nil, err
	}
	tier := channelModelPriceTierForBilling(*item, priceTierID, capability)
	if tier == nil {
		return nil, BadAuthRequest("当前模型尚未配置所选规格的用户积分价格")
	}
	quantity := int64(1)
	amount := int64(0)
	switch tier.BillingMode {
	case "fixed_request":
	case "per_second":
		if item.Capability != "video" || capability != "video" {
			return nil, BadAuthRequest("按秒计费仅适用于视频生成")
		}
		if requestedQuantity <= 0 {
			return nil, BadAuthRequest("视频生成时长无效，无法按秒计费")
		}
		quantity = requestedQuantity
	case "token":
		if !supportsTokenBilling(item.Capability, item.Protocol) || item.Capability != capability {
			return nil, BadAuthRequest("Token 计费仅支持文本生成和火山方舟视频生成")
		}
		if capability == "text" && (tokenEstimate.InputTokens <= 0 || tokenEstimate.OutputTokens <= 0) {
			return nil, BadAuthRequest("无法估算文本 Token 用量")
		}
		if capability == "video" && tokenEstimate.OutputTokens <= 0 {
			return nil, BadAuthRequest("无法估算火山方舟视频 Token 用量")
		}
		quantity = tokenEstimate.InputTokens + tokenEstimate.OutputTokens
	default:
		return nil, BadAuthRequest("当前模型计费方式暂不支持")
	}
	policy, err := s.creditPolicy()
	if err != nil {
		return nil, err
	}
	multiplierBPS := policy.DefaultMultiplierBPS
	if configured := policy.ModelMultiplierBPS[modelKey]; configured > 0 {
		multiplierBPS = configured
	}
	if tier.BillingMode == "token" {
		amount, err = tokenEstimateAmount(&model.ChannelModel{InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits, OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits}, tokenEstimate, multiplierBPS)
	} else {
		amount, err = creditAmount(tier.UnitPriceMicrocredits, quantity, multiplierBPS)
	}
	if err != nil {
		return nil, err
	}
	return &model.BillingOrder{
		ID: newID(), UserID: userID, IdempotencyKey: idempotencyKey, TaskID: taskID,
		ChannelID: channelID, ChannelModelID: item.ID, PriceTierID: tier.ID, PriceTierVersion: tier.PriceVersion, PriceSelectorJSON: tier.SelectorJSON, Model: modelKey, Capability: capability,
		Scene: truncateRunes(scene, 80), BillingMode: tier.BillingMode, PriceVersion: item.PriceVersion,
		UnitPriceMicrocredits: tier.UnitPriceMicrocredits, MultiplierBasisPoints: multiplierBPS, Quantity: quantity, AmountMicrocredits: amount,
		ReservedAmountMicrocredits: amount, InputTokenPriceMicrocredits: tier.InputTokenPriceMicrocredits,
		OutputTokenPriceMicrocredits: tier.OutputTokenPriceMicrocredits, CachedTokenPriceMicrocredits: tier.CachedTokenPriceMicrocredits,
		Status: model.BillingStatusReserved,
	}, nil
}

func channelModelPriceTierForBilling(channelModel model.ChannelModel, priceTierID string, capability string) *model.ChannelModelPriceTier {
	if priceTierID != "" {
		for index := range channelModel.PriceTiers {
			tier := &channelModel.PriceTiers[index]
			if tier.ID == priceTierID && tier.Enabled && tier.PriceConfigured {
				return tier
			}
		}
		return nil
	}
	return channelModelPriceTierForIntent(channelModel, ModelRequestIntent{Capability: capability, Options: map[string]any{}})
}

func estimateTaskTokens(input map[string]any) tokenBillingEstimate {
	encoded, _ := json.Marshal(input)
	return tokenBillingEstimate{InputTokens: estimatedTokens(encoded), OutputTokens: maxOutputTokens(input)}
}

func estimateTaskBillingTokens(input map[string]any, capability string) tokenBillingEstimate {
	if capability == "video" {
		return estimateArkVideoTokens(input)
	}
	return estimateTaskTokens(input)
}

// 方舟视频成功后才返回真实 completion_tokens；创建任务前按官方像素帧公式预授权，
// 并保留少量帧率/取整余量，实际结算时会按 usage 自动退回差额。
func estimateArkVideoTokens(input map[string]any) tokenBillingEstimate {
	config, _ := input["config"].(map[string]any)
	if config == nil {
		return tokenBillingEstimate{}
	}
	durationSeconds, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(config["videoSeconds"])), 10, 64)
	if err != nil || durationSeconds <= 0 {
		return tokenBillingEstimate{}
	}
	pixels := arkVideoOutputPixels(fmt.Sprint(config["vquality"]), fmt.Sprint(config["size"]), fmt.Sprint(config["model"]))
	if pixels <= 0 {
		return tokenBillingEstimate{}
	}

	if durationSeconds > (1<<63-1)/1000 {
		return tokenBillingEstimate{}
	}
	totalDurationMillis := durationSeconds * 1000
	referenceCount := int64(0)
	if references, ok := input["referenceVideos"].([]any); ok && len(references) > 0 {
		referenceCount = int64(len(references))
		knownDurationMillis := int64(0)
		unknownDuration := false
		for _, raw := range references {
			media, _ := raw.(map[string]any)
			durationMillis := firstInt64(media, "durationMs")
			if durationMillis <= 0 {
				unknownDuration = true
				continue
			}
			knownDurationMillis = min(15_000, knownDurationMillis+min(durationMillis, int64(15_000)))
		}
		// 方舟参考视频总时长上限为 15 秒；缺少媒体元数据时按上限预留。
		if unknownDuration {
			knownDurationMillis = 15_000
		}
		totalDurationMillis += knownDurationMillis
	}
	frames := (totalDurationMillis*24+999)/1000 + 1 + referenceCount
	if pixels > (1<<63-1-1023)/frames {
		return tokenBillingEstimate{}
	}
	tokens := (pixels*frames + 1023) / 1024
	if tokens > (1<<63-1-99)/110 {
		return tokenBillingEstimate{}
	}
	return tokenBillingEstimate{OutputTokens: (tokens*110 + 99) / 100}
}

func arkVideoOutputPixels(resolution string, ratio string, modelName string) int64 {
	resolution = normalizeSeedanceResolution(resolution, modelName)
	ratio = normalizeSeedanceRatio(ratio)
	pixelsByRatio := map[string]map[string]int64{
		"480p": {
			"16:9": 864 * 496, "4:3": 752 * 560, "1:1": 640 * 640,
			"3:4": 560 * 752, "9:16": 496 * 864, "21:9": 992 * 432,
		},
		"720p": {
			"16:9": 1280 * 720, "4:3": 1112 * 834, "1:1": 960 * 960,
			"3:4": 834 * 1112, "9:16": 720 * 1280, "21:9": 1470 * 630,
		},
		"1080p": {
			"16:9": 1920 * 1080, "4:3": 1664 * 1248, "1:1": 1440 * 1440,
			"3:4": 1248 * 1664, "9:16": 1080 * 1920, "21:9": 2206 * 946,
		},
	}
	values := pixelsByRatio[resolution]
	if resolution == "2160p" {
		values = make(map[string]int64, len(pixelsByRatio["1080p"]))
		for key, value := range pixelsByRatio["1080p"] {
			values[key] = value * 4
		}
	}
	if len(values) == 0 {
		return 0
	}
	if ratio != "adaptive" {
		return values[ratio]
	}
	var largest int64
	for _, value := range values {
		largest = max(largest, value)
	}
	return largest
}

func estimateProxyTokens(body []byte) tokenBillingEstimate {
	var payload map[string]any
	_ = json.Unmarshal(body, &payload)
	return tokenBillingEstimate{InputTokens: estimatedTokens(body), OutputTokens: maxOutputTokens(payload)}
}

func estimatedTokens(value []byte) int64 {
	count := int64((len([]rune(string(value))) + 3) / 4)
	if count < 1 {
		return 1
	}
	return count
}

func maxOutputTokens(payload map[string]any) int64 {
	for _, key := range []string{"max_output_tokens", "max_tokens", "maxOutputTokens"} {
		value, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(payload[key])), 10, 64)
		if err == nil && value > 0 {
			if value > 131072 {
				return 131072
			}
			return value
		}
	}
	if config, ok := payload["config"].(map[string]any); ok {
		return maxOutputTokens(config)
	}
	return 4096
}

// Token 单价按每百万 Token 配置；预授权使用输入价估算缓存 Token，真实结算再按 usage 拆分。
func tokenEstimateAmount(item *model.ChannelModel, estimate tokenBillingEstimate, multiplierBPS int64) (int64, error) {
	if item == nil || estimate.InputTokens < 0 || estimate.OutputTokens <= 0 || multiplierBPS <= 0 {
		return 0, errors.New("Token 计费参数无效")
	}
	inputAmount, ok := safeTokenProduct(estimate.InputTokens, item.InputTokenPriceMicrocredits)
	if !ok {
		return 0, errors.New("Token 计费金额溢出")
	}
	outputAmount, ok := safeTokenProduct(estimate.OutputTokens, item.OutputTokenPriceMicrocredits)
	if !ok || inputAmount > 1<<63-1-outputAmount {
		return 0, errors.New("Token 计费金额溢出")
	}
	base := inputAmount + outputAmount
	if base > (1<<63-1-9_999_999_999)/multiplierBPS {
		return 0, errors.New("Token 计费金额溢出")
	}
	amount := (base*multiplierBPS + 9_999_999_999) / 10_000_000_000
	if amount <= 0 {
		return 0, errors.New("Token 计费金额必须大于 0")
	}
	return amount, nil
}

func safeTokenProduct(tokens int64, price int64) (int64, bool) {
	if tokens < 0 || price < 0 || (tokens > 0 && price > (1<<63-1)/tokens) {
		return 0, false
	}
	return tokens * price, true
}

func billingQuantity(capability string, value any) int64 {
	if capability != "video" {
		return 1
	}
	quantity, err := strconv.ParseInt(strings.TrimSpace(fmt.Sprint(value)), 10, 64)
	if err != nil || quantity <= 0 {
		return 0
	}
	return quantity
}

func (s *Service) MarkBillingRunning(orderID string) error {
	return s.taskBilling().MarkBillingRunning(orderID)
}

func (s *Service) SettleBilling(orderID string, providerRequestID string) error {
	return s.taskBilling().SettleBilling(orderID, providerRequestID)
}

func (s *Service) RefundBilling(orderID string, errorText string) error {
	return s.taskBilling().RefundBilling(orderID, errorText)
}

func (s *Service) MarkBillingUncertain(orderID string, errorText string) error {
	return s.taskBilling().MarkBillingUncertain(orderID, errorText)
}

func (s *Service) BillingFailureRequiresReview(orderID string, taskID string, err error) bool {
	return s.taskBilling().BillingFailureRequiresReview(orderID, taskID, err)
}

func newRedeemCode() (string, error) {
	var raw [16]byte
	if _, err := rand.Read(raw[:]); err != nil {
		return "", err
	}
	raw[6] = (raw[6] & 0x0f) | 0x40
	raw[8] = (raw[8] & 0x3f) | 0x80
	return hex.EncodeToString(raw[:]), nil
}

func hashRedeemCode(code string) string {
	sum := sha256.Sum256([]byte(strings.ToLower(strings.TrimSpace(code))))
	return hex.EncodeToString(sum[:])
}
