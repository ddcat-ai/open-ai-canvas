package handler

import (
	"fmt"
	"io"
	"mime"
	"net/http"
	"strconv"
	"strings"
	"time"

	"yingce/backend/internal/assets"
	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

const publicResourceMaxCacheSeconds int64 = 518_400

func publicResourceCacheControl(c *gin.Context, delivery *service.ResourceDelivery, now time.Time) string {
	if c.Query("access") == "1" || c.Query("download") == "1" || strings.EqualFold(strings.TrimSpace(c.Query("purpose")), string(assets.PurposeDownload)) {
		return "private, no-store"
	}
	if delivery == nil || delivery.Resource == nil || !assets.InlineMediaType(delivery.Resource.MimeType) {
		return "private, no-store"
	}
	expiresUnix, err := strconv.ParseInt(strings.TrimSpace(c.Query("expires")), 10, 64)
	if err != nil {
		return "private, no-store"
	}
	remaining := expiresUnix - now.Unix()
	if remaining <= 0 {
		return "private, no-store"
	}
	if remaining > publicResourceMaxCacheSeconds {
		remaining = publicResourceMaxCacheSeconds
	}
	return fmt.Sprintf("public, max-age=%d", remaining)
}

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
	defer stream.Body.Close()
	if cacheControl != "" {
		c.Header("Cache-Control", cacheControl)
	}
	if disposition != "" {
		c.Header("Content-Disposition", disposition)
	}
	resource := stream.Resource
	if !assets.InlineMediaType(resource.MimeType) {
		if dispositionType, _, _ := mime.ParseMediaType(disposition); dispositionType != "attachment" {
			c.Header("Content-Disposition", "attachment")
		}
		c.Header("Content-Security-Policy", "sandbox; default-src 'none'")
	}
	mimeType := resource.MimeType
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
		http.ServeContent(c.Writer, c.Request, resource.ID, resource.UpdatedAt, seeker)
		return
	}
	if c.Request.Method == http.MethodHead {
		c.Header("Content-Type", mimeType)
		if stream.ContentLength >= 0 {
			c.Header("Content-Length", strconv.FormatInt(stream.ContentLength, 10))
		}
		c.Status(stream.StatusCode)
		return
	}
	c.DataFromReader(stream.StatusCode, stream.ContentLength, mimeType, stream.Body, nil)
}
