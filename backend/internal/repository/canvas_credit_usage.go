package repository

import "infinite-canvas/backend/internal/model"

// TasksWithBillingForUser returns the task inputs and their billing orders for aggregation.
func (r *Repository) TasksWithBillingForUser(userID string) ([]model.Task, []model.BillingOrder, error) {
	var tasks []model.Task
	q := r.db.Model(&model.Task{}).Where("user_id = ?", userID)
	if err := q.Order("tasks.created_at desc").Find(&tasks).Error; err != nil {
		return nil, nil, err
	}
	ids := make([]string, 0, len(tasks))
	for _, task := range tasks {
		if task.BillingOrderID != "" {
			ids = append(ids, task.BillingOrderID)
		}
	}
	if len(ids) == 0 {
		return tasks, []model.BillingOrder{}, nil
	}
	var orders []model.BillingOrder
	if err := r.db.Model(&model.BillingOrder{}).Where("user_id = ?", userID).Where("billing_orders.id IN ?", ids).Order("created_at DESC, id DESC").Find(&orders).Error; err != nil {
		return nil, nil, err
	}
	return tasks, orders, nil
}
