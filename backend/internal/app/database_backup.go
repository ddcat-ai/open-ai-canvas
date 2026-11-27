package app

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"path/filepath"
	"sort"
	"strings"
	"time"
	_ "time/tzdata"

	"yingce/backend/internal/backup"
	"yingce/backend/internal/kernel"
	"yingce/backend/internal/model"
	"yingce/backend/internal/storage"
)

const databaseBackupSettingKey = "database-backup.settings"
const databaseBackupRecordPrefix = "database-backup.record."

type DatabaseBackupSettings struct {
	Enabled             bool             `json:"enabled"`
	DailyTime           string           `json:"dailyTime"`
	Timezone            string           `json:"timezone"`
	RetainCount         int              `json:"retainCount"`
	Storage             storage.Settings `json:"storage"`
	RecoveryPassword    string           `json:"recoveryPassword,omitempty"`
	HasStorageSecret    bool             `json:"hasStorageSecret"`
	HasRecoveryPassword bool             `json:"hasRecoveryPassword"`
}
type DatabaseBackupRecord struct {
	ID             string     `json:"id"`
	Status         string     `json:"status"`
	Stage          string     `json:"stage"`
	Trigger        string     `json:"trigger"`
	Database       string     `json:"database"`
	ObjectKey      string     `json:"objectKey"`
	Destination    string     `json:"destination"`
	Size           int64      `json:"size"`
	SHA256         string     `json:"sha256"`
	StartedAt      time.Time  `json:"startedAt"`
	FinishedAt     *time.Time `json:"finishedAt,omitempty"`
	Error          string     `json:"error,omitempty"`
	CleanupWarning string     `json:"cleanupWarning,omitempty"`
}

func (s *Service) databaseBackupSettings() (DatabaseBackupSettings, error) {
	cfg := DatabaseBackupSettings{DailyTime: "03:00", Timezone: "Asia/Shanghai", RetainCount: 14, Storage: storage.Settings{Provider: "aliyun", PathPrefix: "database-backups"}}
	row, err := s.repo.SystemSettingOptional(databaseBackupSettingKey)
	if err != nil {
		return cfg, err
	}
	if row != nil {
		if err = json.Unmarshal([]byte(row.ValueJSON), &cfg); err != nil {
			return cfg, errors.New("备份配置损坏，无法读取")
		}
	}
	cfg.Storage.AccessKeySecret, err = s.decryptSettingSecret(cfg.Storage.AccessKeySecret)
	if err != nil {
		return cfg, err
	}
	cfg.RecoveryPassword, err = s.decryptSettingSecret(cfg.RecoveryPassword)
	return cfg, err
}
func publicDatabaseBackupSettings(cfg DatabaseBackupSettings) DatabaseBackupSettings {
	cfg.HasStorageSecret = cfg.Storage.AccessKeySecret != ""
	cfg.HasRecoveryPassword = cfg.RecoveryPassword != ""
	cfg.Storage.AccessKeySecret = ""
	cfg.RecoveryPassword = ""
	return cfg
}
func (s *Service) AdminDatabaseBackupSettings(actor *model.User) (DatabaseBackupSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return DatabaseBackupSettings{}, err
	}
	cfg, err := s.databaseBackupSettings()
	return publicDatabaseBackupSettings(cfg), err
}
func (s *Service) UpdateDatabaseBackupSettings(actor *model.User, cfg DatabaseBackupSettings) (DatabaseBackupSettings, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return cfg, err
	}
	current, err := s.databaseBackupSettings()
	if err != nil {
		return cfg, err
	}
	if cfg.Storage.AccessKeySecret == "" {
		cfg.Storage.AccessKeySecret = current.Storage.AccessKeySecret
	}
	if cfg.RecoveryPassword == "" {
		cfg.RecoveryPassword = current.RecoveryPassword
	}
	if _, err = time.Parse("15:04", cfg.DailyTime); err != nil {
		return cfg, BadAuthRequest("备份时间格式应为 HH:MM")
	}
	if _, err = time.LoadLocation(cfg.Timezone); err != nil {
		return cfg, BadAuthRequest("备份时区无效")
	}
	if cfg.RetainCount < 1 || cfg.RetainCount > 365 {
		return cfg, BadAuthRequest("保留份数须为 1 至 365")
	}
	// Accept only fields needed for independent backup storage. Never inherit
	// media CDN/public URL settings or historical media credentials.
	st := cfg.Storage
	cfg.Storage = storage.NormalizeSettings(storage.Settings{Enabled: true, Provider: st.Provider, Endpoint: strings.TrimSpace(st.Endpoint), Region: st.Region, Bucket: st.Bucket, AccessKeyID: st.AccessKeyID, AccessKeySecret: st.AccessKeySecret, PathPrefix: st.PathPrefix, PathStyle: st.PathStyle})
	if err = validateDatabaseBackupSettings(cfg); err != nil {
		return cfg, BadAuthRequest(err.Error())
	}
	stored := cfg
	stored.Storage.AccessKeySecret, err = s.encryptSettingSecret(cfg.Storage.AccessKeySecret)
	if err != nil {
		return cfg, err
	}
	stored.RecoveryPassword, err = s.encryptSettingSecret(cfg.RecoveryPassword)
	if err != nil {
		return cfg, err
	}
	data, err := json.Marshal(stored)
	if err != nil {
		return cfg, err
	}
	err = s.repo.SaveSystemSetting(&model.SystemSetting{Key: databaseBackupSettingKey, ValueJSON: string(data), UpdatedBy: actor.ID})
	return publicDatabaseBackupSettings(cfg), err
}
func validateDatabaseBackupSettings(cfg DatabaseBackupSettings) error {
	if cfg.Storage.Provider != "aliyun" && cfg.Storage.Provider != "s3" {
		return errors.New("请选择阿里云 OSS 或 S3 兼容存储")
	}
	if !strings.HasPrefix(cfg.Storage.Endpoint, "https://") {
		return errors.New("备份 Endpoint 必须使用 HTTPS")
	}
	if _, err := storage.ValidateStorageEndpoint(cfg.Storage.Endpoint); err != nil {
		return errors.New("备份 Endpoint 无效，请使用不含认证信息、路径和参数的 HTTPS 服务根地址")
	}
	if cfg.Storage.Provider == "s3" && cfg.Storage.Region == "" {
		return errors.New("请填写 S3 Region")
	}
	if cfg.Storage.Bucket == "" || cfg.Storage.AccessKeyID == "" || cfg.Storage.AccessKeySecret == "" {
		return errors.New("请完整填写备份存储凭据")
	}
	if len(cfg.RecoveryPassword) < 16 {
		return errors.New("请设置至少 16 个字节的独立恢复口令，并在服务器之外保存")
	}
	if strings.Contains(cfg.Storage.PathPrefix, "..") || strings.ContainsAny(cfg.Storage.PathPrefix, "\\\r\n") {
		return errors.New("备份目录前缀无效")
	}
	return nil
}
func backupDestination(cfg DatabaseBackupSettings) string {
	return cfg.Storage.Provider + "|" + cfg.Storage.Endpoint + "|" + cfg.Storage.Bucket + "|" + cfg.Storage.PathPrefix
}

func (s *Service) AdminDatabaseBackupRecords(actor *model.User) ([]DatabaseBackupRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	return s.databaseBackupRecords()
}
func (s *Service) databaseBackupRecords() ([]DatabaseBackupRecord, error) {
	rows, err := s.repo.DatabaseBackupRecords()
	if err != nil {
		return nil, err
	}
	records := make([]DatabaseBackupRecord, 0, len(rows))
	for _, row := range rows {
		var record DatabaseBackupRecord
		if err = json.Unmarshal([]byte(row.ValueJSON), &record); err != nil {
			return nil, errors.New("备份记录损坏")
		}
		if record.Status == "running" && time.Since(record.StartedAt) > 30*time.Minute {
			record.Status = "failed"
			record.Error = "备份中断或超时，请重新执行"
		}
		records = append(records, record)
	}
	sort.Slice(records, func(i, j int) bool { return records[i].StartedAt.After(records[j].StartedAt) })
	return records, nil
}
func (s *Service) saveDatabaseBackupRecord(record DatabaseBackupRecord) error {
	data, err := json.Marshal(record)
	if err != nil {
		return err
	}
	return s.repo.SaveSystemSetting(&model.SystemSetting{Key: databaseBackupRecordPrefix + record.ID, ValueJSON: string(data), CreatedAt: record.StartedAt})
}
func (s *Service) StartDatabaseBackup(actor *model.User) (*DatabaseBackupRecord, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return nil, err
	}
	cfg, err := s.databaseBackupSettings()
	if err != nil {
		return nil, err
	}
	if err = validateDatabaseBackupSettings(cfg); err != nil {
		return nil, BadAuthRequest(err.Error())
	}
	record, err := s.claimDatabaseBackup(cfg, "manual")
	if err != nil {
		return nil, err
	}
	if !s.runWorkerLoop(func(ctx context.Context) { s.executeDatabaseBackup(ctx, cfg, *record) }) {
		_ = s.repo.ReleaseDatabaseBackup(record.ID)
		record.Status = "failed"
		record.Error = "服务正在停止，请稍后重试"
		_ = s.saveDatabaseBackupRecord(*record)
		return nil, errors.New(record.Error)
	}
	return record, nil
}
func (s *Service) claimDatabaseBackup(cfg DatabaseBackupSettings, trigger string) (*DatabaseBackupRecord, error) {
	now := time.Now().UTC()
	id := kernel.NewID()
	claimed, err := s.repo.ClaimDatabaseBackup(id, now)
	if err != nil {
		return nil, err
	}
	if !claimed {
		return nil, BadAuthRequest("已有备份正在执行，请等待完成")
	}
	record := DatabaseBackupRecord{ID: id, Status: "running", Stage: "snapshot", Trigger: trigger, Database: s.repo.Dialect(), Destination: backupDestination(cfg), StartedAt: now, ObjectKey: strings.Trim(cfg.Storage.PathPrefix, "/") + "/" + now.Format("2006/01/02") + "/" + id + ".ycbk"}
	if err = s.saveDatabaseBackupRecord(record); err != nil {
		_ = s.repo.ReleaseDatabaseBackup(id)
		return nil, err
	}
	return &record, nil
}
func (s *Service) executeDatabaseBackup(parent context.Context, cfg DatabaseBackupSettings, record DatabaseBackupRecord) {
	ctx, cancel := context.WithTimeout(parent, 25*time.Minute)
	defer cancel()
	defer s.repo.ReleaseDatabaseBackup(record.ID)
	err := s.buildAndUploadDatabaseBackup(ctx, cfg, &record)
	now := time.Now().UTC()
	record.FinishedAt = &now
	record.Stage = ""
	if err != nil {
		record.Status = "failed"
		record.Error = err.Error()
	} else {
		record.Status = "completed"
	}
	if saveErr := s.saveDatabaseBackupRecord(record); saveErr != nil {
		slog.Error("backup record write failed", "id", record.ID)
		return
	}
	if err == nil {
		if cleanupErr := s.pruneDatabaseBackups(ctx, cfg); cleanupErr != nil {
			record.CleanupWarning = "旧备份清理未完成，将在下次成功备份后重试"
			_ = s.saveDatabaseBackupRecord(record)
		}
	}
}
func (s *Service) buildAndUploadDatabaseBackup(ctx context.Context, cfg DatabaseBackupSettings, record *DatabaseBackupRecord) (resultErr error) {
	dir, err := os.MkdirTemp("", "yingce-backup-*")
	if err != nil {
		return errors.New("无法创建备份临时目录")
	}
	defer os.RemoveAll(dir)
	databaseFile := "database.sqlite"
	if s.repo.Dialect() == "postgres" {
		databaseFile = "database.dump"
	}
	// Ensure the stable configuration key is present before snapshotting it.
	if _, err = s.settingsEncryptionKey(); err != nil {
		return errors.New("配置解密文件不可用")
	}
	snapshot := filepath.Join(dir, databaseFile)
	if err = s.repo.SnapshotDatabase(ctx, snapshot); err != nil {
		return err
	}
	tables, err := s.repo.DatabaseBackupTables()
	if err != nil {
		return errors.New("读取数据库表清单失败")
	}
	plain, err := os.OpenFile(filepath.Join(dir, "backup.tar.gz"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer plain.Close()
	manifest := backup.Manifest{Version: 1, Database: s.repo.Dialect(), DatabaseFile: databaseFile, CreatedAt: record.StartedAt, Tables: tables, Exclusions: []string{"原始图片、视频、音频文件（本地 resources 与 OSS 对象需独立保留）", "部署环境变量、Redis 临时队列、服务器程序与日志"}}
	archive := func() error {
		if s.pluginRuntime != nil {
			s.pluginRuntime.mutationMu.Lock()
			defer s.pluginRuntime.mutationMu.Unlock()
		}
		return backup.Archive(ctx, plain, snapshot, s.dataDir, manifest)
	}
	if err = archive(); err != nil {
		return fmt.Errorf("打包失败: %w", err)
	}
	if _, err = plain.Seek(0, io.SeekStart); err != nil {
		return err
	}
	encrypted, err := os.OpenFile(filepath.Join(dir, "backup.ycbk"), os.O_CREATE|os.O_EXCL|os.O_RDWR, 0600)
	if err != nil {
		return err
	}
	defer encrypted.Close()
	if err = backup.Encrypt(encrypted, backupContextReader{ctx, plain}, cfg.RecoveryPassword); err != nil {
		return errors.New("备份加密失败")
	}
	if _, err = encrypted.Seek(0, io.SeekStart); err != nil {
		return err
	}
	hash := sha256.New()
	record.Size, err = io.Copy(hash, backupContextReader{ctx, encrypted})
	if err != nil {
		return err
	}
	record.SHA256 = hex.EncodeToString(hash.Sum(nil))
	if _, err = encrypted.Seek(0, io.SeekStart); err != nil {
		return err
	}
	record.Stage = "upload"
	if err = s.saveDatabaseBackupRecord(*record); err != nil {
		return err
	}
	cfg.Storage.Runtime.TransferTimeout = 20 * time.Minute
	if _, err = storage.PutOSSObjectContext(ctx, cfg.Storage, record.ObjectKey, "application/octet-stream", record.Size, encrypted); err != nil {
		return errors.New("备份上传失败，请检查独立备份存储的写入权限和连接")
	}
	defer func() {
		if resultErr != nil {
			cleanupCtx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
			defer cancel()
			if err := storage.DeleteBackupObject(cleanupCtx, cfg.Storage, record.ObjectKey); err != nil {
				record.CleanupWarning = "未通过校验的对象清理失败，请按记录 ID 在备份存储中检查"
			}
		}
	}()
	record.Stage = "verify"
	if err = s.saveDatabaseBackupRecord(*record); err != nil {
		return err
	}
	stream, err := storage.ReadBackupObject(ctx, cfg.Storage, record.ObjectKey)
	if err != nil {
		return errors.New("上传后读取校验失败，请检查备份存储读取权限")
	}
	defer stream.Close()
	hash = sha256.New()
	size, err := io.Copy(hash, stream)
	if err != nil || size != record.Size || hex.EncodeToString(hash.Sum(nil)) != record.SHA256 {
		return errors.New("远端备份校验失败，未标记为成功")
	}
	return nil
}

func (s *Service) pruneDatabaseBackups(ctx context.Context, cfg DatabaseBackupSettings) error {
	records, err := s.databaseBackupRecords()
	if err != nil {
		return err
	}
	kept := 0
	for _, record := range records {
		if record.Status != "completed" || record.Destination != backupDestination(cfg) {
			continue
		}
		kept++
		if kept <= cfg.RetainCount {
			continue
		}
		if !strings.HasPrefix(record.ObjectKey, strings.Trim(cfg.Storage.PathPrefix, "/")+"/") || !strings.HasSuffix(record.ObjectKey, "/"+record.ID+".ycbk") {
			return errors.New("备份路径校验失败")
		}
		err = storage.DeleteBackupObject(ctx, cfg.Storage, record.ObjectKey)
		if err != nil {
			return err
		}
		record.Status = "expired"
		if err = s.saveDatabaseBackupRecord(record); err != nil {
			return err
		}
	}
	return nil
}

func (s *Service) DatabaseBackupDownload(actor *model.User, id string) (string, error) {
	if err := s.RequireAdmin(actor); err != nil {
		return "", err
	}
	cfg, err := s.databaseBackupSettings()
	if err != nil {
		return "", err
	}
	records, err := s.databaseBackupRecords()
	if err != nil {
		return "", err
	}
	for _, record := range records {
		if record.ID == id && record.Status == "completed" {
			if record.Destination != backupDestination(cfg) {
				return "", BadAuthRequest("该备份位于旧存储位置，请从对应 Bucket 下载")
			}
			return storage.SignedOriginObjectDownloadURL(cfg.Storage, record.ObjectKey, time.Now().Add(5*time.Minute), record.ID+".ycbk")
		}
	}
	return "", BadAuthRequest("备份不存在或尚未完成")
}

func (s *Service) startDatabaseBackupWorker() {
	s.runWorkerLoop(func(ctx context.Context) {
		ticker := time.NewTicker(time.Minute)
		defer ticker.Stop()
		for {
			s.scheduledDatabaseBackup(ctx, time.Now())
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	})
}
func (s *Service) scheduledDatabaseBackup(ctx context.Context, now time.Time) {
	cfg, err := s.databaseBackupSettings()
	if err != nil || !cfg.Enabled {
		return
	}
	location, err := time.LoadLocation(cfg.Timezone)
	if err != nil {
		return
	}
	local := now.In(location)
	if local.Format("15:04") < cfg.DailyTime {
		return
	}
	if err = validateDatabaseBackupSettings(cfg); err != nil {
		return
	}
	day, err := s.repo.SystemSettingOptional("database-backup.day." + local.Format("2006-01-02"))
	if err != nil || day != nil {
		return
	}
	// The global lease is acquired first, so a manual run cannot consume today's
	// schedule slot without actually executing the scheduled backup.
	record, err := s.claimDatabaseBackup(cfg, "scheduled")
	if err != nil {
		return
	}
	claimed, err := s.repo.ClaimDatabaseBackupDay(local.Format("2006-01-02"))
	if err != nil || !claimed {
		_ = s.repo.DeleteSystemSetting(databaseBackupRecordPrefix + record.ID)
		_ = s.repo.ReleaseDatabaseBackup(record.ID)
		return
	}
	s.executeDatabaseBackup(ctx, cfg, *record)
}

type backupContextReader struct {
	ctx context.Context
	r   io.Reader
}

func (r backupContextReader) Read(p []byte) (int, error) {
	if err := r.ctx.Err(); err != nil {
		return 0, err
	}
	return r.r.Read(p)
}
