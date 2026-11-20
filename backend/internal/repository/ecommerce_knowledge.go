package repository

import (
	"errors"
	"strings"
	"time"

	"gorm.io/gorm"
	"gorm.io/gorm/clause"
	"yingce/backend/internal/model"
)

func (r *Repository) InsertEcommerceKnowledgeSources(sources []model.EcommerceKnowledgeSource) (int64, error) {
	if len(sources) == 0 {
		return 0, nil
	}
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(sources, 100)
	return result.RowsAffected, result.Error
}

func (r *Repository) InsertEcommerceKnowledgeEntries(entries []model.EcommerceKnowledgeEntry) (int64, error) {
	if len(entries) == 0 {
		return 0, nil
	}
	result := r.db.Clauses(clause.OnConflict{DoNothing: true}).CreateInBatches(entries, 100)
	return result.RowsAffected, result.Error
}

func (r *Repository) EcommerceKnowledgeEntryExists(hash string) (bool, error) {
	var count int64
	err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Where("dedup_hash = ?", hash).Count(&count).Error
	return count > 0, err
}

func (r *Repository) EcommerceKnowledgeSourceEntryCount(sourceID, commit string) (int64, error) {
	var count int64
	err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Where("source_id = ? AND source_commit = ?", sourceID, commit).Count(&count).Error
	return count, err
}

func (r *Repository) EcommerceKnowledgeSources() ([]model.EcommerceKnowledgeSource, error) {
	var sources []model.EcommerceKnowledgeSource
	err := r.db.Order("name ASC").Find(&sources).Error
	return sources, err
}

func (r *Repository) EcommerceKnowledgeEntries() ([]model.EcommerceKnowledgeEntry, error) {
	var entries []model.EcommerceKnowledgeEntry
	err := r.db.Where("review_status = ?", "approved").Find(&entries).Error
	return entries, err
}

func (r *Repository) EcommerceKnowledgeByIDs(ids []string) ([]model.EcommerceKnowledgeEntry, error) {
	var result []model.EcommerceKnowledgeEntry
	if len(ids) == 0 {
		return result, nil
	}
	err := r.db.Where("id IN ? AND review_status = ? AND (valid_until IS NULL OR valid_until > ?)", ids, "approved", time.Now().UTC()).Find(&result).Error
	return result, err
}

func (r *Repository) SearchEcommerceKnowledgeEntries(category, query string) ([]model.EcommerceKnowledgeEntry, error) {
	var entries []model.EcommerceKnowledgeEntry
	now := time.Now().UTC()
	base := func() *gorm.DB {
		return r.db.Where("review_status = ? AND (valid_until IS NULL OR valid_until > ?)", "approved", now)
	}
	// General methods are ranked in the service. A small limit here sorted by
	// type would silently drop whole knowledge domains (e.g. trend or quality).
	if err := base().Where("category = ?", "general").Order("knowledge_type ASC, title ASC").Limit(400).Find(&entries).Error; err != nil {
		return nil, err
	}
	if category == "general" {
		return entries, nil
	}
	terms := strings.FieldsFunc(strings.ToLower(query), func(ch rune) bool {
		return ch == ' ' || ch == '\n' || ch == ',' || ch == '，' || ch == '。' || ch == '；'
	})
	for _, mapping := range []struct{ zh, en string }{{"耳机", "headphone"}, {"奶瓶", "baby bottle"}, {"洗面奶", "facial cleanser"}, {"连衣裙", "dress"}, {"女装", "clothing"}, {"沙发", "sofa"}, {"珠宝", "jewelry"}, {"咖啡", "coffee"}, {"手表", "watch"}, {"手机", "mobile phone"}, {"玩具", "toy"}, {"灯具", "lighting"}, {"宠物", "pet"}, {"电脑", "computer"}, {"鞋", "shoe"}, {"箱包", "bag"}, {"香水", "perfume"}, {"口红", "lipstick"}, {"文具", "stationery"}, {"园艺", "garden"}} {
		if strings.Contains(query, mapping.zh) {
			terms = append(terms, mapping.en)
		}
	}
	matched := make([]model.EcommerceKnowledgeEntry, 0, 32)
	for _, term := range terms {
		if len([]rune(term)) < 2 || len([]rune(term)) > 80 {
			continue
		}
		// Treat query text as data even when it contains SQL LIKE metacharacters.
		term = strings.NewReplacer("%", "", "_", "").Replace(term)
		if term == "" {
			continue
		}
		var found []model.EcommerceKnowledgeEntry
		like := "%" + term + "%"
		if err := base().Where("category = ? AND (LOWER(title) LIKE ? OR LOWER(tags_json) LIKE ? OR LOWER(content_json) LIKE ? OR LOWER(platforms_json) LIKE ?)", category, like, like, like, like).
			Order("updated_at DESC, knowledge_type ASC, title ASC").Limit(24).Find(&found).Error; err != nil {
			return nil, err
		}
		matched = append(matched, found...)
		if len(matched) >= 64 {
			break
		}
	}
	// Always include the category's own entries: Chinese queries are not word
	// separated, so one keyword hit must not hide the rest of the category.
	var byCategory []model.EcommerceKnowledgeEntry
	if err := base().Where("category = ?", category).Order("updated_at DESC, knowledge_type ASC, title ASC").Limit(48).Find(&byCategory).Error; err != nil {
		return nil, err
	}
	matched = append(matched, byCategory...)
	seen := map[string]bool{}
	result := make([]model.EcommerceKnowledgeEntry, 0, len(entries)+len(matched))
	for _, entry := range append(entries, matched...) {
		if !seen[entry.ID] {
			result = append(result, entry)
			seen[entry.ID] = true
		}
	}
	return result, nil
}

func (r *Repository) EcommerceKnowledgeCounts() (int64, int64, error) {
	var total, approved int64
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Count(&total).Error; err != nil {
		return 0, 0, err
	}
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Where("review_status = ? AND (valid_until IS NULL OR valid_until > ?)", "approved", time.Now().UTC()).Count(&approved).Error; err != nil {
		return 0, 0, err
	}
	return total, approved, nil
}

func (r *Repository) EcommerceKnowledgeStatusCounts() (map[string]int64, error) {
	var rows []struct {
		ReviewStatus string
		Count        int64
	}
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Select("review_status, count(*) AS count").Group("review_status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := make(map[string]int64, len(rows))
	for _, row := range rows {
		counts[row.ReviewStatus] = row.Count
	}
	return counts, nil
}

func (r *Repository) EcommerceKnowledgeCoverage() (map[string]int64, int64, error) {
	var rows []struct {
		Category string
		Count    int64
	}
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Select("category, count(*) AS count").
		Where("review_status = ? AND (valid_until IS NULL OR valid_until > ?)", "approved", time.Now().UTC()).
		Group("category").Scan(&rows).Error; err != nil {
		return nil, 0, err
	}
	coverage := make(map[string]int64, len(rows))
	for _, row := range rows {
		coverage[row.Category] = row.Count
	}
	var expired int64
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Where("valid_until <= ?", time.Now().UTC()).Count(&expired).Error; err != nil {
		return nil, 0, err
	}
	return coverage, expired, nil
}

func (r *Repository) EcommerceKnowledgeDomainCoverage() (map[string]int64, error) {
	var rows []struct {
		KnowledgeDomain string
		Count           int64
	}
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).
		Select("knowledge_domain, count(*) AS count").
		Where("review_status = ? AND (valid_until IS NULL OR valid_until > ?) AND knowledge_domain <> ''", "approved", time.Now().UTC()).
		Group("knowledge_domain").Scan(&rows).Error; err != nil {
		return nil, err
	}
	coverage := make(map[string]int64, len(rows))
	for _, row := range rows {
		coverage[row.KnowledgeDomain] = row.Count
	}
	return coverage, nil
}

func (r *Repository) EcommerceKnowledgeEntryPage(keyword, status string, page, limit int) ([]model.EcommerceKnowledgeEntry, int64, error) {
	query := r.db.Model(&model.EcommerceKnowledgeEntry{})
	if keyword != "" {
		query = query.Where("LOWER(title) LIKE ?", "%"+strings.ToLower(keyword)+"%")
	}
	if status != "" {
		query = query.Where("review_status = ?", status)
	}
	var total int64
	if err := query.Count(&total).Error; err != nil {
		return nil, 0, err
	}
	var entries []model.EcommerceKnowledgeEntry
	err := query.Order("updated_at DESC, id ASC").Offset((page - 1) * limit).Limit(limit).Find(&entries).Error
	return entries, total, err
}

func (r *Repository) ReviewEcommerceKnowledgeEntry(id, status string) error {
	result := r.db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ?", id).Update("review_status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) EcommerceKnowledgeSource(id string) (*model.EcommerceKnowledgeSource, error) {
	var source model.EcommerceKnowledgeSource
	err := r.db.Where("id = ?", id).First(&source).Error
	return &source, err
}

func (r *Repository) SetEcommerceKnowledgeSourceStatus(id, status string) error {
	result := r.db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", id).Update("status", status)
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) UpsertEcommerceKnowledgeSource(source *model.EcommerceKnowledgeSource) error {
	var existing model.EcommerceKnowledgeSource
	err := r.db.Where("id = ?", source.ID).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(source).Error
	}
	if err != nil {
		return err
	}
	return r.db.Model(&existing).Updates(map[string]any{
		"name": source.Name, "url": source.URL, "repository": source.Repository,
		"commit": source.Commit, "license": source.License, "license_text": source.LicenseText, "version": source.Version,
		"status": source.Status, "last_synced_at": source.LastSyncedAt,
		"error_message": source.ErrorMessage, "last_duplicate_count": source.LastDuplicateCount,
	}).Error
}

func (r *Repository) UpsertEcommerceKnowledgeEntry(entry *model.EcommerceKnowledgeEntry) error {
	var existing model.EcommerceKnowledgeEntry
	err := r.db.Where("dedup_hash = ?", entry.DedupHash).First(&existing).Error
	if errors.Is(err, gorm.ErrRecordNotFound) {
		return r.db.Create(entry).Error
	}
	if err != nil {
		return err
	}
	return r.db.Model(&existing).Updates(map[string]any{
		"source_id": entry.SourceID, "knowledge_domain": entry.KnowledgeDomain, "knowledge_type": entry.KnowledgeType,
		"title": entry.Title, "content_json": entry.ContentJSON, "category": entry.Category,
		"platforms_json": entry.PlatformsJSON, "languages_json": entry.LanguagesJSON, "regions_json": entry.RegionsJSON,
		"applicability_json": entry.ApplicabilityJSON, "exclusions_json": entry.ExclusionsJSON,
		"related_cases_json": entry.RelatedCasesJSON, "related_quality_rules_json": entry.RelatedQualityRulesJSON,
		"styles_json": entry.StylesJSON, "image_types_json": entry.ImageTypesJSON,
		"tags_json": entry.TagsJSON, "source_url": entry.SourceURL, "source_commit": entry.SourceCommit,
		"license": entry.License, "version": entry.Version, "verified_at": entry.VerifiedAt,
		"valid_until": entry.ValidUntil, "trust_level": entry.TrustLevel,
	}).Error
}

// EcommerceKnowledgeEntryByID returns one entry regardless of review status so
// the built-in bootstrap can compare a stored row with its shipped version.
func (r *Repository) EcommerceKnowledgeEntryByID(id string) (*model.EcommerceKnowledgeEntry, error) {
	var entry model.EcommerceKnowledgeEntry
	err := r.db.Where("id = ?", id).First(&entry).Error
	return &entry, err
}

func (r *Repository) CreateEcommerceKnowledgeEntry(entry *model.EcommerceKnowledgeEntry) error {
	return r.db.Create(entry).Error
}

// UpdateBuiltinEcommerceKnowledgeEntry replaces shipped content only when the
// stored row still carries the expected hash. Review status is never touched,
// so an administrator's rejection survives a knowledge upgrade.
func (r *Repository) UpdateBuiltinEcommerceKnowledgeEntry(id, expectedHash string, entry *model.EcommerceKnowledgeEntry) (bool, error) {
	result := r.db.Model(&model.EcommerceKnowledgeEntry{}).Where("id = ? AND dedup_hash = ?", id, expectedHash).Updates(map[string]any{
		"source_id": entry.SourceID, "knowledge_domain": entry.KnowledgeDomain, "knowledge_type": entry.KnowledgeType,
		"title": entry.Title, "content_json": entry.ContentJSON, "category": entry.Category,
		"platforms_json": entry.PlatformsJSON, "languages_json": entry.LanguagesJSON, "regions_json": entry.RegionsJSON,
		"tags_json": entry.TagsJSON, "source_url": entry.SourceURL, "license": entry.License,
		"version": entry.Version, "dedup_hash": entry.DedupHash, "updated_at": time.Now().UTC(),
	})
	return result.RowsAffected == 1, result.Error
}

// UpdateBuiltinEcommerceKnowledgeSource refreshes descriptive fields but keeps
// the administrator's enable/disable status.
func (r *Repository) UpdateBuiltinEcommerceKnowledgeSource(source *model.EcommerceKnowledgeSource) error {
	return r.db.Model(&model.EcommerceKnowledgeSource{}).Where("id = ?", source.ID).Updates(map[string]any{
		"name": source.Name, "url": source.URL, "license": source.License, "version": source.Version,
		"last_synced_at": source.LastSyncedAt, "error_message": "",
	}).Error
}

func (r *Repository) CreateEcommerceKnowledgeSource(source *model.EcommerceKnowledgeSource) error {
	return r.db.Create(source).Error
}

// EcommerceKnowledgeDomainStatusCounts counts stored rows of one source prefix
// by domain and review status for audit reports.
func (r *Repository) EcommerceKnowledgeDomainStatusCounts(sourcePrefix string) (map[string]map[string]int64, error) {
	var rows []struct {
		KnowledgeDomain string
		ReviewStatus    string
		Count           int64
	}
	if err := r.db.Model(&model.EcommerceKnowledgeEntry{}).Select("knowledge_domain, review_status, count(*) AS count").
		Where("source_id LIKE ?", sourcePrefix+"%").Group("knowledge_domain, review_status").Scan(&rows).Error; err != nil {
		return nil, err
	}
	counts := map[string]map[string]int64{}
	for _, row := range rows {
		if counts[row.KnowledgeDomain] == nil {
			counts[row.KnowledgeDomain] = map[string]int64{}
		}
		counts[row.KnowledgeDomain][row.ReviewStatus] = row.Count
	}
	return counts, nil
}

func (r *Repository) CreateEcommerceRecommendation(item *model.EcommerceCreativeRecommendation) error {
	return r.db.Create(item).Error
}

func (r *Repository) EcommerceRecommendation(userID, id string) (*model.EcommerceCreativeRecommendation, error) {
	var item model.EcommerceCreativeRecommendation
	err := r.db.Where("user_id = ? AND id = ?", userID, id).First(&item).Error
	return &item, err
}

// SelectEcommerceRecommendationStyle stores the directions including the
// user's final style and selects it in one conditional update, so two
// concurrent confirmations cannot both win.
func (r *Repository) SelectEcommerceRecommendationStyle(userID, id, directionID, directionsJSON string) error {
	result := r.db.Model(&model.EcommerceCreativeRecommendation{}).
		Where("user_id = ? AND id = ? AND selected_direction_id = ''", userID, id).
		Updates(map[string]any{"selected_direction_id": directionID, "status": "selected", "directions_json": directionsJSON})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}

func (r *Repository) SelectEcommerceRecommendationDirection(userID, id, directionID string) error {
	result := r.db.Model(&model.EcommerceCreativeRecommendation{}).
		Where("user_id = ? AND id = ? AND (selected_direction_id = '' OR selected_direction_id = ?)", userID, id, directionID).
		Updates(map[string]any{"selected_direction_id": directionID, "status": "selected"})
	if result.Error != nil {
		return result.Error
	}
	if result.RowsAffected == 0 {
		return gorm.ErrRecordNotFound
	}
	return nil
}
