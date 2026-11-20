package app

import (
	"bufio"
	"bytes"
	"compress/gzip"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"regexp"
	"strings"
	"sync"
	"time"

	"yingce/backend/internal/model"
)

// The allowlist is pinned so a repository owner cannot change what a sync reads.
// Files are parsed as untrusted data; no downloaded code is ever executed.
type commerceSourceSpec struct {
	ID, Name, Repository, Commit, License string
	Documents                             []commerceDocumentSpec
}
type commerceDocumentSpec struct {
	Path, KnowledgeType, Category, Platforms string
}

var commerceSourceSpecs = []commerceSourceSpec{
	{"shopify-taxonomy", "Shopify Product Taxonomy", "Shopify/product-taxonomy", "2e9aa2e9b882383952c63d212add13eb80f46cf9", "MIT", []commerceDocumentSpec{{"categories.en.txt.gz", "product_knowledge", "taxonomy", "shopify"}}},
	{"kangise", "ecommerce-ai-skills", "kangise/ecommerce-ai-skills", "b1a727c3b2c2d27f2793e0d0fcd655ea446ba635", "CC0-1.0", []commerceDocumentSpec{{"dist/knowledge/index.json", "knowledge_index", "general", ""}}},
	{"nexscope", "eCommerce-Skills", "nexscope-ai/eCommerce-Skills", "ee0fb29433d02ccc22e3e6cea9ab4586d49fd42e", "MIT", []commerceDocumentSpec{
		{"shopify-product-photography-guide/SKILL.md", "photography", "general", "shopify"},
		{"ecommerce-landing-page/SKILL.md", "layout_pattern", "general", ""},
		{"conversion-rate-optimization/SKILL.md", "copywriting_pattern", "general", ""},
	}},
	{"dlazy", "ecommerce-skills", "dlazy-ai/ecommerce-skills", "87791a154beb9549aa32e57c9eeadc4ba0db0784", "MIT", []commerceDocumentSpec{
		{"skills/creative-scene/skill.md", "scene_pattern", "general", ""},
		{"skills/item-detail/skill.md", "detail_page_pattern", "general", ""},
		{"skills/item-selling-point/skill.md", "copywriting_pattern", "general", ""},
		{"skills/fission-pattern/skill.md", "prompt_pattern", "general", ""},
		{"skills/flat-lay/skill.md", "photography", "apparel", ""},
		{"skills/platform-compliance/skill.md", "quality_rule", "general", ""},
	}},
	{"buluslan-image2-ecommerce", "gpt-image2-ecommerce", "buluslan/gpt-image2-ecommerce", "73abd50bf2b689b5a453f28ddd7b0016415deec6", "MIT", []commerceDocumentSpec{
		{"SKILL.md", "prompt_pattern", "general", ""},
	}},
	{"motiful-product-shots", "product-shots", "motiful/product-shots", "063c508b0b7f4db5cda89f10bdf20df25026dfc5", "MIT", []commerceDocumentSpec{
		{"skills/product-shots-ad-creative/SKILL.md", "photography", "general", ""},
		{"skills/product-shots-ad-creative/references/composition-patterns.md", "layout_pattern", "general", ""},
		{"skills/product-shots-ad-creative/references/platform-style-profiles.md", "platform_rule", "general", ""},
		{"skills/product-shots-ad-creative/references/workflow-and-self-check.md", "quality_rule", "general", ""},
	}},
	{"xianyu-image-skills", "ecommerce-image-skills", "xianyu110/ecommerce-image-skills", "f4566fdc812584425728862ad8e08c90883d81ee", "MIT", []commerceDocumentSpec{
		{"skills/ecommerce-listing-suite/SKILL.md", "detail_page_pattern", "general", ""},
		{"skills/amazon-white-background/SKILL.md", "platform_rule", "tech", "amazon"},
		{"skills/selling-point-infographic/SKILL.md", "layout_pattern", "general", ""},
		{"skills/multi-angle-set/SKILL.md", "photography", "general", ""},
	}},
	{"creative-photo-prompts", "Open Product Photography Prompts", "JeremyGDM/awesome-ai-product-photography-prompts", "6815dab9c17ce20c5c554df4ecf28336fd0aef0a", "CC0-1.0", []commerceDocumentSpec{
		{"prompts/product-photography.md", "photography", "general", ""},
		{"prompts/poster-design.md", "visual_style", "general", ""},
	}},
	{"visual-copywriting", "Ecommerce Visual Copywriting", "feichanggege/ecommerce-visual-copywriting-skill", "4a5a6396cd54709a203a82065801f64d5cb7286e", "MIT", []commerceDocumentSpec{
		{"SKILL.md", "copywriting_pattern", "general", ""},
		{"references/platform-playbooks.md", "platform_rule", "general", ""},
	}},
	{"reference-image-analysis", "Image to Prompt", "gpt-img-2/image-to-prompt", "8f8d4b7ede9474a40941a3805165de68358e4c28", "MIT", []commerceDocumentSpec{
		{"README.md", "reference_method", "general", ""},
	}},
	{"copywriting-methods", "Copywriting", "entpnomad/copywriting", "c3b84cbda5bbc971bbfa31462a99563c15799506", "MIT", []commerceDocumentSpec{
		{"SKILL.md", "copywriting_pattern", "general", ""},
	}},
	{"image-style-craft", "Image Generation Style Craft", "guinacio/claude-image-gen", "9ae689d2f1163ccba1900fa58a75436ef4d8d75b", "MIT", []commerceDocumentSpec{
		{"skills/image-generation/references/prompt-crafting.md", "visual_style", "general", ""},
	}},
	{"shadcn-design-tokens", "shadcn/ui Design Tokens", "shadcn-ui/ui", "8f04138777c1b6996e709993362a7b0a12888ecf", "MIT", []commerceDocumentSpec{
		{"apps/v4/content/docs/(root)/theming.mdx", "layout_pattern", "general", ""},
	}},
}

var commerceHTTPClient = &http.Client{Timeout: 12 * time.Second}
var commerceSyncLock sync.Mutex

func commerceSourceImportVersion(spec commerceSourceSpec) string {
	// Changing the import recipe invalidates the completed-source shortcut even
	// when the upstream commit is unchanged (for example, adding a reviewed excerpt).
	reviewed := make(map[string]commerceReviewedExcerpt)
	// Preserve the version already deployed for the original sources. Earlier
	// releases hashed the entire five-entry review map for every source.
	legacy := spec.ID == "shopify-taxonomy" || spec.ID == "kangise" || spec.ID == "nexscope" || spec.ID == "dlazy" || spec.ID == "buluslan-image2-ecommerce" || spec.ID == "motiful-product-shots" || spec.ID == "xianyu-image-skills"
	for path, excerpt := range commerceReviewedExcerpts {
		original := strings.HasPrefix(path, "buluslan-image2-ecommerce/") || strings.HasPrefix(path, "motiful-product-shots/") || strings.HasPrefix(path, "xianyu-image-skills/")
		if strings.HasPrefix(path, spec.ID+"/") || (legacy && original) {
			reviewed[path] = excerpt
		}
	}
	recipe, _ := json.Marshal(struct {
		Documents []commerceDocumentSpec
		Reviewed  map[string]commerceReviewedExcerpt
	}{spec.Documents, reviewed})
	digest := sha256.Sum256(recipe)
	return spec.Commit[:12] + ":visual-v2:" + hex.EncodeToString(digest[:6])
}

func commerceFetch(ctx context.Context, url string, maxBytes int64) ([]byte, error) {
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return nil, err
	}
	req.Header.Set("User-Agent", "MeiYeAI-Knowledge-Importer/1.0")
	response, err := commerceHTTPClient.Do(req)
	if err != nil {
		return nil, err
	}
	defer response.Body.Close()
	if response.StatusCode != http.StatusOK {
		return nil, fmt.Errorf("source returned HTTP %d", response.StatusCode)
	}
	data, err := io.ReadAll(io.LimitReader(response.Body, maxBytes+1))
	if err != nil {
		return nil, err
	}
	if int64(len(data)) > maxBytes {
		return nil, fmt.Errorf("source exceeds %d bytes", maxBytes)
	}
	return data, nil
}

func commerceRawURL(source commerceSourceSpec, path string) string {
	return fmt.Sprintf("https://raw.githubusercontent.com/%s/%s/%s", source.Repository, source.Commit, path)
}

// The Contents API is an official fallback for networks that block the raw host.
// Pinning ref and decoding locally keeps both transports tied to the same revision.
func commerceFetchDocument(ctx context.Context, source commerceSourceSpec, path string, limit int64) ([]byte, error) {
	url := fmt.Sprintf("https://api.github.com/repos/%s/contents/%s?ref=%s", source.Repository, path, source.Commit)
	data, err := commerceFetch(ctx, url, limit*2+4096)
	if err == nil {
		var file struct {
			Encoding string `json:"encoding"`
			Content  string `json:"content"`
		}
		if json.Unmarshal(data, &file) == nil && file.Encoding == "base64" {
			decoded, decodeErr := base64.StdEncoding.DecodeString(strings.ReplaceAll(file.Content, "\n", ""))
			if decodeErr == nil && int64(len(decoded)) <= limit {
				return decoded, nil
			}
		}
	}
	return commerceFetch(ctx, commerceRawURL(source, path), limit)
}

func commerceEntry(source commerceSourceSpec, path, title, kind, category, platform, body string) model.EcommerceKnowledgeEntry {
	url := fmt.Sprintf("https://github.com/%s/blob/%s/%s", source.Repository, source.Commit, path)
	content, _ := json.Marshal(map[string]string{"guidance": body})
	platforms := "[]"
	if platform != "" {
		encoded, _ := json.Marshal([]string{platform})
		platforms = string(encoded)
	}
	hash := sha256.Sum256([]byte(source.Repository + "\x00" + source.Commit + "\x00" + path + "\x00" + title + "\x00" + body))
	idHash := sha256.Sum256([]byte(source.Repository + "\x00" + path + "\x00" + title))
	if len([]rune(title)) > 240 {
		title = string([]rune(title)[:240])
	}
	now := time.Now().UTC()
	return model.EcommerceKnowledgeEntry{ID: "ek-" + hex.EncodeToString(idHash[:12]), SourceID: "src-" + source.ID, KnowledgeDomain: ecommerceKnowledgeDomain(kind, category), KnowledgeType: kind, Title: title, ContentJSON: string(content), Category: category, PlatformsJSON: platforms, LanguagesJSON: "[]", TagsJSON: "[]", SourceURL: url, SourceCommit: source.Commit, License: source.License, Version: source.Commit[:12], TrustLevel: "community", ReviewStatus: "pending", DedupHash: hex.EncodeToString(hash[:]), CreatedAt: now, UpdatedAt: now}
}

var commerceCodeFence = regexp.MustCompile("(?s)```.*?```")
var commerceHTMLTag = regexp.MustCompile(`<[^>]+>`)

func commerceMarkdownGuidance(data []byte) (string, string) {
	clean := commerceCodeFence.ReplaceAllString(string(data), "")
	clean = commerceHTMLTag.ReplaceAllString(clean, "")
	lines := strings.Split(clean, "\n")
	title, textLines, included := "", make([]string, 0, 80), false
	for _, line := range lines {
		trimmed := strings.TrimSpace(line)
		if strings.HasPrefix(trimmed, "# ") && title == "" {
			title = strings.TrimSpace(strings.TrimPrefix(trimmed, "# "))
		}
		if strings.HasPrefix(trimmed, "## ") {
			heading := strings.ToLower(trimmed)
			included = strings.Contains(heading, "流程") || strings.Contains(heading, "步骤") || strings.Contains(heading, "原则") || strings.Contains(heading, "质量") || strings.Contains(heading, "注意") || strings.Contains(heading, "常见问题") || strings.Contains(heading, "摄影") || strings.Contains(heading, "构图") || strings.Contains(heading, "场景") || strings.Contains(heading, "capabilit") || strings.Contains(heading, "limitation")
		}
		if !included || trimmed == "" || strings.HasPrefix(trimmed, "|") || strings.Contains(trimmed, "npx ") || strings.HasPrefix(trimmed, "http") {
			continue
		}
		textLines = append(textLines, trimmed)
		if len(strings.Join(textLines, "\n")) > 4600 {
			break
		}
	}
	if title == "" {
		title = "电商视觉知识"
	}
	return title, strings.Join(textLines, "\n")
}

type commerceIndexRecord struct {
	ID              string   `json:"id"`
	Title           string   `json:"title"`
	Path            string   `json:"path"`
	Summary         string   `json:"summary"`
	BoundarySummary string   `json:"boundary_summary"`
	KeyEntities     []string `json:"key_entities"`
}

func commerceIndexEntries(source commerceSourceSpec, path string, data []byte) ([]model.EcommerceKnowledgeEntry, error) {
	var records []commerceIndexRecord
	if err := json.Unmarshal(data, &records); err != nil {
		return nil, err
	}
	entries := make([]model.EcommerceKnowledgeEntry, 0, len(records))
	for _, record := range records {
		if !strings.Contains(strings.ToLower(record.ID+record.Title), "visual") && !strings.Contains(strings.ToLower(record.ID+record.Title), "image") && !strings.Contains(strings.ToLower(record.ID+record.Title), "listing") && !strings.Contains(strings.ToLower(record.ID+record.Title), "广告") && !strings.Contains(strings.ToLower(record.ID+record.Title), "prompt") {
			continue
		}
		body := strings.TrimSpace(record.Summary + "\n适用边界：" + record.BoundarySummary)
		if len([]rune(body)) > 1800 {
			body = string([]rune(body)[:1800])
		}
		if body == "适用边界：" {
			continue
		}
		entry := commerceEntry(source, path, record.Title, "knowledge_index", "general", "", body)
		entry.ReviewStatus = "approved"
		entry.TagsJSON, _ = marshalCommerceTags(record.KeyEntities)
		entries = append(entries, entry)
	}
	return entries, nil
}

func marshalCommerceTags(tags []string) (string, error) {
	data, err := json.Marshal(tags)
	return string(data), err
}

// SyncEcommerceKnowledge is an explicit admin operation. It never runs in a user request.
func (s *Service) SyncEcommerceKnowledge(ctx context.Context, actor *model.User) (map[string]any, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	if !commerceSyncLock.TryLock() {
		return nil, BadAuthRequest("知识同步正在进行，请稍后再试")
	}
	defer commerceSyncLock.Unlock()
	currentSources, err := s.repo.EcommerceKnowledgeSources()
	if err != nil {
		return nil, err
	}
	disabled := make(map[string]bool, len(currentSources))
	for _, source := range currentSources {
		disabled[source.ID] = source.Status == "disabled"
	}
	imported, duplicates, failed := 0, 0, make([]string, 0)
	for _, spec := range commerceSourceSpecs {
		if disabled["src-"+spec.ID] {
			continue
		}
		version := commerceSourceImportVersion(spec)
		reused := false
		for _, existing := range currentSources {
			if existing.ID != "src-"+spec.ID || existing.Commit != spec.Commit || existing.Version != version || existing.Status != "ready" || existing.License != spec.License || existing.LicenseText == "" || existing.LastSyncedAt == nil {
				continue
			}
			count, err := s.repo.EcommerceKnowledgeSourceEntryCount(existing.ID, spec.Commit)
			if err != nil {
				return nil, err
			}
			if count < int64(len(spec.Documents)) {
				continue
			}
			existing.LastDuplicateCount = count
			if err := s.repo.UpsertEcommerceKnowledgeSource(&existing); err != nil {
				return nil, err
			}
			duplicates += int(count)
			reused = true
			break
		}
		if reused {
			continue
		}
		base := "https://github.com/" + spec.Repository
		source := model.EcommerceKnowledgeSource{ID: "src-" + spec.ID, Name: spec.Name, URL: base, Repository: spec.Repository, Commit: spec.Commit, License: spec.License, Version: version, Status: "syncing"}
		for _, existing := range currentSources {
			if existing.ID == source.ID && existing.Commit == source.Commit {
				source.LastSyncedAt, source.LicenseText = existing.LastSyncedAt, existing.LicenseText
			}
		}
		if err := s.repo.UpsertEcommerceKnowledgeSource(&source); err != nil {
			return nil, err
		}
		licensePath := "LICENSE"
		if spec.ID == "shadcn-design-tokens" {
			licensePath = "LICENSE.md"
		}
		license, err := commerceFetchDocument(ctx, spec, licensePath, 32<<10)
		mitVerified := strings.Contains(string(license), "MIT License") || (strings.Contains(string(license), "Permission is hereby granted") && strings.Contains(string(license), "THE SOFTWARE IS PROVIDED"))
		if err != nil || (spec.License == "MIT" && !mitVerified) || (spec.License == "CC0-1.0" && !strings.Contains(string(license), "CC0 1.0 Universal")) {
			source.Status, source.ErrorMessage = "license_unverified", fmt.Sprintf("license check failed: %v", err)
			// A transient transport failure must not invalidate previously checked content.
			if err != nil && source.LastSyncedAt != nil && source.LicenseText != "" {
				failure := source.ErrorMessage
				for _, existing := range currentSources {
					if existing.ID == source.ID && existing.Commit == source.Commit {
						source = existing
						source.ErrorMessage = failure
						break
					}
				}
			}
			_ = s.repo.UpsertEcommerceKnowledgeSource(&source)
			failed = append(failed, spec.Repository)
			continue
		}
		source.LicenseText = string(license)
		count, duplicateCount := 0, 0
		failedCount := 0
		for _, doc := range spec.Documents {
			limit := int64(256 << 10)
			var data []byte
			var fetchErr error
			if spec.ID == "shopify-taxonomy" {
				limit = 1 << 20
				data, fetchErr = commerceFetch(ctx, "https://github.com/Shopify/product-taxonomy/releases/download/v2026-08/categories.en.txt.gz", limit)
			} else {
				data, fetchErr = commerceFetchDocument(ctx, spec, doc.Path, limit)
			}
			if fetchErr != nil {
				failed = append(failed, spec.Repository+"/"+doc.Path)
				failedCount++
				continue
			}
			var entries []model.EcommerceKnowledgeEntry
			if spec.ID == "shopify-taxonomy" {
				entries, fetchErr = commerceTaxonomyEntries(spec, data)
			} else if doc.KnowledgeType == "knowledge_index" {
				entries, fetchErr = commerceIndexEntries(spec, doc.Path, data)
			} else {
				title, body := commerceMarkdownGuidance(data)
				if len([]rune(body)) < 80 {
					body = strings.TrimSpace(string(data))
					if len([]rune(body)) > 1800 {
						body = string([]rune(body)[:1800])
					}
				}
				entries = []model.EcommerceKnowledgeEntry{commerceEntry(spec, doc.Path, title, doc.KnowledgeType, doc.Category, doc.Platforms, body)}
				commerceApplyReviewedExcerpt(&entries[0], spec, doc.Path, data)
			}
			if fetchErr != nil {
				failed = append(failed, spec.Repository+"/"+doc.Path)
				failedCount++
				continue
			}
			if spec.ID == "shopify-taxonomy" {
				inserted, err := s.repo.InsertEcommerceKnowledgeEntries(entries)
				if err != nil {
					return nil, err
				}
				count += int(inserted)
				duplicateCount += len(entries) - int(inserted)
			} else {
				for i := range entries {
					exists, err := s.repo.EcommerceKnowledgeEntryExists(entries[i].DedupHash)
					if err != nil {
						return nil, err
					}
					if exists {
						duplicateCount++
						continue
					}
					if err := s.repo.UpsertEcommerceKnowledgeEntry(&entries[i]); err != nil {
						return nil, err
					}
					count++
				}
			}
		}
		now := time.Now().UTC()
		source.LastSyncedAt, source.Status = &now, "ready"
		source.LastDuplicateCount = int64(duplicateCount)
		if count == 0 && duplicateCount == 0 {
			source.Status = "empty"
		} else if failedCount > 0 {
			source.Status = "partial"
		}
		if err := s.repo.UpsertEcommerceKnowledgeSource(&source); err != nil {
			return nil, err
		}
		imported += count
		duplicates += duplicateCount
	}
	return map[string]any{"imported": imported, "duplicates": duplicates, "failed": failed}, nil
}

func commerceTaxonomyGroup(path string) string {
	root := strings.Split(path, " > ")[0]
	switch root {
	case "Electronics":
		return "tech"
	case "Health & Beauty":
		return "beauty"
	case "Baby & Toddler":
		return "maternal"
	case "Apparel & Accessories":
		return "apparel"
	case "Furniture", "Home & Garden":
		return "home"
	case "Food, Beverages & Tobacco":
		return "food"
	default:
		return "taxonomy"
	}
}

func commerceTaxonomyEntries(source commerceSourceSpec, data []byte) ([]model.EcommerceKnowledgeEntry, error) {
	reader, err := gzip.NewReader(bytes.NewReader(data))
	if err != nil {
		return nil, err
	}
	defer reader.Close()
	scanner := bufio.NewScanner(io.LimitReader(reader, 8<<20))
	scanner.Buffer(make([]byte, 4096), 256<<10)
	entries := make([]model.EcommerceKnowledgeEntry, 0, 15000)
	for scanner.Scan() {
		line := strings.TrimSpace(scanner.Text())
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		parts := strings.SplitN(line, ": ", 2)
		if len(parts) != 2 || !strings.HasPrefix(parts[0], "gid://shopify/TaxonomyCategory/") {
			continue
		}
		path := strings.TrimSpace(parts[1])
		entry := commerceEntry(source, "categories.en.txt.gz", path, "product_knowledge", commerceTaxonomyGroup(path), "", "Shopify 官方商品分类路径："+path+"。该分类仅用于商品归类，不证明具体商品的功能、材质或规格，也不是 Shopify 或其他平台的图片规则。")
		entry.SourceURL = "https://github.com/Shopify/product-taxonomy/releases/tag/v2026-08"
		entry.Version = "v2026-08"
		entry.TrustLevel = "official_taxonomy"
		entry.ReviewStatus = "approved"
		now := time.Now().UTC()
		entry.VerifiedAt = &now
		entries = append(entries, entry)
	}
	return entries, scanner.Err()
}
