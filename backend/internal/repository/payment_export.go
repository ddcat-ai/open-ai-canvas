package repository

import (
	"database/sql"
	"errors"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
)

type PaymentOrderFilter struct {
	Status, Keyword, ProviderID, TimeField string
	From, Until                            time.Time
}

type PaymentReconciliationFilter struct {
	ProviderID, Status, From, To string
}

var ErrPaymentReconciliationRunning = errors.New("payment reconciliation is running")

func (r *Repository) paymentReconciliationItemsQuery(runID, result string) *gorm.DB {
	query := r.db.Model(&model.PaymentReconciliationItem{}).Where("run_id = ?", strings.TrimSpace(runID))
	if normalized := strings.TrimSpace(result); normalized == "abnormal" {
		query = query.Where("result NOT IN ?", []string{"matched", "recovered"})
	} else if normalized != "" && normalized != "all" {
		query = query.Where("result = ?", normalized)
	}
	return query
}

func (r *Repository) ExportPaymentOrders(filter PaymentOrderFilter, limit int) (orders []model.PaymentOrder, users map[string]model.User, err error) {
	users = make(map[string]model.User)
	err = r.db.Transaction(func(tx *gorm.DB) error {
		snapshot := New(tx)
		if err := snapshot.paymentOrderQuery(filter).Order("created_at desc, id desc").Limit(limit).Find(&orders).Error; err != nil {
			return err
		}
		// Bound IN parameters for SQLite as well as PostgreSQL.
		for start := 0; start < len(orders); start += 500 {
			ids := make([]string, 0, 500)
			for _, order := range orders[start:min(start+500, len(orders))] {
				ids = append(ids, order.UserID)
			}
			batch, err := snapshot.UsersByIDs(ids)
			if err != nil {
				return err
			}
			for id, user := range batch {
				users[id] = user
			}
		}
		return nil
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return
}

func (r *Repository) ExportPaymentReconciliations(filter PaymentReconciliationFilter, limit int) ([]model.PaymentReconciliationRun, error) {
	var runs []model.PaymentReconciliationRun
	err := r.paymentReconciliationQuery(filter).Order("bill_date desc, started_at desc, id desc").Limit(limit).Find(&runs).Error
	return runs, err
}

func (r *Repository) ExportPaymentReconciliationItems(runID, result string, limit int) (run model.PaymentReconciliationRun, items []model.PaymentReconciliationItem, err error) {
	// A rerun deletes old items and reuses the run ID. Both reads must observe
	// the same snapshot, including on PostgreSQL (whose default is read committed).
	err = r.db.Transaction(func(tx *gorm.DB) error {
		if err := tx.First(&run, "id = ?", strings.TrimSpace(runID)).Error; err != nil {
			return err
		}
		if run.Status == model.PaymentReconciliationRunning {
			return ErrPaymentReconciliationRunning
		}
		return New(tx).paymentReconciliationItemsQuery(run.ID, result).Order("resolved asc, created_at asc, id asc").Limit(limit).Find(&items).Error
	}, &sql.TxOptions{Isolation: sql.LevelRepeatableRead, ReadOnly: true})
	return
}
