package handler

import (
	"crypto/rand"
	"encoding/hex"
	"fmt"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strconv"
	"sync"
	"time"

	"github.com/gin-gonic/gin"

	"infinite-canvas/backend/internal/service"
)

// 分片上传会话：把“导入本地媒体”拆成 开始→逐片→合并 三段，单片上限 8MB，
// 文件整体不再受 multipart 单请求大小限制（对齐 Concat 桌面端“任意大小直接入库”的体验）。
// 会话状态只存在内存（重启即失效 → 前端整传重试），磁盘暂存在系统临时目录，随会话清理。
const (
	chunkUploadChunkSize   = 8 << 20
	chunkUploadSlackBytes  = 64 << 10 // MaxBytesReader 允许的超片余量
	chunkUploadTTL         = 90 * time.Minute
	chunkUploadMaxPerUser  = 32
	chunkUploadBodyCapJSON = 16 << 10
)

type chunkedUploadSession struct {
	ID             string
	UserID         string
	FileName       string
	Kind           string
	Size           int64
	Width          int
	Height         int
	DurationMs     int64
	IdempotencyKey string
	ChunkCount     int
	Dir            string
	CreatedAt      time.Time
}

var chunkUploadSessions = struct {
	sync.Mutex
	m map[string]*chunkedUploadSession
}{m: make(map[string]*chunkedUploadSession)}

func newUploadSessionID() string {
	raw := make([]byte, 12)
	if _, err := rand.Read(raw); err != nil {
		return fmt.Sprintf("%d", time.Now().UnixNano())
	}
	return hex.EncodeToString(raw)
}

func (s *chunkedUploadSession) chunkPath(index int) string {
	return filepath.Join(s.Dir, fmt.Sprintf("chunk-%d", index))
}

func (s *chunkedUploadSession) hasAllChunks() bool {
	for i := 0; i < s.ChunkCount; i++ {
		info, err := os.Stat(s.chunkPath(i))
		if err != nil || info.Size() != s.chunkSizeAt(i) {
			return false
		}
	}
	return true
}

// chunkSizeAt 返回第 index 片的期望字节数（末片按文件余量，其余固定 chunkSize）。
func (s *chunkedUploadSession) chunkSizeAt(index int) int64 {
	if index == s.ChunkCount-1 {
		rest := s.Size - int64(index)*chunkUploadChunkSize
		if rest < 0 {
			return 0
		}
		return rest
	}
	return chunkUploadChunkSize
}

func removeExpiredChunkSessions() {
	now := time.Now()
	chunkUploadSessions.Lock()
	defer chunkUploadSessions.Unlock()
	for id, sess := range chunkUploadSessions.m {
		if now.Sub(sess.CreatedAt) > chunkUploadTTL {
			_ = os.RemoveAll(sess.Dir)
			delete(chunkUploadSessions.m, id)
		}
	}
}

func takeChunkSession(id string) *chunkedUploadSession {
	removeExpiredChunkSessions()
	chunkUploadSessions.Lock()
	defer chunkUploadSessions.Unlock()
	return chunkUploadSessions.m[id]
}

func dropChunkSession(id string) {
	chunkUploadSessions.Lock()
	defer chunkUploadSessions.Unlock()
	if sess := chunkUploadSessions.m[id]; sess != nil {
		_ = os.RemoveAll(sess.Dir)
		delete(chunkUploadSessions.m, id)
	}
}

// RegisterChunkedUploadRoutes 注册本地媒体分片上传三条接口（POST 开始 / PUT 上传片 / POST 合并）。
func RegisterChunkedUploadRoutes(r *gin.RouterGroup, svc *service.Service) {
	r.POST("/resources/uploads", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		policy, available := loadRuntimePolicy(c, svc)
		if !available || !enforceRateLimit(c, "resources-upload:"+user.ID, policy.Request.ResourceUploadPerMinute, time.Minute) {
			return
		}
		c.Request.Body = http.MaxBytesReader(c.Writer, c.Request.Body, chunkUploadBodyCapJSON)
		var req struct {
			FileName       string `json:"fileName"`
			Kind           string `json:"kind"`
			Size           int64  `json:"size"`
			Width          int    `json:"width"`
			Height         int    `json:"height"`
			DurationMs     int64  `json:"durationMs"`
			IdempotencyKey string `json:"idempotencyKey"`
		}
		if err := c.ShouldBindJSON(&req); err != nil {
			fail(c, http.StatusBadRequest, err)
			return
		}
		if req.FileName == "" || len(req.FileName) > 255 {
			fail(c, http.StatusBadRequest, fmt.Errorf("文件名不能为空且不能超过 255 个字符"))
			return
		}
		if req.Size <= 0 {
			fail(c, http.StatusBadRequest, fmt.Errorf("文件大小必须大于 0"))
			return
		}
		// 超账号存储总量的文件无论如何都会失败，提前给出明确提示。
		if policy.Resource.StoredFileGB > 0 && req.Size > int64(policy.Resource.StoredFileGB)<<30 {
			fail(c, http.StatusBadRequest, fmt.Errorf("文件超过账号存储总量上限 %dGB", policy.Resource.StoredFileGB))
			return
		}
		// 同一用户并发会话数兜底，防内存占用失控。
		active := 0
		chunkUploadSessions.Lock()
		for _, sess := range chunkUploadSessions.m {
			if sess.UserID == user.ID {
				active++
			}
		}
		chunkUploadSessions.Unlock()
		if active >= chunkUploadMaxPerUser {
			fail(c, http.StatusTooManyRequests, fmt.Errorf("同时进行中的上传过多，请稍后重试"))
			return
		}
		dir, err := os.MkdirTemp("", "canvas-chunk-upload-*")
		if err != nil {
			failService(c, err)
			return
		}
		session := &chunkedUploadSession{
			ID:             newUploadSessionID(),
			UserID:         user.ID,
			FileName:       req.FileName,
			Kind:           req.Kind,
			Size:           req.Size,
			Width:          req.Width,
			Height:         req.Height,
			DurationMs:     req.DurationMs,
			IdempotencyKey: req.IdempotencyKey,
			ChunkCount:     int((req.Size + chunkUploadChunkSize - 1) / chunkUploadChunkSize),
			Dir:            dir,
			CreatedAt:      time.Now(),
		}
		chunkUploadSessions.Lock()
		chunkUploadSessions.m[session.ID] = session
		chunkUploadSessions.Unlock()
		ok(c, gin.H{"uploadId": session.ID, "chunkSize": chunkUploadChunkSize, "chunkCount": session.ChunkCount})
	})

	r.PUT("/resources/uploads/:id/chunks/:index", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		session := takeChunkSession(c.Param("id"))
		if session == nil || session.UserID != user.ID {
			fail(c, http.StatusNotFound, fmt.Errorf("上传会话不存在或已过期，请重新导入"))
			return
		}
		index, err := strconv.Atoi(c.Param("index"))
		if err != nil || index < 0 || index >= session.ChunkCount {
			fail(c, http.StatusBadRequest, fmt.Errorf("非法的分片序号"))
			return
		}
		expected := session.chunkSizeAt(index)
		if expected <= 0 {
			fail(c, http.StatusBadRequest, fmt.Errorf("非法的分片序号"))
			return
		}
		// 单片限长（期望长度 + 少量余量），超长直接中断，避免内存/磁盘被恶意占用。
		body := http.MaxBytesReader(c.Writer, c.Request.Body, expected+chunkUploadSlackBytes)
		dst, err := os.OpenFile(session.chunkPath(index), os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			failService(c, err)
			return
		}
		written, copyErr := io.CopyN(dst, body, expected)
		closeErr := dst.Close()
		var probe [1]byte
		extra, readErr := body.Read(probe[:])
		if copyErr != nil || closeErr != nil {
			_ = os.Remove(session.chunkPath(index))
			fail(c, http.StatusBadRequest, fmt.Errorf("分片 %d 上传不完整，请重试", index))
			return
		}
		if readErr == nil || extra > 0 {
			_ = os.Remove(session.chunkPath(index))
			fail(c, http.StatusBadRequest, fmt.Errorf("分片 %d 超过大小限制", index))
			return
		}
		_ = written
		ok(c, gin.H{"index": index})
	})

	r.POST("/resources/uploads/:id/complete", func(c *gin.Context) {
		user, err := currentUser(c, svc)
		if err != nil {
			failService(c, err)
			return
		}
		id := c.Param("id")
		session := takeChunkSession(id)
		if session == nil || session.UserID != user.ID {
			fail(c, http.StatusNotFound, fmt.Errorf("上传会话不存在或已过期，请重新导入"))
			return
		}
		if !session.hasAllChunks() {
			fail(c, http.StatusBadRequest, fmt.Errorf("上传文件不完整，请重新导入"))
			return
		}
		mergedPath := filepath.Join(session.Dir, "merged")
		merged, err := os.OpenFile(mergedPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o600)
		if err != nil {
			failService(c, err)
			return
		}
		total := int64(0)
		for i := 0; i < session.ChunkCount; i++ {
			part, openErr := os.Open(session.chunkPath(i))
			if openErr != nil {
				_ = merged.Close()
				failService(c, openErr)
				return
			}
			n, copyErr := io.Copy(merged, part)
			_ = part.Close()
			if copyErr != nil {
				_ = merged.Close()
				failService(c, copyErr)
				return
			}
			total += n
		}
		if closeErr := merged.Close(); closeErr != nil {
			failService(c, closeErr)
			return
		}
		if total != session.Size {
			dropChunkSession(id)
			fail(c, http.StatusBadRequest, fmt.Errorf("上传文件不完整，请重新导入"))
			return
		}
		fh, err := os.Open(mergedPath)
		if err != nil {
			failService(c, err)
			return
		}
		defer fh.Close()
		resource, svcErr := svc.UploadResourceFile(user.ID, session.FileName, session.Size, session.Kind, session.Width, session.Height, session.DurationMs, fh, session.IdempotencyKey)
		// 无论成败都结束会话：失败时前端会整传重试，不需要保留残片。
		dropChunkSession(id)
		if svcErr != nil {
			failService(c, svcErr)
			return
		}
		ok(c, gin.H{"resource": resource})
	})
}
