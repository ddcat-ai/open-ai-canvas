package protocol

import (
	"fmt"
	"net/url"
	"strings"
)

// ValidateWalletLinks applies the same contract to uploaded manifests and saved settings.
func ValidateWalletLinks(links []ManifestWalletLink) error {
	if len(links) > 100 {
		return fmt.Errorf("最多配置 100 个购买入口")
	}
	seen := make(map[string]bool, len(links))
	for _, link := range links {
		if !validManifestIdentifier(link.ID) || seen[link.ID] || strings.TrimSpace(link.Label) == "" {
			return fmt.Errorf("购买入口需要唯一标识和显示名称")
		}
		seen[link.ID] = true
		parsed, err := url.Parse(link.URL)
		if err != nil || parsed.Hostname() == "" || (parsed.Scheme != "https" && parsed.Scheme != "http") || parsed.User != nil {
			return fmt.Errorf("购买地址必须是无账号密码的 http(s) 链接")
		}
		if len(link.Label) > 120 || len(link.Price) > 40 || len(link.Description) > 240 || len(link.URL) > 2048 {
			return fmt.Errorf("购买入口字段过长")
		}
	}
	return nil
}
