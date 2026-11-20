package model

import (
	"strings"
	"time"
)

func TeamContentKey(teamID string) string { return "t:" + teamID }

func TeamIDFromContentKey(key string) (string, bool) { return strings.CutPrefix(key, "t:") }

const (
	TeamActive         = "active"
	TeamOwner          = "owner"
	TeamMember         = "member"
	TeamLeft           = "left"
	InvitationPending  = "pending"
	InvitationAccepted = "accepted"
	InvitationRejected = "rejected"
	InvitationRevoked  = "revoked"
	InvitationExpired  = "expired"
)

type Team struct {
	ID          string    `json:"id" gorm:"primaryKey;size:36"`
	Name        string    `json:"name" gorm:"size:80;not null"`
	OwnerUserID string    `json:"ownerUserId" gorm:"size:36;not null;index"`
	ParentID    string    `json:"parentId,omitempty" gorm:"size:36;not null;default:'';index"`
	Status      string    `json:"status" gorm:"size:16;not null"`
	CreatedAt   time.Time `json:"createdAt"`
	UpdatedAt   time.Time `json:"updatedAt"`
}

type TeamMembership struct {
	ID        string     `json:"id" gorm:"primaryKey;size:36"`
	TeamID    string     `json:"teamId" gorm:"size:36;not null;uniqueIndex:idx_team_active_member,where:status = 'active'"`
	UserID    string     `json:"userId" gorm:"size:36;not null;index;uniqueIndex:idx_team_active_member"`
	Role      string     `json:"role" gorm:"size:16;not null"`
	Status    string     `json:"status" gorm:"size:16;not null"`
	CreatedAt time.Time  `json:"joinedAt"`
	EndedAt   *time.Time `json:"endedAt,omitempty"`
}

type TeamInvitation struct {
	ID            string     `json:"id" gorm:"primaryKey;size:36"`
	TeamID        string     `json:"teamId" gorm:"size:36;not null;index;uniqueIndex:idx_team_pending_invite,where:status = 'pending'"`
	InviterUserID string     `json:"inviterUserId" gorm:"size:36;not null"`
	InviteeUserID string     `json:"inviteeUserId" gorm:"size:36;not null;index;uniqueIndex:idx_team_pending_invite"`
	Status        string     `json:"status" gorm:"size:16;not null"`
	ExpiresAt     time.Time  `json:"expiresAt" gorm:"not null"`
	CreatedAt     time.Time  `json:"createdAt"`
	RespondedAt   *time.Time `json:"respondedAt,omitempty"`
}
