package handler

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"strings"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

// coldFallbackHeader 是客户端显式声明「CDN 打不开时请回落到本地冷备」的请求头。
// 必须显式带上：探测 CDN 会多一次网络往返，不能加在默认 302 路径上。
const coldFallbackHeader = "X-Canvas-Cold-Fallback"

// coldFallbackProbeClient 用于探测 CDN 是否可达。5 秒足够覆盖跨境回源，
// 又不会把浏览器请求挂太久。声明为变量便于测试注入本地服务。
var coldFallbackProbeClient = &http.Client{Timeout: 5 * time.Second}

func resourceAccessOptions(c *gin.Context) service.ResourceAccessOptions {
	purpose := assets.AccessPurpose(strings.TrimSpace(c.Query("purpose")))
	if purpose == "" && c.Query("download") == "1" {
		purpose = assets.PurposeDownload
	}
	variant := assets.ResourceVariant(strings.TrimSpace(c.Query("variant")))
	return service.ResourceAccessOptions{
		Purpose:      purpose,
		Variant:      variant,
		DescribeOnly: c.Query("access") == "1",
	}
}

// serveResourceDelivery is the only HTTP byte/redirect executor. Authorization and
// delivery selection happen in app; this function only applies the already-resolved
// contract to an HTTP response.
func serveResourceDelivery(c *gin.Context, delivery *service.ResourceDelivery, cacheControl string, disposition string) {
	if delivery == nil || delivery.Access == nil {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("资源分发结果无效"))
		return
	}
	access := delivery.Access
	if access.URL == "" && delivery.Stream == nil {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("资源分发结果无效"))
		return
	}
	if c.Query("access") == "1" {
		c.Header("Cache-Control", "private, no-store")
		c.Header("Referrer-Policy", "no-referrer")
		ok(c, gin.H{"access": access})
		return
	}
	c.Header("Referrer-Policy", "no-referrer")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Header("Accept-Ranges", "bytes")
	if access.Delivery == assets.DeliveryCDN || access.Delivery == assets.DeliveryOrigin {
		c.Header("Cache-Control", "private, no-store")
		// L3 兜底：只有客户端显式要求、且探测到 CDN 不可用时才改走本地冷备。
		if coldFallbackRequested(c) && delivery.ColdFallback != nil {
			if stream := coldFallbackStream(c, delivery, access.URL); stream != nil {
				c.Header("X-Canvas-Delivery", "cold-backup")
				serveResourceStream(c, stream, cacheControl, disposition)
				return
			}
		}
		// Do not let Gin generate its default HTML redirect body. A media request
		// should transfer only the redirect metadata; the actual bytes must be
		// fetched from the CDN/origin selected by the access contract.
		c.Header("Location", access.URL)
		c.Status(http.StatusTemporaryRedirect)
		return
	}
	stream := delivery.Stream
	if stream == nil || stream.Body == nil {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("资源流不可用"))
		return
	}
	serveResourceStream(c, stream, cacheControl, disposition)
}

// coldFallbackRequested 判断本次请求是否要求 CDN 失败时回落本地。
func coldFallbackRequested(c *gin.Context) bool {
	return strings.TrimSpace(c.GetHeader(coldFallbackHeader)) == "1"
}

// coldFallbackStream 探测分发地址，不可用时返回本地冷备流。
// 返回 nil 表示「继续走 302」：探测成功、或本地也没有副本。
//
// 探测只发 HEAD，且 403 也视为不可用——CDN 鉴权配置出错时 HEAD 通常先暴露问题，
// 而 403 对浏览器来说和 404 一样是裂图。
func coldFallbackStream(c *gin.Context, delivery *service.ResourceDelivery, rawURL string) *service.ResourceStream {
	if strings.TrimSpace(rawURL) == "" {
		return nil
	}
	if !deliveryURLUnavailable(c, rawURL) {
		return nil
	}
	stream, err := delivery.ColdFallback(c.GetHeader("Range"))
	if err != nil || stream == nil || stream.Body == nil {
		// 本地没有冷备（或冷备损坏）时不改变既有行为，仍然 302 交给浏览器处理，
		// 绝不因为兜底失败把可用的重定向变成 5xx。
		return nil
	}
	return stream
}

// deliveryURLUnavailable 用 HEAD 探测分发地址。
// 网络错误、超时、404、403 都判定为「需要回落」。
func deliveryURLUnavailable(c *gin.Context, rawURL string) bool {
	request, err := http.NewRequestWithContext(c.Request.Context(), http.MethodHead, rawURL, nil)
	if err != nil {
		return true
	}
	response, err := coldFallbackProbeClient.Do(request)
	if err != nil {
		return true
	}
	defer func() {
		_, _ = io.Copy(io.Discard, io.LimitReader(response.Body, 4<<10))
		_ = response.Body.Close()
	}()
	switch response.StatusCode {
	case http.StatusNotFound, http.StatusForbidden:
		return true
	default:
		return false
	}
}

// serveResourceStream 把一段字节流写入响应。冷备兜底与常规代理共用同一段逻辑，
// 保证 Content-Type / Content-Disposition / Range 语义完全一致。
func serveResourceStream(c *gin.Context, stream *service.ResourceStream, cacheControl string, disposition string) {
	if stream == nil || stream.Body == nil {
		fail(c, http.StatusServiceUnavailable, fmt.Errorf("资源流不可用"))
		return
	}
	defer stream.Body.Close()
	if cacheControl != "" {
		c.Header("Cache-Control", cacheControl)
	}
	if disposition != "" {
		c.Header("Content-Disposition", disposition)
	}
	resource := stream.Resource
	if resource != nil && !assets.InlineMediaType(resource.MimeType) {
		if dispositionType, _, _ := mime.ParseMediaType(disposition); dispositionType != "attachment" {
			c.Header("Content-Disposition", "attachment")
		}
		c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	}
	mimeType := ""
	resourceID := ""
	var modifiedTime time.Time
	if resource != nil {
		mimeType = resource.MimeType
		resourceID = resource.ID
		modifiedTime = resource.UpdatedAt
	}
	if mimeType == "" {
		mimeType = "application/octet-stream"
	}
	if stream.ContentRange != "" {
		c.Header("Content-Range", stream.ContentRange)
	}
	if stream.AcceptRanges != "" {
		c.Header("Accept-Ranges", stream.AcceptRanges)
	}
	if seeker, ok := stream.Body.(io.ReadSeeker); ok {
		c.Header("Content-Type", mimeType)
		http.ServeContent(c.Writer, c.Request, resourceID, modifiedTime, seeker)
		return
	}
	c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
}
