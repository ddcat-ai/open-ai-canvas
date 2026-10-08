// 充值商品：前台可购买的积分档位与管理端增改。

package app

import (
	"fmt"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

func (s *Service) TopupProducts(actor *model.User) ([]model.TopupProduct, error) {
	if actor == nil {
		return nil, Unauthorized("请先登录")
	}
	if err := s.RequireFeature(FeatureCredits); err != nil {
		return nil, err
	}
	products, err := s.repo.TopupProducts(false)
	if err != nil {
		return nil, err
	}
	return decorateTopupProducts(products, time.Now()), nil
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
	product, err := topupProductFromRequest(newID(), actor.ID, request, 0, 0)
	if err != nil {
		return nil, err
	}
	if err := s.repo.CreateTopupProduct(product); err != nil {
		return nil, err
	}
	if err := s.appendAdminAudit(actor, "topup_product.create", "topup_product", product.ID, "创建积分充值商品", map[string]any{"amountFen": product.AmountFen, "creditsMicrocredits": product.CreditsMicrocredits, "saleStrategy": product.SaleStrategy}); err != nil {
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
	if err := s.appendAdminAudit(actor, "topup_product.update", "topup_product", product.ID, "更新积分充值商品", map[string]any{"enabled": product.Enabled, "saleStrategy": product.SaleStrategy}); err != nil {
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
	if request.AmountFen <= 0 || request.AmountFen > 100_000_000 {
		return nil, BadAuthRequest("充值金额必须为 1 分至 100 万元")
	}
	if request.CreditsMicrocredits <= 0 || request.CreditsMicrocredits > maxTopupCreditsMicrocredits {
		return nil, BadAuthRequest("充值积分必须为 0.000001 至 10 亿积分")
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
		AmountFen: request.AmountFen, CreditsMicrocredits: request.CreditsMicrocredits,
		Enabled: request.Enabled, SortOrder: request.SortOrder, SaleStrategy: strategy,
		PeriodDays: request.PeriodDays, PeriodPurchaseLimit: request.PeriodPurchaseLimit,
		StockTotal: request.StockTotal, StockRemaining: stockRemaining,
		SaleStartAt: request.SaleStartAt, SaleEndAt: request.SaleEndAt,
		CreatedBy: actorID, UpdatedBy: actorID,
	}, nil
}
