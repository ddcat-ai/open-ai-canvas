// 充值商品：前台可购买的积分档位、存储空间档位与管理端增改。

package app

import (
	"fmt"
	"strings"
	"time"

	"yingce/backend/internal/model"
)

func (s *Service) TopupProducts(actor *model.User) ([]model.TopupProduct, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	creditsEnabled, err := s.FeatureEnabled(FeatureCredits)
	if err != nil {
		return nil, err
	}
	products, err := s.repo.TopupProducts(false)
	if err != nil {
		return nil, err
	}
	// 积分功能关闭时只隐藏积分商品，存储空间商品照常售卖。
	visible := make([]model.TopupProduct, 0, len(products))
	for _, product := range products {
		if topupProductKind(product.Kind) == model.TopupProductKindCredits && !creditsEnabled {
			continue
		}
		visible = append(visible, product)
	}
	settings, err := s.paymentSettings()
	if err != nil {
		return nil, err
	}
	sortTopupProductsByCurrency(visible, settings.DefaultCurrency)
	return decorateTopupProducts(visible, time.Now()), nil
}

func (s *Service) AdminTopupProducts(actor *model.User) ([]model.TopupProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	products, err := s.repo.TopupProducts(true)
	if err != nil {
		return nil, err
	}
	return decorateTopupProducts(products, time.Now()), nil
}

func decorateTopupProducts(products []model.TopupProduct, now time.Time) []model.TopupProduct {
	for index := range products {
		product := &products[index]
		product.Kind = topupProductKind(product.Kind)
		if product.SaleStrategy == "" {
			product.SaleStrategy = model.TopupSaleStrategyUnlimited
		}
		product.CanPurchase = product.Enabled
		product.SaleStatus = "on_sale"
		if !product.Enabled {
			product.CanPurchase = false
			product.SaleStatus = "disabled"
		} else if product.SaleStrategy == model.TopupSaleStrategyInventory && product.StockRemaining <= 0 {
			product.CanPurchase = false
			product.SaleStatus = "sold_out"
		} else if product.SaleStrategy == model.TopupSaleStrategyTimed {
			if product.SaleStartAt != nil && now.Before(*product.SaleStartAt) {
				product.CanPurchase = false
				product.SaleStatus = "upcoming"
			} else if product.SaleEndAt != nil && !now.Before(*product.SaleEndAt) {
				product.CanPurchase = false
				product.SaleStatus = "ended"
			}
		}
	}
	return products
}

func (s *Service) CreateTopupProduct(actor *model.User, request TopupProductRequest) (*model.TopupProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if strings.TrimSpace(request.Currency) == "" {
		settings, settingsErr := s.paymentSettings()
		if settingsErr != nil {
			return nil, settingsErr
		}
		request.Currency = settings.DefaultCurrency
	}
	product, err := topupProductFromRequest(newID(), actor.ID, request, 0, 0)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateTopupProduct(product); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "topup_product.create", "topup_product", product.ID, "创建充值商品", map[string]any{"kind": product.Kind, "amountFen": product.AmountFen, "currency": product.Currency, "creditsMicrocredits": product.CreditsMicrocredits, "storageBytes": product.StorageBytes, "storageDurationDays": product.StorageDurationDays, "saleStrategy": product.SaleStrategy}); err != nil {
		return nil, err
	}
	return product, nil
}

func (s *Service) UpdateTopupProduct(actor *model.User, id string, request TopupProductRequest) (*model.TopupProduct, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	id = strings.TrimSpace(id)
	var product *model.TopupProduct
	// 已售数量必须在锁住商品行之后计算，否则会覆盖并发下单扣减或关单退回的库存。
	err := s.repo.UpdateTopupProduct(id, func(existing *model.TopupProduct) (*model.TopupProduct, error) {
		// 类型决定发放的权益，已上架商品不允许改类型，避免历史订单与后台列表含义错位。
		if topupProductKind(request.Kind) != topupProductKind(existing.Kind) {
			return nil, BadAuthRequest("商品类型创建后不能修改，请新建商品")
		}
		if strings.TrimSpace(request.Currency) == "" {
			request.Currency = firstNonEmpty(existing.Currency, model.PriceCurrencyCNY)
		}
		consumed := existing.StockTotal - existing.StockRemaining
		if existing.SaleStrategy != model.TopupSaleStrategyInventory {
			consumed = 0
		}
		built, buildErr := topupProductFromRequest(id, actor.ID, request, existing.StockTotal, consumed)
		if buildErr != nil {
			return nil, buildErr
		}
		product = built
		return built, nil
	})
	if err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "topup_product.update", "topup_product", product.ID, "更新充值商品", map[string]any{"kind": product.Kind, "enabled": product.Enabled, "saleStrategy": product.SaleStrategy}); err != nil {
		return nil, err
	}
	return s.repo.TopupProduct(product.ID)
}

func topupProductFromRequest(id, actorID string, request TopupProductRequest, stockArgs ...int64) (*model.TopupProduct, error) {
	var consumed int64
	if len(stockArgs) > 1 {
		consumed = stockArgs[1]
	}
	name := strings.TrimSpace(request.Name)
	if name == "" || len([]rune(name)) > 120 {
		return nil, BadAuthRequest("充值商品名称不能为空且不能超过 120 个字符")
	}
	currency, err := normalizePaymentCurrency(request.Currency)
	if err != nil {
		return nil, err
	}
	// AmountFen 是货币最小单位（分 / 美分），两种货币上限都是 100 万主单位。
	if request.AmountFen <= 0 || request.AmountFen > 100_000_000 {
		return nil, BadAuthRequest("充值金额必须为 0.01 至 1,000,000 " + currency)
	}
	kind := topupProductKind(request.Kind)
	if request.Kind != "" && request.Kind != model.TopupProductKindCredits && request.Kind != model.TopupProductKindStorage {
		return nil, BadAuthRequest("商品类型无效")
	}
	switch kind {
	case model.TopupProductKindStorage:
		if request.CreditsMicrocredits != 0 {
			return nil, BadAuthRequest("存储空间商品不能同时发放积分")
		}
		if err := validStorageGrantSize(request.StorageBytes, request.StorageDurationDays); err != nil {
			return nil, err
		}
	default:
		if request.StorageBytes != 0 || request.StorageDurationDays != 0 {
			return nil, BadAuthRequest("积分商品不能设置存储空间")
		}
		if request.CreditsMicrocredits <= 0 || request.CreditsMicrocredits > maxTopupCreditsMicrocredits {
			return nil, BadAuthRequest("充值积分必须为 0.000001 至 10 亿积分")
		}
	}
	strategy := request.SaleStrategy
	if strategy == "" {
		strategy = model.TopupSaleStrategyUnlimited
	}
	if strategy != model.TopupSaleStrategyUnlimited && strategy != model.TopupSaleStrategyPeriodic && strategy != model.TopupSaleStrategyInventory && strategy != model.TopupSaleStrategyTimed {
		return nil, BadAuthRequest("上架策略无效")
	}
	if strategy == model.TopupSaleStrategyPeriodic && (request.PeriodDays <= 0 || request.PeriodDays > 3650 || request.PeriodPurchaseLimit <= 0 || request.PeriodPurchaseLimit > 100000) {
		return nil, BadAuthRequest("周期性商品需设置有效的周期天数和购买次数")
	}
	if strategy == model.TopupSaleStrategyInventory && request.StockTotal <= 0 {
		return nil, BadAuthRequest("库存性商品库存必须大于 0")
	}
	if strategy == model.TopupSaleStrategyTimed && (request.SaleStartAt == nil || request.SaleEndAt == nil || !request.SaleEndAt.After(*request.SaleStartAt)) {
		return nil, BadAuthRequest("限时商品必须设置有效的发售和结束时间")
	}
	stockRemaining := int64(0)
	if strategy == model.TopupSaleStrategyInventory {
		if consumed < 0 {
			consumed = 0
		}
		if request.StockTotal < consumed {
			return nil, BadAuthRequest(fmt.Sprintf("库存不能低于已售数量（至少 %d）", consumed))
		}
		stockRemaining = request.StockTotal - consumed
	}
	return &model.TopupProduct{
		ID: id, Name: name, Description: truncateRunes(strings.TrimSpace(request.Description), 500),
		Kind: kind, AmountFen: request.AmountFen, Currency: currency, CreditsMicrocredits: request.CreditsMicrocredits,
		StorageBytes: request.StorageBytes, StorageDurationDays: request.StorageDurationDays,
		Enabled: request.Enabled, SortOrder: request.SortOrder, SaleStrategy: strategy,
		PeriodDays: request.PeriodDays, PeriodPurchaseLimit: request.PeriodPurchaseLimit,
		StockTotal: request.StockTotal, StockRemaining: stockRemaining,
		SaleStartAt: request.SaleStartAt, SaleEndAt: request.SaleEndAt,
		CreatedBy: actorID, UpdatedBy: actorID,
	}, nil
}
