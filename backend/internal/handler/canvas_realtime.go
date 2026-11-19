package handler

import (
	"context"
	"time"

	"github.com/coder/websocket"
	"github.com/coder/websocket/wsjson"
	"github.com/gin-gonic/gin"
	"yingce/backend/internal/service"
)

func RegisterCanvasRealtimeRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.GET("/canvas-projects/:id/realtime", func(c *gin.Context) {
		ownerKey, err := currentContentKey(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		ctx, cancel := context.WithCancel(context.Background())
		defer cancel()
		session, peers, err := svc.OpenCanvasRealtime(ctx, ownerKey, c.Param("id"))
		if err != nil {
			failService(c, err)
			return
		}
		defer session.Close()
		options := &websocket.AcceptOptions{}
		// The shared CORS middleware has already validated this exact origin,
		// including the public forwarded host behind Vite/Nginx.
		if origin := c.GetHeader("Origin"); origin != "" && c.Writer.Header().Get("Access-Control-Allow-Origin") == origin {
			options.OriginPatterns = []string{origin}
		}
		conn, err := websocket.Accept(c.Writer, c.Request, options)
		if err != nil {
			return
		}
		defer conn.CloseNow()
		conn.SetReadLimit(32768)
		write := func(value any) error {
			deadline, stop := context.WithTimeout(ctx, 5*time.Second)
			defer stop()
			return wsjson.Write(deadline, conn, value)
		}
		if write(gin.H{"type": "welcome", "selfId": session.ID(), "peers": peers}) != nil {
			return
		}
		go func() {
			defer cancel()
			window, count := time.Now(), 0
			for {
				var message struct {
					Type   string                       `json:"type"`
					Cursor *service.CanvasPresencePoint `json:"cursor"`
					Drag   []service.CanvasPresenceNode `json:"drag"`
				}
				if wsjson.Read(ctx, conn, &message) != nil {
					return
				}
				if time.Since(window) >= time.Second {
					window, count = time.Now(), 0
				}
				count++
				if count > 80 || message.Type != "presence" || session.Update(message.Cursor, message.Drag) != nil {
					_ = conn.Close(websocket.StatusPolicyViolation, "invalid presence message")
					return
				}
			}
		}()
		ticker := time.NewTicker(15 * time.Second)
		defer ticker.Stop()
		for {
			select {
			case <-ctx.Done():
				return
			case <-session.Done():
				return
			case event := <-session.Events:
				if event.Peer != nil && event.Peer.ID == session.ID() {
					continue
				}
				if write(event) != nil {
					return
				}
			case <-ticker.C:
				// Revoked login sessions and deleted canvases cannot retain a subscription.
				if _, err := currentContentKey(c, svc); err != nil {
					_ = conn.Close(websocket.StatusPolicyViolation, "session expired")
					return
				}
				if _, err := svc.UserCanvasProjectMetadata(ownerKey, c.Param("id")); err != nil {
					_ = conn.Close(websocket.StatusPolicyViolation, "canvas unavailable")
					return
				}
				ping, stop := context.WithTimeout(ctx, 5*time.Second)
				err := conn.Ping(ping)
				stop()
				if err != nil {
					return
				}
				if write(gin.H{"type": "heartbeat"}) != nil {
					return
				}
				session.Heartbeat()
			}
		}
	})
}
