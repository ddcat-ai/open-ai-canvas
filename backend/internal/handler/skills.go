package handler

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func RegisterSkillRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/skills/image", proxySkillImage)
	r.GET("/skills/capabilities", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"capabilities": svc.SkillIntegrationCapabilities()})
	})
	r.GET("/skills/community", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, _ := strconv.Atoi(c.DefaultQuery("page", "1"))
		pageSize, _ := strconv.Atoi(c.DefaultQuery("page_size", "12"))
		result, err := svc.CommunitySkills(c.Request.Context(), user.ID, service.CommunitySkillsRequest{
			Page:       page,
			PageSize:   pageSize,
			Sort:       c.DefaultQuery("sort", "hot"),
			Search:     c.Query("search"),
			Categories: c.QueryArray("categories"),
		})
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})
	r.GET("/skills/activated", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skills, err := svc.ActivatedSkills(c.Request.Context(), user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skills": skills})
	})
	r.GET("/skills/favorites", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skills, err := svc.FavoriteSkills(c.Request.Context(), user.ID)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skills": skills})
	})
	r.GET("/skills/community/:dir", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.CommunitySkillDetail(c.Request.Context(), user.ID, c.Param("dir"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.POST("/skills/:dir/activate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillActivated(c.Request.Context(), user.ID, c.Param("dir"), true)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.DELETE("/skills/:dir/activate", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillActivated(c.Request.Context(), user.ID, c.Param("dir"), false)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.POST("/skills/:dir/favorite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillLiked(c.Request.Context(), user.ID, c.Param("dir"), true)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
	r.DELETE("/skills/:dir/favorite", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		skill, err := svc.SetSkillLiked(c.Request.Context(), user.ID, c.Param("dir"), false)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"skill": skill})
	})
}

func proxySkillImage(c *gin.Context) {
	rawURL := strings.TrimSpace(c.Query("url"))
	target, err := url.Parse(rawURL)
	if err != nil || !allowedSkillImageURL(target) {
		fail(c, http.StatusBadRequest, errInvalidSkillImageURL())
		return
	}
	ctx, cancel := context.WithTimeout(c.Request.Context(), 15*time.Second)
	defer cancel()
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, target.String(), nil)
	if err != nil {
		fail(c, http.StatusBadRequest, err)
		return
	}
	req.Header.Set("Accept", "image/avif,image/webp,image/apng,image/svg+xml,image/*,*/*;q=0.8")
	req.Header.Set("Referer", "https://www.updream.cn/")
	req.Header.Set("User-Agent", "Mozilla/5.0 InfiniteCanvas/skills-image-proxy")
	client := service.OutboundHTTPClient(15 * time.Second)
	client.CheckRedirect = func(req *http.Request, via []*http.Request) error {
		if len(via) >= 5 || !allowedSkillImageURL(req.URL) {
			return errInvalidSkillImageURL()
		}
		return nil
	}
	resp, err := client.Do(req)
	if err != nil {
		fail(c, http.StatusBadGateway, err)
		return
	}
	defer resp.Body.Close()
	if resp.StatusCode < 200 || resp.StatusCode >= 300 {
		fail(c, http.StatusBadGateway, errSkillImageUpstream(resp.StatusCode))
		return
	}
	contentType := resp.Header.Get("Content-Type")
	if contentType == "" {
		contentType = "application/octet-stream"
	}
	c.Header("Cache-Control", "public, max-age=604800")
	if etag := resp.Header.Get("ETag"); etag != "" {
		c.Header("ETag", etag)
	}
	c.Status(http.StatusOK)
	c.Header("Content-Type", contentType)
	_, _ = io.Copy(c.Writer, resp.Body)
}

func allowedSkillImageURL(target *url.URL) bool {
	if target == nil || (target.Scheme != "https" && target.Scheme != "http") {
		return false
	}
	host := strings.ToLower(target.Hostname())
	return host == "updream.cn" || strings.HasSuffix(host, ".updream.cn") || host == "hdslb.com" || strings.HasSuffix(host, ".hdslb.com")
}

func errInvalidSkillImageURL() error {
	return errors.New("不支持的技能图片地址")
}

func errSkillImageUpstream(status int) error {
	return errors.New("技能图片读取失败: " + strconv.Itoa(status))
}
