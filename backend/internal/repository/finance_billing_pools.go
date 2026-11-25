package repository

import (
	"errors"
	"fmt"
	"math"
	"slices"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

type creditPool uint8

const (
	poolGeneral creditPool = iota + 1
	poolImage
	poolVideo
)

var (
	errPoolSupplementInsufficient = errors.New("insufficient pool supplement")
	errPoolReservedInconsistent   = errors.New("reserved credit balance is inconsistent")
)

type poolAllocation struct {
	General int64
	Image   int64
	Video   int64
}

func (a poolAllocation) total() int64 {
	return a.General + a.Image + a.Video
}

func (a poolAllocation) get(p creditPool) int64 {
	switch p {
	case poolImage:
		return a.Image
	case poolVideo:
		return a.Video
	default:
		return a.General
	}
}

func (a *poolAllocation) add(p creditPool, delta int64) {
	switch p {
	case poolImage:
		a.Image += delta
	case poolVideo:
		a.Video += delta
	default:
		a.General += delta
	}
}

func (a *poolAllocation) set(p creditPool, val int64) {
	switch p {
	case poolImage:
		a.Image = val
	case poolVideo:
		a.Video = val
	default:
		a.General = val
	}
}

// InsufficientPoolCreditsError 标识总积分中含能力受限积分，但符合当前任务能力的可用积分不足。
// Unwrap 保持匹配 ErrInsufficientCredits，兼容既有的错误分支判断。
type InsufficientPoolCreditsError struct {
	Capability       string
	GeneralAvailable int64
	ImageAvailable   int64
	VideoAvailable   int64
}

func (e *InsufficientPoolCreditsError) Unwrap() error {
	return ErrInsufficientCredits
}

func (e *InsufficientPoolCreditsError) Error() string {
	switch e.Capability {
	case model.RedeemCapabilityImage:
		return "可用通用积分及图片专享积分不足，请先充值（仅限视频卡密的积分不能用于图片）"
	case model.RedeemCapabilityVideo:
		if e.ImageAvailable > 0 {
			return "视频消耗仅支持通用积分或视频专享积分，您账号中的「仅限图片」卡密积分不可用于视频生成，请先充值"
		}
		return "可用通用积分及视频专享积分不足，请先充值"
	default:
		return "可用通用积分不足（仅限图片或仅限视频的卡密积分不可用于该能力），请先充值"
	}
}

func isAgentBillingScene(scene string) bool {
	switch strings.TrimSpace(scene) {
	case "cloud_agent", "cloud_agent_step", "cloud_agent_context_compaction":
		return true
	default:
		return false
	}
}

func billingPoolOrder(order model.BillingOrder) []creditPool {
	if order.TeamID != "" {
		return []creditPool{poolGeneral}
	}
	// Agent 对话步骤不受专用卡密限制：优先用通用积分，不足时允许由图片/视频专享积分补充推理步骤消耗。
	if isAgentBillingScene(order.Scene) {
		return []creditPool{poolGeneral, poolImage, poolVideo}
	}
	switch strings.ToLower(strings.TrimSpace(order.Capability)) {
	case model.RedeemCapabilityImage:
		return []creditPool{poolImage, poolGeneral}
	case model.RedeemCapabilityVideo:
		return []creditPool{poolVideo, poolGeneral}
	default:
		return []creditPool{poolGeneral}
	}
}

func accountAvailableByPool(account model.CreditAccount, p creditPool) int64 {
	switch p {
	case poolImage:
		return account.ImageAvailableMicrocredits
	case poolVideo:
		return account.VideoAvailableMicrocredits
	default:
		return account.AvailableMicrocredits
	}
}

func accountReservedByPool(account model.CreditAccount, p creditPool) int64 {
	switch p {
	case poolImage:
		return account.ImageReservedMicrocredits
	case poolVideo:
		return account.VideoReservedMicrocredits
	default:
		return account.ReservedMicrocredits
	}
}

func orderReservedAllocation(order model.BillingOrder, reservedTotal int64) poolAllocation {
	if reservedTotal <= 0 {
		reservedTotal = order.ReservedAmountMicrocredits
	}
	if reservedTotal <= 0 {
		reservedTotal = order.AmountMicrocredits
	}
	imageRes := max(order.ImageReservedMicrocredits, int64(0))
	videoRes := max(order.VideoReservedMicrocredits, int64(0))
	generalRes := max(reservedTotal-imageRes-videoRes, int64(0))
	return poolAllocation{General: generalRes, Image: imageRes, Video: videoRes}
}

func applyAccountPoolDeltas(tx *gorm.DB, order model.BillingOrder, availDelta poolAllocation, resDelta poolAllocation, requireAvailNonNegative bool, requireResNonNegative bool) (model.CreditAccount, error) {
	query := billingAccountQuery(tx, order)
	updates := map[string]any{
		"version":    gorm.Expr("version + 1"),
		"updated_at": time.Now(),
	}
	applyCol := func(availCol, resCol string, dAvail, dRes int64) error {
		if dAvail != 0 {
			if requireAvailNonNegative && dAvail < 0 {
				query = query.Where(availCol+" >= ?", -dAvail)
			}
			if dAvail > 0 {
				query = query.Where(availCol+" <= ?", int64(math.MaxInt64)-dAvail)
			}
			updates[availCol] = gorm.Expr(availCol+" + ?", dAvail)
		}
		if dRes != 0 {
			if requireResNonNegative && dRes < 0 {
				query = query.Where(resCol+" >= ?", -dRes)
			}
			if dRes > 0 {
				query = query.Where(resCol+" <= ?", int64(math.MaxInt64)-dRes)
			}
			updates[resCol] = gorm.Expr(resCol+" + ?", dRes)
		}
		return nil
	}
	_ = applyCol("available_microcredits", "reserved_microcredits", availDelta.General, resDelta.General)
	_ = applyCol("image_available_microcredits", "image_reserved_microcredits", availDelta.Image, resDelta.Image)
	_ = applyCol("video_available_microcredits", "video_reserved_microcredits", availDelta.Video, resDelta.Video)

	updated := query.Updates(updates)
	if updated.Error != nil {
		return model.CreditAccount{}, updated.Error
	}
	if updated.RowsAffected != 1 {
		return model.CreditAccount{}, ErrBillingStateConflict
	}
	var account model.CreditAccount
	if err := billingAccountQuery(tx, order).First(&account).Error; err != nil {
		return model.CreditAccount{}, err
	}
	return account, nil
}

func allocateFromPools(account model.CreditAccount, pools []creditPool, amount int64) (poolAllocation, int64) {
	var alloc poolAllocation
	rem := amount
	for _, p := range pools {
		if rem <= 0 {
			break
		}
		avail := accountAvailableByPool(account, p)
		res := accountReservedByPool(account, p)
		if avail <= 0 || res < 0 || res == math.MaxInt64 {
			continue
		}
		maxRoom := int64(math.MaxInt64) - res
		take := min(rem, min(avail, maxRoom))
		if take <= 0 {
			continue
		}
		alloc.add(p, take)
		rem -= take
	}
	return alloc, rem
}

func reserveAccountForOrder(tx *gorm.DB, order *model.BillingOrder) (model.CreditAccount, poolAllocation, error) {
	var account model.CreditAccount
	if err := billingAccountQuery(tx, *order).Clauses(clause.Locking{Strength: "UPDATE"}).First(&account).Error; err != nil {
		return account, poolAllocation{}, err
	}
	alloc, rem := allocateFromPools(account, billingPoolOrder(*order), order.AmountMicrocredits)
	if rem > 0 {
		totalAllPools := max(account.AvailableMicrocredits, int64(0)) + max(account.ImageAvailableMicrocredits, int64(0)) + max(account.VideoAvailableMicrocredits, int64(0))
		if order.TeamID == "" && totalAllPools >= order.AmountMicrocredits && (account.ImageAvailableMicrocredits > 0 || account.VideoAvailableMicrocredits > 0) {
			return account, poolAllocation{}, &InsufficientPoolCreditsError{
				Capability:       strings.ToLower(strings.TrimSpace(order.Capability)),
				GeneralAvailable: account.AvailableMicrocredits,
				ImageAvailable:   account.ImageAvailableMicrocredits,
				VideoAvailable:   account.VideoAvailableMicrocredits,
			}
		}
		return account, poolAllocation{}, ErrInsufficientCredits
	}
	availDelta := poolAllocation{General: -alloc.General, Image: -alloc.Image, Video: -alloc.Video}
	updatedAccount, err := applyAccountPoolDeltas(tx, *order, availDelta, alloc, true, false)
	if errors.Is(err, ErrBillingStateConflict) {
		return updatedAccount, poolAllocation{}, ErrInsufficientCredits
	}
	if err != nil {
		return updatedAccount, poolAllocation{}, err
	}
	order.ImageReservedMicrocredits = alloc.Image
	order.VideoReservedMicrocredits = alloc.Video
	return updatedAccount, alloc, nil
}

func adjustOrderReservation(tx *gorm.DB, order model.BillingOrder, oldReserved, newReserved int64) (model.CreditAccount, poolAllocation, poolAllocation, error) {
	delta := newReserved - oldReserved
	var account model.CreditAccount
	if err := billingAccountQuery(tx, order).Clauses(clause.Locking{Strength: "UPDATE"}).First(&account).Error; err != nil {
		return account, poolAllocation{}, poolAllocation{}, err
	}
	currentRes := orderReservedAllocation(order, oldReserved)
	if delta == 0 {
		return account, poolAllocation{}, currentRes, nil
	}
	pools := billingPoolOrder(order)
	if delta > 0 {
		taken, rem := allocateFromPools(account, pools, delta)
		if rem > 0 {
			return account, poolAllocation{}, currentRes, ErrInsufficientCredits
		}
		availDelta := poolAllocation{General: -taken.General, Image: -taken.Image, Video: -taken.Video}
		updatedAccount, err := applyAccountPoolDeltas(tx, order, availDelta, taken, true, false)
		if errors.Is(err, ErrBillingStateConflict) {
			return updatedAccount, poolAllocation{}, currentRes, ErrInsufficientCredits
		}
		if err != nil {
			return updatedAccount, poolAllocation{}, currentRes, err
		}
		newRes := poolAllocation{
			General: currentRes.General + taken.General,
			Image:   currentRes.Image + taken.Image,
			Video:   currentRes.Video + taken.Video,
		}
		return updatedAccount, taken, newRes, nil
	}
	release := -delta
	var relAlloc poolAllocation
	revPools := slices.Clone(pools)
	slices.Reverse(revPools)
	rem := release
	for _, p := range revPools {
		if rem <= 0 {
			break
		}
		held := currentRes.get(p)
		giveBack := min(rem, held)
		if giveBack <= 0 {
			continue
		}
		relAlloc.add(p, giveBack)
		rem -= giveBack
	}
	if rem > 0 {
		return account, poolAllocation{}, currentRes, errors.New("reserved credit balance is inconsistent")
	}
	resDelta := poolAllocation{General: -relAlloc.General, Image: -relAlloc.Image, Video: -relAlloc.Video}
	updatedAccount, err := applyAccountPoolDeltas(tx, order, relAlloc, resDelta, false, true)
	if errors.Is(err, ErrBillingStateConflict) {
		return updatedAccount, poolAllocation{}, currentRes, errors.New("reserved credit balance is inconsistent")
	}
	if err != nil {
		return updatedAccount, poolAllocation{}, currentRes, err
	}
	newRes := poolAllocation{
		General: currentRes.General - relAlloc.General,
		Image:   currentRes.Image - relAlloc.Image,
		Video:   currentRes.Video - relAlloc.Video,
	}
	deltaNeg := poolAllocation{General: -relAlloc.General, Image: -relAlloc.Image, Video: -relAlloc.Video}
	return updatedAccount, deltaNeg, newRes, nil
}

type poolSettlementResult struct {
	Account        model.CreditAccount
	OrderReserved  poolAllocation
	Actual         poolAllocation
	Refund         poolAllocation
	Supplement     poolAllocation
	TotalRefund    int64
	TotalSupplemnt int64
}

func settleOrderPools(tx *gorm.DB, order model.BillingOrder, reservedTotal int64, actualTotal int64, allowOverdraft bool, inconsistentErrMsg string, insufficientSupplementMsg string) (poolSettlementResult, error) {
	var result poolSettlementResult
	var account model.CreditAccount
	if err := billingAccountQuery(tx, order).Clauses(clause.Locking{Strength: "UPDATE"}).First(&account).Error; err != nil {
		return result, err
	}
	orderRes := orderReservedAllocation(order, reservedTotal)
	result.OrderReserved = orderRes
	pools := billingPoolOrder(order)
	remActual := actualTotal
	var actualAlloc poolAllocation
	for _, p := range pools {
		held := orderRes.get(p)
		if held <= 0 || remActual <= 0 {
			continue
		}
		used := min(remActual, held)
		actualAlloc.add(p, used)
		remActual -= used
	}
	refundAlloc := poolAllocation{
		General: orderRes.General - actualAlloc.General,
		Image:   orderRes.Image - actualAlloc.Image,
		Video:   orderRes.Video - actualAlloc.Video,
	}
	var supplementAlloc poolAllocation
	if remActual > 0 {
		takenExtra, leftover := allocateFromPools(account, pools, remActual)
		supplementAlloc = takenExtra
		actualAlloc.General += takenExtra.General
		actualAlloc.Image += takenExtra.Image
		actualAlloc.Video += takenExtra.Video
		if leftover > 0 {
			if !allowOverdraft {
				return result, fmt.Errorf("%w: %s", errPoolSupplementInsufficient, insufficientSupplementMsg)
			}
			// Token 后置补差允许通用余额记账透支，但绝不透支专用券池。
			supplementAlloc.General += leftover
			actualAlloc.General += leftover
		}
	}
	availDelta := poolAllocation{
		General: refundAlloc.General - supplementAlloc.General,
		Image:   refundAlloc.Image - supplementAlloc.Image,
		Video:   refundAlloc.Video - supplementAlloc.Video,
	}
	resDelta := poolAllocation{
		General: -orderRes.General,
		Image:   -orderRes.Image,
		Video:   -orderRes.Video,
	}
	updatedAccount, err := applyAccountPoolDeltas(tx, order, availDelta, resDelta, false, true)
	if errors.Is(err, ErrBillingStateConflict) {
		return result, fmt.Errorf("%w: %s", errPoolReservedInconsistent, inconsistentErrMsg)
	}
	if err != nil {
		return result, err
	}
	result.Account = updatedAccount
	result.Actual = actualAlloc
	result.Refund = refundAlloc
	result.Supplement = supplementAlloc
	result.TotalRefund = refundAlloc.total()
	result.TotalSupplemnt = supplementAlloc.total()
	return result, nil
}

func refundReservedOrderPools(tx *gorm.DB, order model.BillingOrder) (model.CreditAccount, poolAllocation, error) {
	var account model.CreditAccount
	if err := billingAccountQuery(tx, order).Clauses(clause.Locking{Strength: "UPDATE"}).First(&account).Error; err != nil {
		return account, poolAllocation{}, err
	}
	orderRes := orderReservedAllocation(order, 0)
	resDelta := poolAllocation{General: -orderRes.General, Image: -orderRes.Image, Video: -orderRes.Video}
	updatedAccount, err := applyAccountPoolDeltas(tx, order, orderRes, resDelta, false, true)
	if errors.Is(err, ErrBillingStateConflict) {
		return updatedAccount, poolAllocation{}, errors.New("reserved credit balance is inconsistent")
	}
	return updatedAccount, orderRes, err
}

func chargeRestoredOrderPools(tx *gorm.DB, order model.BillingOrder, actualTotal int64) (model.CreditAccount, poolAllocation, error) {
	var account model.CreditAccount
	if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&account, "user_id = ?", order.UserID).Error; err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return account, poolAllocation{}, errors.New("credit account does not exist")
		}
		return account, poolAllocation{}, err
	}
	taken, rem := allocateFromPools(account, billingPoolOrder(order), actualTotal)
	if rem > 0 {
		// 恢复扣款时若可用不足，剩余额从通用余额记账扣减，绝不让专享池变负。
		taken.General += rem
	}
	availDelta := poolAllocation{General: -taken.General, Image: -taken.Image, Video: -taken.Video}
	updatedAccount, err := applyAccountPoolDeltas(tx, order, availDelta, poolAllocation{}, false, false)
	if errors.Is(err, ErrBillingStateConflict) {
		return updatedAccount, poolAllocation{}, errors.New("credit account does not exist")
	}
	return updatedAccount, taken, err
}
