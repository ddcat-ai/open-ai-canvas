package repository

import (
	"encoding/json"
	"errors"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) CreationPreferences(userID string) (map[string]any, error) {
	var row model.CreationPreferences
	err := r.db.First(&row, "user_id = ?", userID).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return map[string]any{}, nil
	}
	if err != nil {
		return nil, err
	}
	var value map[string]any
	if err := json.Unmarshal([]byte(row.ValueJSON), &value); err != nil {
		return nil, err
	}
	return value, nil
}

// Field patches are serialized per account: changing a ratio on one device
// must not overwrite a model preference changed independently on another.
func (r *Repository) PatchCreationPreferences(userID string, patch map[string]any) (map[string]any, error) {
	var result map[string]any
	err := r.db.Transaction(func(tx *gorm.DB) error {
		var user model.User
		if err := tx.Clauses(clause.Locking{Strength: "UPDATE"}).First(&user, "id = ?", userID).Error; err != nil {
			return err
		}
		var err error
		result, err = New(tx).CreationPreferences(userID)
		if err != nil {
			return err
		}
		mergeCreationPreferenceFields(result, patch)
		encoded, err := json.Marshal(result)
		if err != nil {
			return err
		}
		return tx.Save(&model.CreationPreferences{UserID: userID, ValueJSON: string(encoded)}).Error
	})
	return result, err
}

func mergeCreationPreferenceFields(target, patch map[string]any) {
	for key, value := range patch {
		if nested, ok := value.(map[string]any); ok {
			current, ok := target[key].(map[string]any)
			if !ok {
				current = map[string]any{}
			}
			mergeCreationPreferenceFields(current, nested)
			target[key] = current
		} else {
			target[key] = value
		}
	}
}
