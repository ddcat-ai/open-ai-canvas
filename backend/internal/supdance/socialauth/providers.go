package socialauth

import (
	"strings"
)

var ProviderRegistry = map[string]ProviderMeta{
	ProviderQQ: {
		ID:          ProviderQQ,
		Name:        "QQ 登录",
		Platform:    "QQ Connect 网页授权",
		Region:      RegionCN,
		Icon:        "qq",
		DefaultPath: "/api/auth/qq/callback",
		DocURL:      "https://connect.qq.com/",
	},
	ProviderWeChat: {
		ID:          ProviderWeChat,
		Name:        "微信登录",
		Platform:    "WeChat Open Platform 扫码授权",
		Region:      RegionCN,
		Icon:        "wechat",
		DefaultPath: "/api/auth/oauth/wechat/callback",
		DocURL:      "https://open.weixin.qq.com/",
	},
	ProviderDouyin: {
		ID:          ProviderDouyin,
		Name:        "抖音登录",
		Platform:    "Douyin Login Kit",
		Region:      RegionCN,
		Icon:        "douyin",
		DefaultPath: "/api/auth/oauth/douyin/callback",
		DocURL:      "https://open.douyin.com/",
	},
	ProviderBilibili: {
		ID:          ProviderBilibili,
		Name:        "哔哩哔哩登录",
		Platform:    "哔哩哔哩网页授权 OAuth 2.0",
		Region:      RegionCN,
		Icon:        "bilibili",
		DefaultPath: "/api/auth/oauth/bilibili/callback",
		DocURL:      "https://open.bilibili.com/",
	},
	ProviderGoogle: {
		ID:          ProviderGoogle,
		Name:        "Google 登录",
		Platform:    "Google Identity Services",
		Region:      RegionIntl,
		Icon:        "google",
		DefaultPath: "/api/auth/social/google/callback",
		DocURL:      "https://developers.google.com/identity",
	},
	ProviderX: {
		ID:          ProviderX,
		Name:        "X 登录",
		Platform:    "X OAuth 2.0 with PKCE",
		Region:      RegionIntl,
		Icon:        "x",
		DefaultPath: "/api/auth/social/x/callback",
		DocURL:      "https://developer.x.com/",
	},
	ProviderInstagram: {
		ID:          ProviderInstagram,
		Name:        "Instagram 登录",
		Platform:    "Instagram Basic Display API",
		Region:      RegionIntl,
		Icon:        "instagram",
		DefaultPath: "/api/auth/social/instagram/callback",
		DocURL:      "https://developers.facebook.com/docs/instagram-basic-display-api",
	},
	ProviderTikTok: {
		ID:          ProviderTikTok,
		Name:        "TikTok 登录",
		Platform:    "TikTok Login Kit",
		Region:      RegionIntl,
		Icon:        "tiktok",
		DefaultPath: "/api/auth/social/tiktok/callback",
		DocURL:      "https://developers.tiktok.com/",
	},
}

// MaskSecret formats client secret to ••••••••abcd
func MaskSecret(secret string) string {
	secret = strings.TrimSpace(secret)
	if secret == "" {
		return ""
	}
	if len(secret) <= 4 {
		return "••••••••"
	}
	return "••••••••" + secret[len(secret)-4:]
}

// MaskClientID formats client ID to ****5200 or ••••••••6kuf
func MaskClientID(id string) string {
	id = strings.TrimSpace(id)
	if id == "" {
		return ""
	}
	if len(id) <= 4 {
		return "****"
	}
	return "****" + id[len(id)-4:]
}

// DefaultInitialSettings returns the default configuration for all 8 providers,
// pre-seeding the initial state matching Figure 3 (QQ, Douyin, Bilibili ready, WeChat credentials missing).
func DefaultInitialSettings() StoredSettings {
	return StoredSettings{
		DefaultFallbackRegion: RegionCN,
		Providers: map[string]ProviderConfig{
			ProviderQQ: {
				Enabled:      true,
				ClientID:     "102035200",
				ClientSecret: "mock_qq_secret_0QEo",
				Scopes:       []string{"get_user_info"},
			},
			ProviderWeChat: {
				Enabled:      true,
				ClientID:     "",
				ClientSecret: "",
				Scopes:       []string{"snsapi_login"},
			},
			ProviderDouyin: {
				Enabled:      true,
				ClientID:     "aw8n726kuf",
				ClientSecret: "mock_douyin_secret_70b6",
				Scopes:       []string{"user_info"},
			},
			ProviderBilibili: {
				Enabled:      true,
				ClientID:     "bb4aec99",
				ClientSecret: "mock_bili_secret_78e3",
				Scopes:       []string{"identify"},
			},
			ProviderGoogle: {
				Enabled:      false,
				ClientID:     "",
				ClientSecret: "",
				Scopes:       []string{"openid", "profile", "email"},
			},
			ProviderX: {
				Enabled:      false,
				ClientID:     "",
				ClientSecret: "",
				Scopes:       []string{"users.read", "tweet.read"},
			},
			ProviderInstagram: {
				Enabled:      false,
				ClientID:     "",
				ClientSecret: "",
				Scopes:       []string{"user_profile"},
			},
			ProviderTikTok: {
				Enabled:      false,
				ClientID:     "",
				ClientSecret: "",
				Scopes:       []string{"user.info.basic"},
			},
		},
	}
}
