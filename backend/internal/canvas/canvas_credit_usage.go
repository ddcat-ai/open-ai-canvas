package canvas

import (
	"encoding/json"
	"infinite-canvas/backend/internal/model"
	"strings"
	"time"
)

type CanvasCreditUsage struct {
	CanvasID             string              `json:"canvasId"`
	TotalMicrocredits    int64               `json:"totalMicrocredits"`
	SettledMicrocredits  int64               `json:"settledMicrocredits"`
	PendingMicrocredits  int64               `json:"pendingMicrocredits"`
	RefundedMicrocredits int64               `json:"refundedMicrocredits"`
	OrderCount           int                 `json:"orderCount"`
	TaskCount            int                 `json:"taskCount"`
	ByCapability         map[string]int64    `json:"byCapability"`
	RecentOrders         []CanvasCreditOrder `json:"recentOrders"`
}
type CanvasCreditOrder struct {
	ID                 string              `json:"id"`
	TaskID             string              `json:"taskId,omitempty"`
	Capability         string              `json:"capability"`
	AmountMicrocredits int64               `json:"amountMicrocredits"`
	Status             model.BillingStatus `json:"status"`
	CreatedAt          time.Time           `json:"createdAt"`
}

func (s *Service) CanvasCreditUsageForUser(user *model.User, canvasID string) (*CanvasCreditUsage, error) {
	if _, err := s.scopedCanvasProject(user, canvasID); err != nil {
		return nil, err
	}
	tasks, orders, err := s.repo.TasksWithBillingForUser(user.ID)
	if err != nil {
		return nil, err
	}
	ids := map[string]bool{}
	for _, t := range tasks {
		if t.ProjectID == canvasID && t.BillingOrderID != "" {
			ids[t.BillingOrderID] = true
			continue
		}
		var v map[string]any
		if json.Unmarshal([]byte(t.InputJSON), &v) != nil {
			continue
		}
		id := ""
		if x, ok := v["canvasId"].(string); ok {
			id = x
		}
		if id == "" {
			if m, ok := v["metadata"].(map[string]any); ok {
				id, _ = m["canvasId"].(string)
			}
		}
		if id == canvasID {
			if t.BillingOrderID != "" {
				ids[t.BillingOrderID] = true
			}
		}
	}
	out := &CanvasCreditUsage{CanvasID: canvasID, ByCapability: map[string]int64{}}
	for _, o := range orders {
		if !ids[o.ID] {
			continue
		}
		out.OrderCount++
		out.TotalMicrocredits += o.ActualAmountMicrocredits
		switch o.Status {
		case model.BillingStatusSettled:
			amount := o.ActualAmountMicrocredits
			if amount == 0 {
				amount = o.AmountMicrocredits
			}
			out.SettledMicrocredits += amount
		case model.BillingStatusRefunded:
			out.RefundedMicrocredits += o.RefundedAmountMicrocredits
		case model.BillingStatusReserved, model.BillingStatusRunning, model.BillingStatusUncertain:
			out.PendingMicrocredits += o.AmountMicrocredits
		}
		cap := strings.TrimSpace(o.Capability)
		if cap == "" {
			cap = "other"
		}
		out.ByCapability[cap] += o.ActualAmountMicrocredits
		out.RecentOrders = append(out.RecentOrders, CanvasCreditOrder{ID: o.ID, TaskID: o.TaskID, Capability: cap, AmountMicrocredits: o.ActualAmountMicrocredits, Status: o.Status, CreatedAt: o.CreatedAt})
	}
	out.TaskCount = len(ids)
	if len(out.RecentOrders) > 10 {
		out.RecentOrders = out.RecentOrders[:10]
	}
	return out, nil
}
