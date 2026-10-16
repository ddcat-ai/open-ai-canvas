package repository

import (
	"encoding/json"
	"errors"
	"reflect"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

var ErrCanvasEditLease = errors.New("节点正在其他窗口编辑，或编辑权限已过期；本地草稿已保留")

func (r *Repository) WithCanvasEditProofs(proofs []model.CanvasEditProof) *Repository {
	return &Repository{db: r.db, canvasEditProofs: proofs}
}

func (r *Repository) CanvasEditLeases(userID, canvasID string, now time.Time) ([]model.CanvasEditLease, error) {
	leases := []model.CanvasEditLease{}
	err := r.db.Where("user_id = ? AND canvas_id = ? AND expires_at > ?", userID, canvasID, now).Find(&leases).Error
	return leases, err
}

// Call inside a transaction after locking the parent canvas, including renew/release.
func (r *Repository) ChangeCanvasEditLease(userID, canvasID string, proof model.CanvasEditProof, action, newToken string, now time.Time) (*model.CanvasEditLease, error) {
	var current model.CanvasEditLease
	err := r.db.First(&current, "user_id = ? AND canvas_id = ? AND node_id = ?", userID, canvasID, proof.NodeID).Error
	if err != nil && !errors.Is(err, gorm.ErrRecordNotFound) {
		return nil, err
	}
	active := err == nil && current.ExpiresAt.After(now)
	matches := active && current.SessionID == proof.SessionID && current.Token == proof.Token
	if action == "release" {
		if !matches {
			return nil, ErrCanvasEditLease
		}
		return nil, r.db.Delete(&current).Error
	}
	if action == "renew" && !matches {
		return nil, ErrCanvasEditLease
	}
	if action == "acquire" && active && !matches {
		return nil, ErrCanvasEditLease
	}
	if !active {
		current = model.CanvasEditLease{UserID: userID, CanvasID: canvasID, NodeID: proof.NodeID, SessionID: proof.SessionID, Token: newToken}
	}
	current.ExpiresAt = now.Add(30 * time.Second)
	return &current, r.db.Save(&current).Error
}

// Authorization is checked in the same transaction as the revision CAS. Comparing
// authored fields permits result/progress writes without granting text ownership.
func (r *Repository) checkCanvasEditLeases(before *model.CanvasProject, after *model.CanvasProject) error {
	leases, err := r.CanvasEditLeases(before.UserID, before.ID, time.Now().UTC())
	if err != nil {
		return err
	}
	oldNodes, err := canvasLeaseNodes(before.PayloadJSON)
	if err != nil {
		return err
	}
	newNodes := map[string]map[string]any{}
	if after != nil {
		newNodes, err = canvasLeaseNodes(after.PayloadJSON)
		if err != nil {
			return err
		}
	}
	byNode := map[string]model.CanvasEditLease{}
	for _, lease := range leases {
		byNode[lease.NodeID] = lease
	}
	for _, proof := range r.canvasEditProofs {
		if !canvasLeaseTextChanged(oldNodes[proof.NodeID], newNodes[proof.NodeID]) {
			continue
		}
		lease, exists := byNode[proof.NodeID]
		if !exists || lease.Token != proof.Token || lease.SessionID != proof.SessionID {
			return ErrCanvasEditLease
		}
	}
	for _, lease := range leases {
		if after != nil && !canvasLeaseTextChanged(oldNodes[lease.NodeID], newNodes[lease.NodeID]) {
			continue
		}
		matched := false
		for _, proof := range r.canvasEditProofs {
			if proof.NodeID == lease.NodeID && proof.SessionID == lease.SessionID && proof.Token == lease.Token {
				matched = true
				break
			}
		}
		if !matched {
			return ErrCanvasEditLease
		}
	}
	return nil
}

func canvasLeaseNodes(raw string) (map[string]map[string]any, error) {
	var document struct {
		Nodes []map[string]any `json:"nodes"`
	}
	if err := json.Unmarshal([]byte(raw), &document); err != nil {
		return nil, err
	}
	nodes := map[string]map[string]any{}
	for _, node := range document.Nodes {
		if id, ok := node["id"].(string); ok {
			nodes[id] = node
		}
	}
	return nodes, nil
}

func canvasLeaseTextChanged(before, after map[string]any) bool {
	if before == nil || after == nil {
		return !reflect.DeepEqual(before, after)
	}
	if !reflect.DeepEqual(before["title"], after["title"]) {
		return true
	}
	b, _ := before["metadata"].(map[string]any)
	a, _ := after["metadata"].(map[string]any)
	for _, field := range []string{"content", "richText", "prompt", "composerContent"} {
		if (field == "content" || field == "richText") && before["type"] != "text" && before["type"] != "markdown" && before["type"] != "script" {
			continue
		}
		if !reflect.DeepEqual(b[field], a[field]) {
			return true
		}
	}
	bs, _ := b["generationSpec"].(map[string]any)
	as, _ := a["generationSpec"].(map[string]any)
	if !reflect.DeepEqual(bs["prompt"], as["prompt"]) {
		return true
	}
	return false
}
