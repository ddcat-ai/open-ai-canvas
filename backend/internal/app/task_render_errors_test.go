package app

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net/url"
	"os"
	"strings"
	"syscall"
	"testing"

	"yingce/backend/internal/model"
)

func TestRenderSaveFailureMessages(t *testing.T) {
	for _, tc := range []struct {
		name string
		err  error
		want string
	}{
		{"oss EOF", &resourceObjectWriteError{provider: "oss", err: &url.Error{Op: "Put", URL: "https://private.example/video?token=secret", Err: io.EOF}}, "上传对象存储（OSS/S3）失败：传输连接意外中断（EOF）"},
		{"timeout", fmt.Errorf("upload: %w", context.DeadlineExceeded), "请求超时"},
		{"disk full", &resourceObjectWriteError{provider: "local", err: &os.PathError{Op: "write", Path: "/private/render.mp4", Err: syscall.ENOSPC}}, "写入服务器本地存储失败：服务器磁盘空间不足"},
		{"permission", os.ErrPermission, "文件访问权限不足"},
		{"database", errors.New("database is locked"), "保存成片失败：数据库正忙"},
		{"sqlite busy", fmt.Errorf("create resource: %w", errors.New("database is locked (5) (SQLITE_BUSY)")), "保存成片失败：数据库正忙"},
		{"storage capacity", fmt.Errorf("保存资源就绪状态失败：%w", StorageCapacityExceeded("账号文件容量不足，请清理素材或购买存储空间")), "保存成片失败：账号文件容量不足，请清理素材或购买存储空间。已有镜头"},
		{"daily quota", QuotaExceeded("每个账号 UTC 自然日上传总量必须小于 2GB。"), "保存成片失败：每个账号 UTC 自然日上传总量必须小于 2GB。已有镜头"},
		{"missing record", nil, "存储未返回有效的成片记录"},
		{"opaque storage error", errors.New("Put https://private.example/video?token=secret: Authorization=secret"), "存储返回未分类的错误"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			got := renderSaveFailureMessage(tc.err)
			if !strings.Contains(got, tc.want) || !strings.Contains(got, "已有镜头无需重新生成") {
				t.Fatalf("unexpected message: %s", got)
			}
			for _, sensitive := range []string{"private.example", "secret", "/private/render.mp4"} {
				if strings.Contains(got, sensitive) {
					t.Fatalf("sensitive detail in message: %s", got)
				}
			}
		})
	}
}

func TestRenderStorageFailureRetainsCauseAndTaskMessage(t *testing.T) {
	svc, db := newTimelineTaskTestService(t)
	_, _, err := svc.storeResourceWithWriter("usr-render-test", "media", "render.mp4", "video/mp4", 1, 1, 1, 1,
		strings.NewReader("x"), nil, true, func(_ *model.Resource, _ string, _ io.Reader) (string, error) {
			return "", io.ErrUnexpectedEOF
		})
	var writeErr *resourceObjectWriteError
	if !errors.As(err, &writeErr) || !errors.Is(err, io.ErrUnexpectedEOF) {
		t.Fatalf("lost storage error cause: %v", err)
	}
	task := seedRunningRenderTask(t, db, "{}")
	message := renderSaveFailureMessage(err)
	if err := newTaskWorkerCoordinator(svc).failTimelineTask(task, "保存成片失败", message); err != nil {
		t.Fatal(err)
	}
	var stored model.Task
	if err := db.First(&stored, "id = ?", task.ID).Error; err != nil {
		t.Fatal(err)
	}
	if stored.Status != model.TaskStatusFailed || stored.Stage != "保存成片失败" || stored.Error != message {
		t.Fatalf("failure not persisted: status=%s stage=%s error=%s", stored.Status, stored.Stage, stored.Error)
	}
}
