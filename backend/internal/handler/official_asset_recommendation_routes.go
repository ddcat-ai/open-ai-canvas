package handler

import (
	"net/http"
	"strings"

	"yingce/backend/internal/service"

	"github.com/gin-gonic/gin"
)

type createOfficialAssetRecommendationRequest struct {
	AssetID        string `json:"assetId"`
	Note           string `json:"note"`
	ConsentVersion string `json:"consentVersion"`
}

type reviewOfficialAssetRecommendationRequest struct {
	Action       string    `json:"action"`
	ReviewerNote string    `json:"reviewerNote"`
	Title        *string   `json:"title,omitempty"`
	Description  *string   `json:"description,omitempty"`
	Category     *string   `json:"category,omitempty"`
	Tags         *[]string `json:"tags,omitempty"`
	SourceName   *string   `json:"sourceName,omitempty"`
	SourceURL    *string   `json:"sourceUrl,omitempty"`
	LicenseNote  *string   `json:"licenseNote,omitempty"`
	UsageNote    *string   `json:"usageNote,omitempty"`
}

type resubmitOfficialAssetRecommendationRequest struct {
	Note           string `json:"note"`
	ConsentVersion string `json:"consentVersion"`
}

func RegisterOfficialAssetRecommendationRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/official-asset-recommendations/consent-policy", func(c *gin.Context) {
		if _, err := currentUser(c, svc); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"version": "commercial-use-v1"})
	})
	r.POST("/official-asset-recommendations", createOfficialAssetRecommendationHandler(svc))
	r.POST("/official-asset-recommendations/:id/resubmit", resubmitOfficialAssetRecommendationHandler(svc))
	admin := r.Group("/admin/official-asset-recommendations")
	admin.GET("", listAdminOfficialAssetRecommendationsHandler(svc))
	admin.GET("/:id", detailAdminOfficialAssetRecommendationHandler(svc))
	admin.PATCH("/:id/review", reviewOfficialAssetRecommendationHandler(svc))
}

func resubmitOfficialAssetRecommendationHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req resubmitOfficialAssetRecommendationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.ResubmitOfficialAssetRecommendation(user, c.Param("id"), req.Note, req.ConsentVersion)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func detailAdminOfficialAssetRecommendationHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		result, err := svc.AdminOfficialAssetRecommendationDetail(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func createOfficialAssetRecommendationHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req createOfficialAssetRecommendationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.CreateOfficialAssetRecommendation(user, req.AssetID, req.Note, req.ConsentVersion)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func listAdminOfficialAssetRecommendationsHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		page, pageSize, err := parsePaginationQuery(c, 20)
		if err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		result, err := svc.AdminOfficialAssetRecommendationsPage(user, strings.TrimSpace(c.Query("status")), page, pageSize)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}

func reviewOfficialAssetRecommendationHandler(svc *service.Service) gin.HandlerFunc {
	return func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		var req reviewOfficialAssetRecommendationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		metadata := &service.OfficialAssetRecommendationReviewMetadata{Title: req.Title, Description: req.Description, Category: req.Category, Tags: req.Tags, SourceName: req.SourceName, SourceURL: req.SourceURL, LicenseNote: req.LicenseNote, UsageNote: req.UsageNote}
		result, err := svc.ReviewOfficialAssetRecommendation(user, c.Param("id"), req.Action, req.ReviewerNote, metadata)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	}
}
