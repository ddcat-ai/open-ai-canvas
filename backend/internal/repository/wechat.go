package repository

import (
	"time"

	"yingce/backend/internal/model"
)

func (r *Repository) CreateWechatQRTicket(ticket *model.WechatQRTicket) error {
	return r.db.Create(ticket).Error
}

func (r *Repository) WechatQRTicket(id string) (*model.WechatQRTicket, error) {
	var ticket model.WechatQRTicket
	if err := r.db.First(&ticket, "id = ?", id).Error; err != nil {
		return nil, err
	}
	return &ticket, nil
}

func (r *Repository) WechatQRTicketByCode(code string) (*model.WechatQRTicket, error) {
	var ticket model.WechatQRTicket
	if err := r.db.First(&ticket, "code = ? AND expires_at > ?", code, time.Now()).Error; err != nil {
		return nil, err
	}
	return &ticket, nil
}

func (r *Repository) UpdateWechatQRTicket(ticket *model.WechatQRTicket) error {
	return r.db.Save(ticket).Error
}

func (r *Repository) UnbindUserIdentity(userID string, provider string) error {
	return r.db.Where("user_id = ? AND provider = ?", userID, provider).Delete(&model.UserIdentity{}).Error
}
