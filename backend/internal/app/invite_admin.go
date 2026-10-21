package app

import (
	"errors"
	"strings"
	"time"

	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"

	"gorm.io/gorm"
)

// ===== 管理端邀请记录 =====

// AdminInviteRecordsPageView 管理端邀请记录分页。
type AdminInviteRecordsPageView struct {
	Records  []repository.AdminInviteRecordView `json:"records"`
	Total    int64                              `json:"total"`
	Page     int                                `json:"page"`
	PageSize int                                `json:"pageSize"`
}

// AdminInviteListQuery 邀请记录筛选参数。
type AdminInviteListQuery struct {
	Status   string `json:"status"`
	Keyword  string `json:"keyword"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

func (s *Service) AdminInviteRecordsPage(actor *model.User, query AdminInviteListQuery) (*AdminInviteRecordsPageView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.PageSize)
	records, total, err := s.repo.AdminInviteRecords(repository.AdminInviteQuery{
		Status: query.Status, Keyword: query.Keyword, Limit: limit, Offset: (page - 1) * limit,
	})
	if err != nil {
		return nil, err
	}
	return &AdminInviteRecordsPageView{Records: records, Total: total, Page: page, PageSize: limit}, nil
}

// AdminInviteRecordDetailView 邀请记录详情：三方用户信息 + 奖励明细。
type AdminInviteRecordDetailView struct {
	Record        repository.AdminInviteRecordView `json:"record"`
	Invitee       *model.User                      `json:"invitee"`
	L1Inviter     *model.User                      `json:"l1Inviter"`
	L2Inviter     *model.User                      `json:"l2Inviter"`
	RewardRecords []model.InviteRewardRecord       `json:"rewardRecords"`
}

func (s *Service) AdminInviteRecordDetail(actor *model.User, userID string) (*AdminInviteRecordDetailView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	record, err := s.repo.AdminInviteRecordByUserID(userID)
	if err != nil {
		return nil, err
	}
	if record == nil {
		return nil, kernel.NotFound("邀请记录不存在")
	}
	view := &AdminInviteRecordDetailView{Record: *record}
	users, err := s.repo.UsersByIDs([]string{record.UserID, record.L1InviterID, record.L2InviterID})
	if err != nil {
		return nil, err
	}
	if user, ok := users[record.UserID]; ok {
		view.Invitee = &user
	}
	if user, ok := users[record.L1InviterID]; ok && record.L1InviterID != "" {
		view.L1Inviter = &user
	}
	if user, ok := users[record.L2InviterID]; ok && record.L2InviterID != "" {
		view.L2Inviter = &user
	}
	rewards, err := s.repo.InviteRewardRecordsByInvitee(record.UserID, 50)
	if err != nil {
		return nil, err
	}
	view.RewardRecords = rewards
	return view, nil
}

// ApproveInviteRecord 通过邀请记录并释放全部待审核奖励。
func (s *Service) ApproveInviteRecord(actor *model.User, userID string) (*model.InviteRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	audit, err := newAdminAuditEvent(actor, "invite.approve", "invite_record", userID, "通过邀请记录并释放待审核奖励", nil)
	if err != nil {
		return nil, err
	}
	record, err := s.repo.ApproveInviteRecord(userID, *audit)
	if err != nil {
		if errors.Is(err, repository.ErrInviteRecordStateConflict) {
			return nil, kernel.BadAuthRequest("邀请记录当前状态不允许通过")
		}
		return nil, err
	}
	return record, nil
}

// FreezeInviteRecord 冻结邀请记录：待审核奖励作废，后续订单不再产生奖励。
func (s *Service) FreezeInviteRecord(actor *model.User, userID string) (*model.InviteRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	audit, err := newAdminAuditEvent(actor, "invite.freeze", "invite_record", userID, "冻结邀请记录", nil)
	if err != nil {
		return nil, err
	}
	record, err := s.repo.FreezeInviteRecord(userID, *audit)
	if err != nil {
		if errors.Is(err, repository.ErrInviteRecordStateConflict) {
			return nil, kernel.BadAuthRequest("邀请记录当前状态不允许冻结")
		}
		return nil, err
	}
	return record, nil
}

// InviteInvitersUpdateRequest 编辑被邀请人的一级/二级邀请人（空串表示清除）。
type InviteInvitersUpdateRequest struct {
	L1InviterID string `json:"l1InviterId"`
	L2InviterID string `json:"l2InviterId"`
}

func (s *Service) UpdateInviteInviters(actor *model.User, userID string, req InviteInvitersUpdateRequest) (*model.InviteRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	l1 := strings.TrimSpace(req.L1InviterID)
	l2 := strings.TrimSpace(req.L2InviterID)
	audit, err := newAdminAuditEvent(actor, "invite.update", "invite_record", userID,
		"编辑邀请记录的邀请人", map[string]any{"l1InviterId": l1, "l2InviterId": l2})
	if err != nil {
		return nil, err
	}
	record, err := s.repo.UpdateInviteInviters(userID, l1, l2, *audit)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("邀请记录不存在")
		}
		return nil, err
	}
	return record, nil
}

// DeleteInviteRecord 删除邀请记录（先作废待审核奖励）。
func (s *Service) DeleteInviteRecord(actor *model.User, userID string) error {
	if err := s.RequireAdmin(actor); err != nil {
		return err
	}
	audit, err := newAdminAuditEvent(actor, "invite.delete", "invite_record", userID, "删除邀请记录", nil)
	if err != nil {
		return err
	}
	return s.repo.DeleteInviteRecord(userID, *audit)
}

// ===== 管理端提现 =====

// AdminWithdrawalsPageView 管理端提现记录分页。
type AdminWithdrawalsPageView struct {
	Records  []repository.AdminWithdrawView `json:"records"`
	Total    int64                          `json:"total"`
	Page     int                            `json:"page"`
	PageSize int                            `json:"pageSize"`
}

// AdminWithdrawListQuery 提现筛选参数。From/Until 为 YYYY-MM-DD 日期字符串（本地时区）。
type AdminWithdrawListQuery struct {
	Status   *int   `json:"status"`
	Method   string `json:"method"`
	Keyword  string `json:"keyword"`
	From     string `json:"from"`
	Until    string `json:"until"`
	Page     int    `json:"page"`
	PageSize int    `json:"pageSize"`
}

func (s *Service) AdminWithdrawalsPage(actor *model.User, query AdminWithdrawListQuery) (*AdminWithdrawalsPageView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	page, limit := normalizeAdminPage(query.Page, query.PageSize)
	repoQuery := repository.AdminWithdrawQuery{
		Status: query.Status, Method: query.Method, Keyword: query.Keyword,
		Limit: limit, Offset: (page - 1) * limit,
	}
	if query.From != "" {
		from, err := time.ParseInLocation("2006-01-02", query.From, time.Local)
		if err != nil {
			return nil, kernel.BadAuthRequest("开始日期格式必须为 YYYY-MM-DD")
		}
		repoQuery.From = &from
	}
	if query.Until != "" {
		until, err := time.ParseInLocation("2006-01-02", query.Until, time.Local)
		if err != nil {
			return nil, kernel.BadAuthRequest("结束日期格式必须为 YYYY-MM-DD")
		}
		until = until.AddDate(0, 0, 1)
		repoQuery.Until = &until
	}
	records, total, err := s.repo.AdminWithdrawals(repoQuery)
	if err != nil {
		return nil, err
	}
	return &AdminWithdrawalsPageView{Records: records, Total: total, Page: page, PageSize: limit}, nil
}

// AdminWithdrawalDetailView 提现详情：含解密后的收款信息。
type AdminWithdrawalDetailView struct {
	Record  repository.AdminWithdrawView `json:"record"`
	Account *WithdrawAccountInfo         `json:"account"`
}

func (s *Service) AdminWithdrawalDetail(actor *model.User, id string) (*AdminWithdrawalDetailView, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	request, err := s.repo.WithdrawRequest(id)
	if err != nil {
		if errors.Is(err, gorm.ErrRecordNotFound) {
			return nil, kernel.NotFound("提现记录不存在")
		}
		return nil, err
	}
	view := &AdminWithdrawalDetailView{}
	users, err := s.repo.UsersByIDs([]string{request.UserID})
	if err != nil {
		return nil, err
	}
	adminView := repository.AdminWithdrawView{WithdrawRequest: *request}
	if user, ok := users[request.UserID]; ok {
		adminView.Username = user.Username
		adminView.DisplayName = user.DisplayName
	}
	view.Record = adminView
	if request.AccountCipher != "" {
		info, err := s.decryptWithdrawAccount(request.AccountCipher)
		if err != nil {
			return nil, err
		}
		view.Account = info
	}
	return view, nil
}

// ApproveWithdrawal 提现审核通过：冻结余额转为已使用（线下打款由管理员执行）。
func (s *Service) ApproveWithdrawal(actor *model.User, id string) (*model.WithdrawRequest, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	audit, err := newAdminAuditEvent(actor, "withdraw.approve", "withdraw_request", id, "提现审核通过", nil)
	if err != nil {
		return nil, err
	}
	request, err := s.repo.ReviewWithdrawRequest(id, true, actor.ID, "", *audit)
	if err != nil {
		if errors.Is(err, repository.ErrWithdrawStateConflict) {
			return nil, kernel.BadAuthRequest("提现申请当前状态不允许审核")
		}
		return nil, err
	}
	return request, nil
}

// RejectWithdrawal 提现驳回：冻结余额退回可用，必须填写原因。
func (s *Service) RejectWithdrawal(actor *model.User, id, reason string) (*model.WithdrawRequest, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	audit, err := newAdminAuditEvent(actor, "withdraw.reject", "withdraw_request", id,
		"提现驳回", map[string]any{"reason": strings.TrimSpace(reason)})
	if err != nil {
		return nil, err
	}
	request, err := s.repo.ReviewWithdrawRequest(id, false, actor.ID, reason, *audit)
	if err != nil {
		if errors.Is(err, repository.ErrWithdrawStateConflict) {
			return nil, kernel.BadAuthRequest("提现申请当前状态不允许审核")
		}
		return nil, err
	}
	return request, nil
}
