package socialauth

import (
	"net"
	"net/http"
	"strings"
)

// IPLocationResult contains resolved geolocation information for an HTTP request.
type IPLocationResult struct {
	ClientIP     string
	SourceHeader string
	Region       string // RegionCN ("cn") or RegionIntl ("intl")
	RegionLabel  string // "中国大陆" or "海外 / 国际"
	IsSimulated  bool
}

// Major Mainland China IPv4 CIDR blocks (covering China Telecom, China Unicom, China Mobile, CERNET)
var mainlandChinaCIDRs = []string{
	"1.0.1.0/24", "1.0.2.0/23", "1.0.8.0/21", "1.0.32.0/19",
	"14.0.0.0/8", "27.0.0.0/8", "36.0.0.0/8", "39.0.0.0/8",
	"42.0.0.0/8", "49.0.0.0/8", "58.0.0.0/8", "59.0.0.0/8",
	"60.0.0.0/8", "61.0.0.0/8", "101.0.0.0/8", "106.0.0.0/8",
	"110.0.0.0/8", "111.0.0.0/8", "112.0.0.0/8", "113.0.0.0/8",
	"114.0.0.0/8", "115.0.0.0/8", "116.0.0.0/8", "117.0.0.0/8",
	"118.0.0.0/8", "119.0.0.0/8", "120.0.0.0/8", "121.0.0.0/8",
	"122.0.0.0/8", "123.0.0.0/8", "124.0.0.0/8", "125.0.0.0/8",
	"175.0.0.0/8", "180.0.0.0/8", "182.0.0.0/8", "183.0.0.0/8",
	"188.131.0.0/16", "202.96.0.0/12", "202.108.0.0/16",
	"211.0.0.0/8", "218.0.0.0/8", "219.0.0.0/8", "220.0.0.0/8",
	"221.0.0.0/8", "222.0.0.0/8", "223.0.0.0/8",
}

// Special Hong Kong, Macao, Taiwan CIDR blocks (Must partition to RegionIntl)
var hkMoTwCIDRs = []string{
	// Hong Kong
	"14.0.128.0/18", "27.50.0.0/16", "42.2.0.0/15", "42.200.0.0/15",
	"58.152.0.0/15", "58.176.0.0/14", "103.1.0.0/16", "103.16.0.0/16",
	"116.48.0.0/14", "118.140.0.0/14", "202.64.0.0/14", "203.80.0.0/14",
	"218.102.0.0/15", "218.188.0.0/15", "218.252.0.0/14",
	// Macao
	"60.246.0.0/16", "122.100.128.0/17", "202.175.0.0/16",
	// Taiwan
	"59.120.0.0/13", "61.216.0.0/13", "111.240.0.0/12", "114.32.0.0/11",
	"118.160.0.0/12", "122.116.0.0/14", "140.109.0.0/16", "140.112.0.0/16",
	"210.60.0.0/14", "211.20.0.0/14", "218.160.0.0/12", "220.128.0.0/11",
}

var (
	parsedMainlandCIDRs []*net.IPNet
	parsedHkMoTwCIDRs   []*net.IPNet
)

func init() {
	for _, cidr := range mainlandChinaCIDRs {
		if _, ipNet, err := net.ParseCIDR(cidr); err == nil {
			parsedMainlandCIDRs = append(parsedMainlandCIDRs, ipNet)
		}
	}
	for _, cidr := range hkMoTwCIDRs {
		if _, ipNet, err := net.ParseCIDR(cidr); err == nil {
			parsedHkMoTwCIDRs = append(parsedHkMoTwCIDRs, ipNet)
		}
	}
}

// ExtractClientIP extracts the real client IP and the source header from the request.
func ExtractClientIP(r *http.Request) (string, string) {
	// 1. Check CF-Connecting-IP
	if cfIP := strings.TrimSpace(r.Header.Get("CF-Connecting-IP")); cfIP != "" {
		if ip := cleanIP(cfIP); ip != "" {
			return ip, "cf-connecting-ip"
		}
	}

	// 2. Check X-Real-IP
	if realIP := strings.TrimSpace(r.Header.Get("X-Real-IP")); realIP != "" {
		if ip := cleanIP(realIP); ip != "" {
			return ip, "x-real-ip"
		}
	}

	// 3. Check X-Forwarded-For (take the first client IP in chain)
	if xff := strings.TrimSpace(r.Header.Get("X-Forwarded-For")); xff != "" {
		parts := strings.Split(xff, ",")
		for _, part := range parts {
			if ip := cleanIP(part); ip != "" {
				return ip, "x-forwarded-for"
			}
		}
	}

	// 4. Fallback to RemoteAddr
	remoteIP := cleanIP(r.RemoteAddr)
	if remoteIP == "" {
		remoteIP = "127.0.0.1"
	}
	return remoteIP, "remote-addr"
}

func cleanIP(raw string) string {
	raw = strings.TrimSpace(raw)
	if raw == "" {
		return ""
	}
	// Strip port if present
	if host, _, err := net.SplitHostPort(raw); err == nil {
		raw = host
	}
	parsed := net.ParseIP(raw)
	if parsed == nil {
		return ""
	}
	return parsed.String()
}

// IsPrivateOrLoopbackIP checks if the IP is local/private/RFC1918/RFC4193.
func IsPrivateOrLoopbackIP(ip net.IP) bool {
	if ip == nil {
		return true
	}
	return ip.IsLoopback() || ip.IsPrivate() || ip.IsLinkLocalUnicast() || ip.IsLinkLocalMulticast() || ip.IsUnspecified()
}

// ResolveIPRegion resolves whether an IP belongs to Mainland China ("cn") or International/Overseas ("intl").
// HK, MO, TW are explicitly classified as "intl" according to specifications.
func ResolveIPRegion(r *http.Request, defaultFallback string) IPLocationResult {
	if defaultFallback != RegionIntl && defaultFallback != RegionCN {
		defaultFallback = RegionCN
	}

	// 1. Simulation override for admin testing & preview (Header or Query parameter)
	simHeader := strings.ToLower(strings.TrimSpace(r.Header.Get("X-SupDance-Simulate-Region")))
	if simHeader == RegionCN || simHeader == RegionIntl {
		clientIP, src := ExtractClientIP(r)
		return buildLocationResult(clientIP, src, simHeader, true)
	}
	simQuery := strings.ToLower(strings.TrimSpace(r.URL.Query().Get("simulate_region")))
	if simQuery == RegionCN || simQuery == RegionIntl {
		clientIP, src := ExtractClientIP(r)
		return buildLocationResult(clientIP, src, simQuery, true)
	}

	// 2. Extract Client IP
	clientIP, srcHeader := ExtractClientIP(r)
	parsedIP := net.ParseIP(clientIP)

	// 3. Check Cloudflare CF-IPCountry header if available
	cfCountry := strings.ToUpper(strings.TrimSpace(r.Header.Get("CF-IPCountry")))
	if cfCountry != "" {
		// HK, MO, TW -> International
		if cfCountry == "HK" || cfCountry == "MO" || cfCountry == "TW" {
			return buildLocationResult(clientIP, "cf-ipcountry:"+strings.ToLower(cfCountry), RegionIntl, false)
		}
		if cfCountry == "CN" {
			return buildLocationResult(clientIP, "cf-ipcountry:cn", RegionCN, false)
		}
		// Any other country code -> International
		return buildLocationResult(clientIP, "cf-ipcountry:"+strings.ToLower(cfCountry), RegionIntl, false)
	}

	// 4. Private / Loopback IPs -> Fallback to defaultFallback
	if parsedIP == nil || IsPrivateOrLoopbackIP(parsedIP) {
		return buildLocationResult(clientIP, srcHeader, defaultFallback, false)
	}

	// 5. First check if it's explicitly in HK/MO/TW CIDR ranges -> RegionIntl
	for _, ipNet := range parsedHkMoTwCIDRs {
		if ipNet.Contains(parsedIP) {
			return buildLocationResult(clientIP, srcHeader, RegionIntl, false)
		}
	}

	// 6. Check if it's in Mainland China CIDR ranges -> RegionCN
	for _, ipNet := range parsedMainlandCIDRs {
		if ipNet.Contains(parsedIP) {
			return buildLocationResult(clientIP, srcHeader, RegionCN, false)
		}
	}

	// 7. If public IP and didn't match Mainland China -> RegionIntl
	return buildLocationResult(clientIP, srcHeader, RegionIntl, false)
}

func buildLocationResult(ip string, src string, region string, simulated bool) IPLocationResult {
	label := "中国大陆"
	if region == RegionIntl {
		label = "海外及港澳台"
	}
	return IPLocationResult{
		ClientIP:     ip,
		SourceHeader: src,
		Region:       region,
		RegionLabel:  label,
		IsSimulated:  simulated,
	}
}
