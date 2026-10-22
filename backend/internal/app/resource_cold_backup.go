// L2 本地冷备 + L3 兜底读取。
//
// 背景：图片/视频/音频原件存放在对象存储（provider=s3，Cloudflare R2），
// 通过 CDN 域名分发。CDN 偶发 404/403（缓存未命中回源失败、鉴权配置变更、
// 对象被误删）时，浏览器会直接裂图。这里把原件异步复制一份到本机数据目录，
// 让应用服务器在 CDN 不可用时能直接吐出字节，形成 L3 兜底。
//
// 设计边界：
//   - 只对 provider=s3 的 image/video/audio 生效：local 资源本来就在本地，
//     其余 provider 不在本期范围。
//   - 冷备是「尽力而为」的旁路，任何失败都只记录状态，不影响上传确认与正常分发。
//   - 单对象上限 512MB，超过直接跳过，避免把服务器磁盘撑爆。
//   - 落盘用 .tmp + rename，保证本地文件要么不存在、要么完整，
//     不会出现被当作有效冷备读取的半截文件。

package app

import (
	"errors"
	"fmt"
	"io"
	"log"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

const (
	// coldBackupMaxBytes 是单个对象的冷备上限。超过后跳过并记日志：
	// 冷备占用的是应用服务器磁盘，必须有个明确的天花板。
	coldBackupMaxBytes int64 = 512 << 20
	// coldBackupDirName 与本地存储（provider=local）使用同一个资源目录，
	// 这样删除资源目录时冷备文件天然被一并清理。
	coldBackupDirName = "resources"
)

// maybeStartColdBackup 在资源就绪后异步同步本地冷备，不阻塞上传确认响应。
// 与 maybeStartThumbnail 同构：拍快照、goroutine、recover 兜底。
func (s *Service) maybeStartColdBackup(resource *model.Resource) {
	if !coldBackupEligible(resource) {
		return
	}
	if resource.ColdBackupStatus == model.ColdBackupStatusReady {
		return
	}
	if strings.TrimSpace(s.dataDir) == "" {
		return
	}
	snapshot := *resource
	go func() {
		defer func() { _ = recover() }()
		if err := s.syncResourceToCold(&snapshot); err != nil {
			log.Printf("资源冷备同步失败 resource=%s: %v", snapshot.ID, err)
		}
	}()
}

// coldBackupEligible 判断资源是否值得冷备：只有跨网络的 s3 媒体对象需要副本。
func coldBackupEligible(resource *model.Resource) bool {
	if resource == nil || resource.Provider != "s3" {
		return false
	}
	if resource.Status != "" && resource.Status != model.ResourceStatusReady {
		return false
	}
	switch resource.Kind {
	case "image", "video", "audio":
		return strings.TrimSpace(resource.ObjectKey) != ""
	default:
		return false
	}
}

// syncResourceToCold 把对象存储里的原件完整复制到本地数据目录。
// 幂等：本地已有等长文件时直接标记 ready，不重复拉取。
func (s *Service) syncResourceToCold(resource *model.Resource) error {
	if resource == nil {
		return errors.New("资源不存在")
	}
	if strings.TrimSpace(s.dataDir) == "" {
		return errors.New("未配置本地数据目录")
	}
	if resource.Provider != "s3" {
		return nil
	}
	if resource.Size > coldBackupMaxBytes {
		log.Printf("跳过冷备：resource=%s size=%d 超过 %dMB 上限", resource.ID, resource.Size, coldBackupMaxBytes>>20)
		return nil
	}
	target, err := s.coldBackupPath(resource)
	if err != nil {
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	if resource.Size > 0 {
		if info, statErr := os.Stat(target); statErr == nil && info.Size() == resource.Size {
			s.markColdBackupStatus(resource, model.ColdBackupStatusReady)
			return nil
		}
	}
	setting, err := s.ossSettingForResource(resource.UserID, resource)
	if err != nil {
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	stream, err := storage.GetS3ObjectRange(s.storageSettingWithRuntimePolicy(setting), resource.ObjectKey, "")
	if err != nil {
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	defer stream.Body.Close()

	if err := os.MkdirAll(filepath.Dir(target), 0o755); err != nil {
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	tempPath := target + ".tmp"
	file, err := os.OpenFile(tempPath, os.O_CREATE|os.O_WRONLY|os.O_TRUNC, 0o644)
	if err != nil {
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	// 多读 1 字节用于判断「对象实际大小是否超过上限」，超限立刻放弃。
	written, copyErr := io.Copy(file, io.LimitReader(stream.Body, coldBackupMaxBytes+1))
	closeErr := file.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(tempPath)
		err = errors.Join(copyErr, closeErr)
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	if written > coldBackupMaxBytes {
		_ = os.Remove(tempPath)
		log.Printf("放弃冷备：resource=%s 实际大小超过 %dMB 上限", resource.ID, coldBackupMaxBytes>>20)
		return nil
	}
	// 记录大小与对象实际大小不一致说明读到的是残片或被替换的对象，宁可不要。
	if resource.Size > 0 && written != resource.Size {
		_ = os.Remove(tempPath)
		err = fmt.Errorf("冷备大小不一致：期望 %d 字节，实际 %d 字节", resource.Size, written)
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	if err := os.Rename(tempPath, target); err != nil {
		_ = os.Remove(tempPath)
		s.markColdBackupStatus(resource, model.ColdBackupStatusFailed)
		return err
	}
	s.markColdBackupStatus(resource, model.ColdBackupStatusReady)
	return nil
}

// markColdBackupStatus 只更新冷备状态列。
//
// 这里刻意不用整行 SaveResource：冷备与缩略图都是异步任务，各自持有启动时的
// 快照；整行回写会把对方刚写好的字段覆盖回旧值（典型症状是缩略图状态被改回
// processing 后永不重试）。只更新目标列可以避免这类互相踩踏。
func (s *Service) markColdBackupStatus(resource *model.Resource, status string) {
	if resource == nil || resource.ID == "" {
		return
	}
	resource.ColdBackupStatus = status
	updated, err := s.repo.UpdateResourceColdBackup(resource.UserID, resource.ID, status)
	if err != nil {
		log.Printf("记录资源冷备状态失败 resource=%s: %v", resource.ID, err)
		return
	}
	if !updated {
		log.Printf("记录资源冷备状态跳过 resource=%s: 资源已不在就绪状态", resource.ID)
	}
}

// coldBackupPath 计算冷备文件的绝对路径，并拒绝越界的对象键。
func (s *Service) coldBackupPath(resource *model.Resource) (string, error) {
	if resource == nil {
		return "", errors.New("资源不存在")
	}
	key := strings.TrimSpace(resource.ObjectKey)
	if key == "" {
		return "", errors.New("资源对象键为空")
	}
	clean := filepath.Clean(filepath.FromSlash(key))
	// 对象键必须是相对路径：绝对路径、盘符、前导分隔符与 .. 越界一律拒绝，
	// 否则冷备文件会落到数据目录之外（Windows 上 "\\abs" 也算根相对路径）。
	if clean == "." || clean == ".." || filepath.IsAbs(clean) || filepath.VolumeName(clean) != "" ||
		strings.HasPrefix(key, "/") || strings.HasPrefix(key, `\`) ||
		strings.HasPrefix(clean, ".."+string(filepath.Separator)) {
		return "", fmt.Errorf("资源对象键非法：%s", resource.ObjectKey)
	}
	return filepath.Join(s.dataDir, coldBackupDirName, clean), nil
}

// OpenColdBackupRange 打开本地冷备文件。
//
// 与 openResourceRange 的本地分支保持一致：直接返回 *os.File 作为 Body 并声明
// AcceptRanges=bytes，由 HTTP 层的 http.ServeContent 处理 Range、If-Range 与 416。
// 自己再解析一遍 Range 只会与 ServeContent 重复，且容易在越界场景下错答 200。
//
// rangeHeader 仅为与 openResourceRange 签名对齐：*os.File 本身可 Seek，
// Range 由 ServeContent 依据原始请求头处理，这里不需要预读。
func (s *Service) OpenColdBackupRange(resource *model.Resource, rangeHeader string) (*ResourceStream, error) {
	if resource == nil {
		return nil, errors.New("资源不存在")
	}
	path, err := s.coldBackupPath(resource)
	if err != nil {
		return nil, err
	}
	file, err := os.Open(path)
	if err != nil {
		return nil, err
	}
	info, err := file.Stat()
	if err != nil {
		_ = file.Close()
		return nil, err
	}
	size := info.Size()
	if size <= 0 {
		// 空文件视为没有冷备：调用方会退回 302，而不是返回空响应体。
		_ = file.Close()
		return nil, os.ErrNotExist
	}
	return &ResourceStream{
		Resource:      resource,
		Body:          file,
		StatusCode:    http.StatusOK,
		ContentLength: size,
		AcceptRanges:  "bytes",
	}, nil
}
