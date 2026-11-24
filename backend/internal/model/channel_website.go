package model

import (
	"encoding/json"
	"net"
	"net/url"
	"strings"
	"time"

	"gorm.io/gorm"
)

// ChannelWebsite is an administration boundary; generation still uses ModelChannel.
type ChannelWebsite struct {
	ID          string         `json:"id" gorm:"primaryKey;size:36"`
	Scope       ChannelScope   `json:"-" gorm:"size:24;index"`
	Name        string         `json:"name" gorm:"size:80"`
	BaseURL     string         `json:"baseUrl"`
	APIFormat   string         `json:"apiFormat" gorm:"size:24"`
	ProxyURL    string         `json:"proxyUrl" gorm:"size:512"`
	HeadersJSON string         `json:"-" gorm:"type:text"`
	CreatedAt   time.Time      `json:"createdAt"`
	UpdatedAt   time.Time      `json:"updatedAt"`
	DeletedAt   gorm.DeletedAt `json:"-" gorm:"index"`
}

type ChannelCatalogSnapshot struct {
	ChannelID    string    `json:"-" gorm:"primaryKey;size:36"`
	SourceDigest string    `json:"-" gorm:"size:64"`
	ModelsJSON   string    `json:"-" gorm:"type:text"`
	ReadAt       time.Time `json:"readAt"`
}

type ChannelProtocolSelection struct {
	ID               uint64    `json:"-" gorm:"primaryKey;autoIncrement"`
	WebsiteID        string    `json:"-" gorm:"size:36;index:idx_website_protocol_selection,priority:1"`
	ProviderModelKey string    `json:"-" gorm:"size:120;index:idx_website_protocol_selection,priority:2"`
	Capability       string    `json:"-" gorm:"size:32;index:idx_website_protocol_selection,priority:3"`
	Protocol         string    `json:"protocol" gorm:"size:64"`
	ChannelModelID   string    `json:"-" gorm:"size:36"`
	ActorID          string    `json:"-" gorm:"size:36"`
	SelectedAt       time.Time `json:"selectedAt"`
}

// Only headers known to carry format/version information can cross Key boundaries.
// Unknown names remain private, even when their spelling does not look secret.
func IsWebsitePublicHeader(name string) bool {
	switch strings.ToLower(strings.TrimSpace(name)) {
	case "anthropic-version", "openai-beta":
		return true
	default:
		return false
	}
}

func WebsitePublicHeadersJSON(raw string) (string, bool) {
	var headers []struct {
		Name  string `json:"name"`
		Value string `json:"value"`
	}
	if strings.TrimSpace(raw) != "" && json.Unmarshal([]byte(raw), &headers) != nil {
		return "[]", false
	}
	public := headers[:0]
	allPublic := true
	for _, header := range headers {
		if IsWebsitePublicHeader(header.Name) {
			public = append(public, header)
		} else {
			allPublic = false
		}
	}
	if public == nil {
		return "[]", allPublic
	}
	encoded, _ := json.Marshal(public)
	return string(encoded), allPublic
}

// Paths, trailing slashes, queries and tenant identifiers are deliberately preserved.
func CanonicalWebsiteURL(raw string) string {
	u, err := url.Parse(strings.TrimSpace(raw))
	if err != nil || u.Host == "" {
		return strings.TrimSpace(raw)
	}
	u.Scheme = strings.ToLower(u.Scheme)
	host := strings.ToLower(u.Hostname())
	port := u.Port()
	if (u.Scheme == "https" && port == "443") || (u.Scheme == "http" && port == "80") {
		port = ""
	}
	if port != "" {
		u.Host = net.JoinHostPort(host, port)
	} else if strings.Contains(host, ":") {
		u.Host = "[" + host + "]"
	} else {
		u.Host = host
	}
	return u.String()
}
