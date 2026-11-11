package model

import (
	"encoding/json"
	"time"
)

// EcommerceProject stores versioned ecommerce drafts and execution snapshots.
// Existing historical rows remain readable; new workflows do not rewrite them.
type EcommerceProject struct {
	ID        string `json:"id" gorm:"primaryKey;size:36"`
	UserID    string `json:"userId" gorm:"size:36;not null;index:idx_ecommerce_owner_updated,priority:1"`
	Name      string `json:"name" gorm:"size:160;not null"`
	Status    string `json:"status" gorm:"size:32;not null"`
	DraftJSON string `json:"draftJson" gorm:"type:text;not null"`
	PlanJSON  string `json:"planJson" gorm:"type:text;not null"`
	// ActiveRoundID separates the bounded active plan from archived rounds. It is
	// empty on projects created before rounds existed until their first save.
	ActiveRoundID string    `json:"activeRoundId,omitempty" gorm:"size:64;index"`
	Revision      int64     `json:"revision" gorm:"not null;default:1"`
	CreatedAt     time.Time `json:"createdAt"`
	UpdatedAt     time.Time `json:"updatedAt" gorm:"index:idx_ecommerce_owner_updated,priority:2"`
	// Response-only fields. They are never persisted on the project row.
	RoundCount   int64    `json:"roundCount,omitempty" gorm:"-"`
	CoverTaskIDs []string `json:"coverTaskIds,omitempty" gorm:"-"`
}

// EcommerceRound is one immutable archived planning round. The whole round is
// written once when the user starts the next round; history edits only touch a
// single image with an optimistic version. Images keep their original task and
// resource references, so archiving never creates or re-bills tasks.
type EcommerceRound struct {
	ID         string    `json:"id" gorm:"primaryKey;size:64"`
	UserID     string    `json:"userId" gorm:"size:36;not null;index:idx_ecommerce_round_list,priority:1"`
	ProjectID  string    `json:"projectId" gorm:"size:36;not null;uniqueIndex:idx_ecommerce_round_ordinal,priority:1;uniqueIndex:idx_ecommerce_round_dedup,priority:1;index:idx_ecommerce_round_list,priority:2"`
	Ordinal    int       `json:"ordinal" gorm:"not null;uniqueIndex:idx_ecommerce_round_ordinal,priority:2;index:idx_ecommerce_round_list,priority:3"`
	DedupKey   string    `json:"-" gorm:"size:64;not null;uniqueIndex:idx_ecommerce_round_dedup,priority:2"`
	DraftJSON  string    `json:"-" gorm:"type:text;not null"`
	PlanJSON   string    `json:"-" gorm:"type:text;not null"`
	ImageCount int       `json:"imageCount" gorm:"not null"`
	Version    int64     `json:"version" gorm:"not null;default:1"`
	CreatedAt  time.Time `json:"createdAt"`
	UpdatedAt  time.Time `json:"updatedAt"`
}

// EcommerceKnowledgeSource tracks an auditable upstream knowledge source.
// Content is normalized into EcommerceKnowledgeEntry rows; no upstream code is executed.
type EcommerceKnowledgeSource struct {
	ID                 string     `json:"id" gorm:"primaryKey;size:80"`
	Name               string     `json:"name" gorm:"size:160;not null"`
	URL                string     `json:"url" gorm:"size:500;not null"`
	Repository         string     `json:"repository" gorm:"size:240"`
	Commit             string     `json:"commit" gorm:"size:80"`
	License            string     `json:"license" gorm:"size:120"`
	LicenseText        string     `json:"licenseText" gorm:"type:text"`
	Version            string     `json:"version" gorm:"size:120"`
	Status             string     `json:"status" gorm:"size:32;not null;index"`
	LastSyncedAt       *time.Time `json:"lastSyncedAt"`
	ErrorMessage       string     `json:"errorMessage" gorm:"type:text"`
	LastDuplicateCount int64      `json:"lastDuplicateCount" gorm:"not null;default:0"`
	CreatedAt          time.Time  `json:"createdAt"`
	UpdatedAt          time.Time  `json:"updatedAt"`
}

// EcommerceKnowledgeEntry is a small, searchable, normalized knowledge unit.
// JSON columns are deliberately stored as text so SQLite and PostgreSQL share the same contract.
type EcommerceKnowledgeEntry struct {
	ID       string `json:"id" gorm:"primaryKey;size:80"`
	SourceID string `json:"sourceId" gorm:"size:80;not null;index"`
	// KnowledgeDomain is the auditable KB01-KB10 domain label. It is nullable in
	// practice so historical rows remain readable until an administrator
	// re-syncs or reviews them.
	KnowledgeDomain         string     `json:"knowledgeDomain" gorm:"size:16;index:idx_ecommerce_knowledge_domain"`
	KnowledgeType           string     `json:"knowledgeType" gorm:"size:48;not null;index"`
	Title                   string     `json:"title" gorm:"size:240;not null"`
	ContentJSON             string     `json:"contentJson" gorm:"type:text;not null"`
	Category                string     `json:"category" gorm:"size:120;index"`
	PlatformsJSON           string     `json:"platformsJson" gorm:"type:text"`
	LanguagesJSON           string     `json:"languagesJson" gorm:"type:text"`
	RegionsJSON             string     `json:"regionsJson" gorm:"type:text"`
	ApplicabilityJSON       string     `json:"applicabilityJson" gorm:"type:text"`
	ExclusionsJSON          string     `json:"exclusionsJson" gorm:"type:text"`
	RelatedCasesJSON        string     `json:"relatedCasesJson" gorm:"type:text"`
	RelatedQualityRulesJSON string     `json:"relatedQualityRulesJson" gorm:"type:text"`
	StylesJSON              string     `json:"stylesJson" gorm:"type:text"`
	ImageTypesJSON          string     `json:"imageTypesJson" gorm:"type:text"`
	TagsJSON                string     `json:"tagsJson" gorm:"type:text"`
	SourceURL               string     `json:"sourceUrl" gorm:"size:500"`
	SourceCommit            string     `json:"sourceCommit" gorm:"size:80"`
	License                 string     `json:"license" gorm:"size:120"`
	Version                 string     `json:"version" gorm:"size:120"`
	VerifiedAt              *time.Time `json:"verifiedAt"`
	ValidUntil              *time.Time `json:"validUntil"`
	TrustLevel              string     `json:"trustLevel" gorm:"size:24;index"`
	ReviewStatus            string     `json:"reviewStatus" gorm:"size:24;index"`
	DedupHash               string     `json:"dedupHash" gorm:"size:64;uniqueIndex"`
	CreatedAt               time.Time  `json:"createdAt"`
	UpdatedAt               time.Time  `json:"updatedAt"`
}

// EcommerceCreativeRecommendation persists the exact four directions shown to a user.
type EcommerceCreativeRecommendation struct {
	ID                  string    `json:"id" gorm:"primaryKey;size:80"`
	UserID              string    `json:"userId" gorm:"size:36;not null;index:idx_ecommerce_recommendation_owner,priority:1"`
	ProjectID           string    `json:"projectId" gorm:"size:80;not null;index:idx_ecommerce_recommendation_owner,priority:2"`
	InputSignature      string    `json:"inputSignature" gorm:"size:128;not null"`
	ProductCategory     string    `json:"productCategory" gorm:"size:120"`
	Platform            string    `json:"platform" gorm:"size:80"`
	Region              string    `json:"region" gorm:"size:80"`
	Language            string    `json:"language" gorm:"size:40"`
	DirectionsJSON      string    `json:"directionsJson" gorm:"type:text;not null"`
	EvidenceJSON        string    `json:"evidenceJson" gorm:"type:text"`
	SelectedDirectionID string    `json:"selectedDirectionId" gorm:"size:120"`
	Status              string    `json:"status" gorm:"size:24;not null;index"`
	CreatedAt           time.Time `json:"createdAt"`
	UpdatedAt           time.Time `json:"updatedAt"`
}

type EcommercePlanTask struct {
	SourceDraft          json.RawMessage           `json:"sourceDraft,omitempty"`
	ID                   string                    `json:"id"`
	ImageType            string                    `json:"imageType"`
	Platform             string                    `json:"platform"`
	Language             string                    `json:"language"`
	Goal                 string                    `json:"goal"`
	Theme                string                    `json:"theme"`
	Composition          string                    `json:"composition"`
	DisplayAssignment    string                    `json:"displayAssignment,omitempty"`
	MainVisual           string                    `json:"mainVisual"`
	VerifiedClaims       string                    `json:"verifiedClaims"`
	PerformanceAngle     string                    `json:"performanceAngle,omitempty"`
	InformationComponent string                    `json:"informationComponent,omitempty"`
	Copy                 string                    `json:"copy"`
	Lighting             string                    `json:"lighting"`
	Fidelity             string                    `json:"fidelity"`
	Prompt               string                    `json:"prompt"`
	ManualPrompt         bool                      `json:"manualPrompt,omitempty"`
	NegativePrompt       string                    `json:"negativePrompt"`
	ImageModel           string                    `json:"imageModel"`
	Ratio                string                    `json:"ratio"`
	Resolution           string                    `json:"resolution"`
	SkuID                string                    `json:"skuId,omitempty"`
	TaskID               string                    `json:"taskId,omitempty"`
	ReferenceScreen      *EcommerceReferenceScreen `json:"referenceScreen,omitempty"`
	// RoundID is attached only when serving archived rounds, so the client can
	// address a history edit without re-reading the whole project.
	RoundID string `json:"roundId,omitempty" gorm:"-"`
}

type EcommerceReferenceScreen struct {
	SourceResourceID string  `json:"sourceResourceId"`
	ScreenIndex      int     `json:"screenIndex"`
	Top              float64 `json:"top"`
	Bottom           float64 `json:"bottom"`
	Content          string  `json:"content"`
	Layout           string  `json:"layout"`
	Visual           string  `json:"visual"`
	SourceCopy       string  `json:"sourceCopy,omitempty"`
	ResourceID       string  `json:"resourceId,omitempty"`
}

type EcommercePlan struct {
	InputSignature   string              `json:"inputSignature,omitempty"`
	ProductSummary   string              `json:"productSummary"`
	ConfirmedFacts   []string            `json:"confirmedFacts"`
	UncertainFacts   []string            `json:"uncertainFacts"`
	VisualStrategy   string              `json:"visualStrategy"`
	QualityChecks    []string            `json:"qualityChecks"`
	Images           []EcommercePlanTask `json:"images"`
	PreviousImages   []EcommercePlanTask `json:"previousImages,omitempty"`
	ReferenceSummary string              `json:"referenceSummary,omitempty"`
}
