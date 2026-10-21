package service

import (
	"yingce/backend/internal/app"
	"yingce/backend/internal/invite"
	"yingce/backend/internal/repository"
)

type (
	LinuxDOLoginOptions         = app.LinuxDOLoginOptions
	InvitePolicy                = invite.InvitePolicy
	InvitePublicPolicy          = invite.PublicPolicy
	InviteSettingView           = app.InviteSettingView
	InviteOverview              = app.InviteOverview
	InviteRecordsPageView       = app.InviteRecordsPageView
	WithdrawAccountInfo         = app.WithdrawAccountInfo
	WithdrawAccountView         = app.WithdrawAccountView
	WithdrawalCreateRequest     = app.WithdrawalCreateRequest
	WithdrawalsPageView         = app.WithdrawalsPageView
	TransferCreateRequest       = app.TransferCreateRequest
	TransfersPageView           = app.TransfersPageView
	AdminInviteListQuery        = app.AdminInviteListQuery
	AdminInviteRecordsPageView  = app.AdminInviteRecordsPageView
	AdminInviteRecordDetailView = app.AdminInviteRecordDetailView
	InviteInvitersUpdateRequest = app.InviteInvitersUpdateRequest
	AdminWithdrawListQuery      = app.AdminWithdrawListQuery
	AdminWithdrawalsPageView    = app.AdminWithdrawalsPageView
	AdminWithdrawalDetailView   = app.AdminWithdrawalDetailView
	AdminInviteRecordView       = repository.AdminInviteRecordView
	UserInviteRecordView        = repository.UserInviteRecordView
)
