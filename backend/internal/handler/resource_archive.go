package handler

import (
	"net/http"
	"os"
	"time"

	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
)

func registerResourceArchiveRoute(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/resources/image-archive", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if !enforceRateLimit(c, "image-archive:"+user.ID, 10, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 64<<10)
		var items []service.ImageResourceArchiveItem
		if err := c.ShouldBindJSON(&items); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		file, err := svc.CreateImageResourceArchive(c.Request.Context(), user.ID, items)
		if err != nil {
			failService(c, err)
			return
		}
		defer os.Remove(file.Name())
		defer file.Close()
		stat, err := file.Stat()
		if err != nil {
			failService(c, err)
			return
		}
		c.Header("Cache-Control", "private, no-store")
		c.Header("Content-Disposition", `attachment; filename="images.zip"`)
		c.DataFromReader(http.StatusOK, stat.Size(), "application/zip", file, nil)
	})
}
