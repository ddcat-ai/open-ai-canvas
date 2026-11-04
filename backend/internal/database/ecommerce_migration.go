// Adapt the package and append this function to the target migration registry
// using the NEXT AVAILABLE version. Never overwrite existing migration IDs.
package database

import (
	"gorm.io/gorm"
	"yingce/backend/internal/model"
)

func migrateEcommerceFeature(tx *gorm.DB) error {
	if err := tx.AutoMigrate(
		&model.EcommerceProject{},
		&model.EcommerceKnowledgeSource{},
		&model.EcommerceKnowledgeEntry{},
		&model.EcommerceCreativeRecommendation{},
		&model.EcommerceAgentAnalysis{},
		&model.EcommerceAgentRun{},
		&model.EcommerceAgentPage{},
		&model.EcommerceAgentCanvasVersion{},
	); err != nil {
		return err
	}
	if !tx.Migrator().HasIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain") {
		return tx.Migrator().CreateIndex(&model.EcommerceKnowledgeEntry{}, "idx_ecommerce_knowledge_domain")
	}
	return nil
}
