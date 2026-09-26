package database

import (
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
)

// prefixedIDDefinition is the single source of truth for the readable IDs that
// are allocated from id_sequences. The business table is used to reconcile a
// sequence after a SQLite -> PostgreSQL copy or an interrupted write.
type prefixedIDDefinition struct {
	prefix string
	model  any
}

var prefixedIDDefinitions = []prefixedIDDefinition{
	{prefix: "CHANNEL", model: &model.ModelChannel{}},
	{prefix: "MODEL", model: &model.ChannelModel{}},
	{prefix: "PTIER", model: &model.ChannelModelPriceTier{}},
	{prefix: "ATTEMPT", model: &model.RouteAttempt{}},
	{prefix: "LMODEL", model: &model.LogicalModel{}},
	{prefix: "REVISION", model: &model.LogicalModelRevision{}},
	{prefix: "ROUTE", model: &model.LogicalModelRoute{}},
}

// ReconcilePrefixedIDSequences advances all known readable-ID sequences to at
// least the largest valid business ID. It never moves a sequence backwards.
// Soft-deleted rows are included deliberately: their IDs remain reserved.
func ReconcilePrefixedIDSequences(db *gorm.DB) error {
	if db == nil {
		return errors.New("database handle is nil")
	}
	return db.Transaction(func(tx *gorm.DB) error {
		return reconcilePrefixedIDSequences(tx)
	})
}

func reconcilePrefixedIDSequences(tx *gorm.DB) error {
	for _, definition := range prefixedIDDefinitions {
		if !tx.Migrator().HasTable(definition.model) {
			continue
		}
		maximum, err := maxPrefixedBusinessID(tx, definition)
		if err != nil {
			return fmt.Errorf("读取 %s 业务 ID：%w", definition.prefix, err)
		}
		if err := ensureSequenceRow(tx, definition.prefix); err != nil {
			return fmt.Errorf("初始化 %s 序列：%w", definition.prefix, err)
		}
		item, err := lockedSequence(tx, definition.prefix)
		if err != nil {
			return fmt.Errorf("读取 %s 序列：%w", definition.prefix, err)
		}
		if item.Value >= maximum {
			continue
		}
		if err := tx.Model(&model.IDSequence{}).Where("name = ?", item.Name).Updates(map[string]any{
			"value":      maximum,
			"updated_at": time.Now(),
		}).Error; err != nil {
			return fmt.Errorf("校准 %s 序列到 %d：%w", definition.prefix, maximum, err)
		}
	}
	return nil
}

// AllocatePrefixedID allocates the next readable ID. For known prefixes it
// first reconciles the sequence with the business table and checks the
// candidate against that table, so stale sequences and soft-deleted rows
// cannot produce duplicate primary keys.
func AllocatePrefixedID(db *gorm.DB, prefix string) (string, error) {
	if db == nil {
		return "", errors.New("database handle is nil")
	}
	var allocated string
	if err := db.Transaction(func(tx *gorm.DB) error {
		var err error
		allocated, err = allocatePrefixedID(tx, prefix)
		return err
	}); err != nil {
		return "", err
	}
	return allocated, nil
}

func allocatePrefixedID(tx *gorm.DB, rawPrefix string) (string, error) {
	prefix := normalizeIDPrefix(rawPrefix)
	if prefix == "" || len(prefix) > 16 {
		return "", errors.New("invalid id prefix")
	}
	if err := ensureSequenceRow(tx, prefix); err != nil {
		return "", err
	}
	item, err := lockedSequence(tx, prefix)
	if err != nil {
		return "", err
	}

	definition, known := prefixedIDDefinitionFor(prefix)
	candidateValue := item.Value
	if known {
		if !tx.Migrator().HasTable(definition.model) {
			return "", fmt.Errorf("ID 前缀 %s 对应的业务表不存在", prefix)
		}
		maximum, err := maxPrefixedBusinessID(tx, definition)
		if err != nil {
			return "", fmt.Errorf("读取 %s 业务 ID：%w", prefix, err)
		}
		if candidateValue < maximum {
			candidateValue = maximum
		}
	}
	if candidateValue == math.MaxInt64 {
		return "", fmt.Errorf("ID 前缀 %s 序列已达到上限", prefix)
	}

	for {
		candidateValue++
		candidate := fmt.Sprintf("%s_%06d", prefix, candidateValue)
		if !known {
			if err := updateSequence(tx, item.Name, candidateValue); err != nil {
				return "", err
			}
			return candidate, nil
		}
		var count int64
		if err := tx.Unscoped().Model(definition.model).Where("id = ?", candidate).Count(&count).Error; err != nil {
			return "", fmt.Errorf("检查 %s 候选 ID：%w", prefix, err)
		}
		if count != 0 {
			if candidateValue == math.MaxInt64 {
				return "", fmt.Errorf("ID 前缀 %s 序列已达到上限", prefix)
			}
			continue
		}
		if err := updateSequence(tx, item.Name, candidateValue); err != nil {
			return "", err
		}
		return candidate, nil
	}
}

func normalizeIDPrefix(raw string) string {
	return strings.ToUpper(strings.TrimSpace(raw))
}

func prefixedIDDefinitionFor(prefix string) (prefixedIDDefinition, bool) {
	for _, definition := range prefixedIDDefinitions {
		if definition.prefix == prefix {
			return definition, true
		}
	}
	return prefixedIDDefinition{}, false
}

func ensureSequenceRow(tx *gorm.DB, prefix string) error {
	return tx.Clauses(clause.OnConflict{DoNothing: true}).Create(&model.IDSequence{
		Name:      "id:" + prefix,
		UpdatedAt: time.Now(),
	}).Error
}

func lockedSequence(tx *gorm.DB, prefix string) (model.IDSequence, error) {
	query := tx.Model(&model.IDSequence{}).Where("name = ?", "id:"+prefix)
	if tx.Dialector.Name() == "postgres" {
		query = query.Clauses(clause.Locking{Strength: "UPDATE"})
	}
	var item model.IDSequence
	if err := query.First(&item).Error; err != nil {
		return model.IDSequence{}, err
	}
	return item, nil
}

func updateSequence(tx *gorm.DB, name string, value int64) error {
	return tx.Model(&model.IDSequence{}).Where("name = ?", name).Updates(map[string]any{
		"value":      value,
		"updated_at": time.Now(),
	}).Error
}

func maxPrefixedBusinessID(tx *gorm.DB, definition prefixedIDDefinition) (int64, error) {
	var ids []string
	if err := tx.Unscoped().Model(definition.model).Select("id").Pluck("id", &ids).Error; err != nil {
		return 0, err
	}
	prefix := definition.prefix + "_"
	var maximum int64
	for _, id := range ids {
		if !strings.HasPrefix(id, prefix) {
			continue
		}
		digits := strings.TrimPrefix(id, prefix)
		if digits == "" {
			continue
		}
		for _, character := range digits {
			if character < '0' || character > '9' {
				digits = ""
				break
			}
		}
		if digits == "" {
			continue
		}
		value, err := strconv.ParseInt(digits, 10, 64)
		if err != nil {
			continue
		}
		if value > maximum {
			maximum = value
		}
	}
	return maximum, nil
}
