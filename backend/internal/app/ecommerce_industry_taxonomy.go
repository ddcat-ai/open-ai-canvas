package app

import (
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"yingce/backend/internal/ecommercecatalog"
	"yingce/backend/internal/model"
	"yingce/backend/internal/repository"
)

const industryTaxonomySourceID = "meiye-industry-taxonomy"
const industryTaxonomyReceiptKey = "ecommerce_industry_taxonomy_receipt"

type IndustryTaxonomyReport struct {
	Shipped          int   `json:"shipped"`
	Inserted         int64 `json:"inserted"`
	AlreadyInstalled bool  `json:"alreadyInstalled"`
}

// A separate batched dictionary import keeps the 64k-row classification index
// out of the small per-entry editorial bootstrap. Existing rows always win.
func (s *Service) EnsureIndustryTaxonomyKnowledge() (*IndustryTaxonomyReport, error) {
	meta := ecommercecatalog.Metadata()
	report := &IndustryTaxonomyReport{Shipped: meta.Nodes}
	receipt, _ := json.Marshal(map[string]string{"commit": meta.Commit})
	installed := func(repo *repository.Repository) (bool, error) {
		row, err := repo.SystemSettingOptional(industryTaxonomyReceiptKey)
		return row != nil && row.ValueJSON == string(receipt), err
	}
	if ready, err := installed(s.repo); err != nil {
		return nil, err
	} else if ready {
		report.AlreadyInstalled = true
		return report, nil
	}
	now := time.Now().UTC()
	entries := make([]model.EcommerceKnowledgeEntry, 0, meta.Nodes)
	for _, node := range ecommercecatalog.All() {
		content, _ := json.Marshal(map[string]any{"taxonomyId": node.ID, "parentId": node.ParentID, "rootId": node.RootID, "path": node.Path, "pathEn": node.PathEn, "guidance": "官方分类路径：" + node.Path + "；英文：" + node.PathEn + "。只用于行业、品类和子品类定位，不证明任何具体商品的参数、功能或图片规则。"})
		node.Path = truncateRunes(node.Path, 240)
		id := "industry-taxonomy-" + node.ID
		sum := sha256.Sum256([]byte(id + string(content)))
		entries = append(entries, model.EcommerceKnowledgeEntry{ID: id, SourceID: industryTaxonomySourceID, KnowledgeDomain: "KB18", KnowledgeType: "category_taxonomy", Title: node.Path, ContentJSON: string(content), Category: "taxonomy", PlatformsJSON: "[]", LanguagesJSON: "[]", RegionsJSON: "[]", TagsJSON: "[]", SourceURL: meta.URL, SourceCommit: meta.Commit, License: "MIT", Version: meta.Version, TrustLevel: "official_taxonomy", ReviewStatus: "approved", DedupHash: hex.EncodeToString(sum[:]), VerifiedAt: &now, CreatedAt: now, UpdatedAt: now})
	}
	err := s.repo.Transaction(func(tx *repository.Repository) error {
		if ready, err := installed(tx); err != nil {
			return err
		} else if ready {
			report.AlreadyInstalled = true
			return nil
		}
		source, err := tx.EcommerceKnowledgeSource(industryTaxonomySourceID)
		if errors.Is(err, gorm.ErrRecordNotFound) {
			source = &model.EcommerceKnowledgeSource{ID: industryTaxonomySourceID, Name: "Shopify 全行业中英文分类字典", Status: "ready"}
		} else if err != nil {
			return err
		}
		source.URL, source.Repository, source.Commit, source.License, source.Version, source.LastSyncedAt = meta.URL, "Shopify/product-taxonomy", meta.Commit, "MIT", meta.Version, &now
		source.LicenseText = ecommercecatalog.LicenseText()
		if err := tx.UpsertEcommerceKnowledgeSource(source); err != nil {
			return err
		}
		if report.Inserted, err = tx.InsertEcommerceKnowledgeEntries(entries); err != nil {
			return err
		}
		return tx.SaveSystemSetting(&model.SystemSetting{Key: industryTaxonomyReceiptKey, ValueJSON: string(receipt)})
	})
	return report, err
}

func industryBranchKnowledge() []model.EcommerceKnowledgeEntry {
	var entries []model.EcommerceKnowledgeEntry
	for _, node := range ecommercecatalog.LevelTwo() {
		match := ecommercecatalog.Method(node)
		content, _ := json.Marshal(map[string]string{"guidance": ecommercecatalog.Context(match), "skillId": "ecom-industry-" + node.RootID, "taxonomyId": node.ID, "methodScope": match.MethodScope, "methodAncestorId": match.MethodAncestorID})
		entries = append(entries, model.EcommerceKnowledgeEntry{ID: "kb19-industry-" + node.ID, SourceID: "meiye-kb19", KnowledgeDomain: "KB19", KnowledgeType: "industry_method", Title: node.Path + " · 子品类创作路由", ContentJSON: string(content), Category: match.Group, PlatformsJSON: "[]", LanguagesJSON: "[]", RegionsJSON: "[]", TagsJSON: "[]", SourceURL: "builtin://meiyeai/industry-methods/" + node.ID, Version: "kb19-v1-20261101", License: "MeiYeAI Original", TrustLevel: "first_party", ReviewStatus: "approved"})
	}
	return entries
}

func (s *Service) EcommerceIndustryCoverage() (map[string]any, error) {
	meta := ecommercecatalog.Metadata()
	count, err := s.repo.EcommerceKnowledgeSourceEntryCount(industryTaxonomySourceID, meta.Commit)
	if err != nil {
		return nil, err
	}
	return map[string]any{"source": meta, "indexedNodes": count, "industryMethods": len(ecommercecatalog.RootPlaybooks), "specializedAncestors": len(ecommercecatalog.FamilyPlaybooks), "coverageBoundary": "分类目录完整覆盖；创作方法按最近祖先继承，不代表所有叶级品类已逐一生成验收"}, nil
}

func (s *Service) EcommerceIndustryCategories(actor *model.User, parent, query string, page, limit int) (map[string]any, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if len([]rune(query)) > 128 {
		return nil, BadAuthRequest("分类搜索词过长")
	}
	if parent != "" {
		if _, ok := ecommercecatalog.Lookup(parent); !ok {
			return nil, BadAuthRequest("分类不存在")
		}
	}
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	rows, total := ecommercecatalog.Browse(parent, strings.TrimSpace(query), page, limit)
	coverage, err := s.EcommerceIndustryCoverage()
	if err != nil {
		return nil, err
	}
	return map[string]any{"nodes": rows, "total": total, "page": page, "limit": limit, "lineage": ecommercecatalog.Lineage(parent), "coverage": coverage}, nil
}
