package handler

import (
	"net/http"
	"net/url"
	"strconv"
	"strings"
	"time"

	"infinite-canvas/backend/internal/canvas"
	"infinite-canvas/backend/internal/service"

	"github.com/gin-gonic/gin"
	"github.com/gorilla/websocket"
)

const (
	canvasCollaborationWSPingInterval = 25 * time.Second
	canvasCollaborationWSPongWait     = 35 * time.Second
	canvasCollaborationWSWriteWait    = 10 * time.Second
)

func canvasCollaborationCheckOrigin(r *http.Request, allowedOrigin string) bool {
	origin := strings.TrimSpace(r.Header.Get("Origin"))
	if origin == "" {
		return true
	}
	parsed, err := url.Parse(origin)
	if err != nil || (parsed.Scheme != "http" && parsed.Scheme != "https") || parsed.Host == "" || parsed.User != nil || parsed.Path != "" || parsed.RawQuery != "" || parsed.Fragment != "" {
		return false
	}
	// Reuse the decision made by the application's CORS middleware, including
	// proxy host normalization. Do not independently trust forwarded headers.
	if allowedOrigin == origin {
		return true
	}
	requestScheme := "http"
	if r.TLS != nil {
		requestScheme = "https"
	}
	return strings.EqualFold(parsed.Scheme, requestScheme) && strings.EqualFold(parsed.Host, r.Host)
}

func RegisterCanvasCollaborationRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/canvas-projects/:id/credit-usage", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		usage, err := svc.CanvasCollaboration().CanvasCreditUsageForUser(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"usage": usage})
	})
	r.GET("/canvas-projects/:id/collaboration/ws", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		canvasID := c.Param("id")
		if _, err := svc.CanvasCollaboration().CanvasCollaborationRevisionForUser(user, canvasID); err != nil {
			failService(c, err)
			return
		}
		upgrader := websocket.Upgrader{ReadBufferSize: 1024, WriteBufferSize: 4096,
			CheckOrigin: func(r *http.Request) bool {
				return canvasCollaborationCheckOrigin(r, c.Writer.Header().Get("Access-Control-Allow-Origin"))
			},
		}
		conn, err := upgrader.Upgrade(c.Writer, c.Request, nil)
		if err != nil {
			return
		}
		subscription := svc.CanvasCollaboration().SubscribeCanvasCollaborationRealtime(canvasID)
		revision, err := svc.CanvasCollaboration().CanvasCollaborationRevisionForUser(user, canvasID)
		if err != nil {
			subscription.Close()
			conn.Close()
			return
		}
		defer subscription.Close()
		defer conn.Close()

		if err := conn.SetWriteDeadline(time.Now().Add(canvasCollaborationWSWriteWait)); err == nil {
			_ = conn.WriteJSON(canvas.CanvasCollaborationRealtimeMessage{Type: "ready", CanvasID: canvasID, Revision: revision})
		}
		readDone := make(chan struct{})
		go func() {
			defer close(readDone)
			conn.SetReadLimit(32 << 10)
			_ = conn.SetReadDeadline(time.Now().Add(canvasCollaborationWSPongWait))
			conn.SetPongHandler(func(string) error {
				return conn.SetReadDeadline(time.Now().Add(canvasCollaborationWSPongWait))
			})
			// Keep the single-writer rule: the main loop owns all writes, so a
			// client ping only refreshes the read deadline and does not write a
			// pong concurrently from this reader goroutine.
			conn.SetPingHandler(func(string) error {
				return conn.SetReadDeadline(time.Now().Add(canvasCollaborationWSPongWait))
			})
			for {
				if _, _, readErr := conn.ReadMessage(); readErr != nil {
					return
				}
			}
		}()

		pingTicker := time.NewTicker(canvasCollaborationWSPingInterval)
		defer pingTicker.Stop()
		for {
			select {
			case <-readDone:
				return
			case message, ok := <-subscription.Messages:
				if !ok {
					return
				}
				// Membership/session may have been revoked since the handshake.
				user, authErr := currentUser(c, svc)
				if authErr != nil {
					return
				}
				if _, err := svc.CanvasCollaboration().CanvasCollaborationRevisionForUser(user, canvasID); err != nil {
					return
				}
				if err := conn.SetWriteDeadline(time.Now().Add(canvasCollaborationWSWriteWait)); err != nil {
					return
				}
				if err := conn.WriteJSON(message); err != nil {
					return
				}
			case <-pingTicker.C:
				if err := conn.SetWriteDeadline(time.Now().Add(canvasCollaborationWSWriteWait)); err != nil {
					return
				}
				if err := conn.WriteControl(websocket.PingMessage, nil, time.Now().Add(canvasCollaborationWSWriteWait)); err != nil {
					return
				}
			}
		}
	})

	r.GET("/canvas-projects/:id/collaboration/users", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		users, err := svc.CanvasCollaboration().SearchCanvasCollaborationUsers(user, c.Param("id"), strings.TrimSpace(c.Query("query")))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"users": users})
	})

	r.GET("/canvas-projects/:id/collaboration/members", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		members, err := svc.CanvasCollaboration().CanvasCollaborationMembers(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"members": members})
	})

	r.POST("/canvas-projects/:id/collaboration/members", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req struct {
			UserID string `json:"userId"`
			Role   string `json:"role"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("协作成员请求格式错误"))
			return
		}
		member, err := svc.CanvasCollaboration().EnableCanvasCollaboration(user, c.Param("id"), req.UserID, req.Role)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"member": member})
	})

	r.DELETE("/canvas-projects/:id/collaboration/members/:userId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.CanvasCollaboration().RemoveCanvasCollaborator(user, c.Param("id"), c.Param("userId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"userId": c.Param("userId")})
	})

	r.POST("/canvas-projects/:id/collaboration/operations", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 2<<20)
		var req canvas.CanvasCollaborationOperationRequest
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("协作操作请求格式错误"))
			return
		}
		result, err := svc.CanvasCollaboration().ApplyCanvasCollaborationOperation(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/canvas-projects/:id/collaboration/events", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		after, _ := strconv.ParseInt(c.DefaultQuery("after", "0"), 10, 64)
		limit, _ := strconv.Atoi(c.DefaultQuery("limit", "100"))
		result, err := svc.CanvasCollaboration().CanvasCollaborationEventsForUser(user, c.Param("id"), after, limit)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, result)
	})

	r.GET("/canvas-projects/:id/collaboration/presence", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		presence, err := svc.CanvasCollaboration().CanvasPresenceForUser(user, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"presence": presence})
	})

	r.PUT("/canvas-projects/:id/collaboration/presence", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, 16<<10)
		var req canvas.CanvasPresenceUpdate
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, service.BadAuthRequest("协作状态请求格式错误"))
			return
		}
		presence, err := svc.CanvasCollaboration().UpsertCanvasPresence(user, c.Param("id"), req)
		if err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"presence": presence})
	})

	r.DELETE("/canvas-projects/:id/collaboration/presence/:sessionId", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		if err := svc.CanvasCollaboration().RemoveCanvasPresence(user, c.Param("id"), c.Param("sessionId")); err != nil {
			failService(c, err)
			return
		}
		ok(c, gin.H{"sessionId": c.Param("sessionId")})
	})
}
