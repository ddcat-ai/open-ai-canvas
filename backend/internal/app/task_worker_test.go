package app

import (
	"context"
	"errors"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
	"infinite-canvas/backend/internal/repository"
)

// 续租必须比"这条任务的执行时限"活得更久：否则父 context 到点时，续租请求会被自己的
// 执行时限取消，失败后被误判成"租约失效"（任务停在 running，租约过期后被别的 worker 重跑）。
func TestTaskLeaseRenewContextSurvivesExecutionDeadline(t *testing.T) {
	parent, cancelParent := context.WithTimeout(context.Background(), 20*time.Millisecond)
	defer cancelParent()
	<-parent.Done()
	if parent.Err() == nil {
		t.Fatal("父 context 应当已到点")
	}

	renew, cancelRenew := taskLeaseRenewContext(parent)
	defer cancelRenew()
	if err := renew.Err(); err != nil {
		t.Fatalf("父 context 到点后，续租 context 不该被取消：%v", err)
	}
	deadline, ok := renew.Deadline()
	if !ok {
		t.Fatal("续租 context 必须保有自己的上限")
	}
	if remaining := time.Until(deadline); remaining <= 0 || remaining > 5*time.Second {
		t.Fatalf("续租上限应当是全新的 5 秒，实际剩余 %v", remaining)
	}

	// 父 context 之后再取消，也不能把已经建好的续租 context 一起取消（worker 退出时
	// 续租请求最多自己超时，而不是被"任务已结束"顺手打断）。
	parent2, cancelParent2 := context.WithCancel(context.Background())
	renew2, cancelRenew2 := taskLeaseRenewContext(parent2)
	defer cancelRenew2()
	cancelParent2()
	if err := renew2.Err(); err != nil {
		t.Fatalf("父 context 取消不该连带取消续租 context：%v", err)
	}
}

func TestTaskDeadlineRenewalAndTerminalFencing(t *testing.T) {
	for _, lost := range []bool{false, true} {
		name := "deadline_with_valid_lease"
		if lost {
			name = "deadline_with_reclaimed_lease"
		}
		t.Run(name, func(t *testing.T) {
			db := newSQLiteTestDB(t)
			if err := db.AutoMigrate(&model.Task{}); err != nil {
				t.Fatal(err)
			}
			repo := repository.New(db)
			if err := db.Create(&model.Task{ID: "deadline-task", UserID: "user", Type: "canvas_text", Status: model.TaskStatusQueued}).Error; err != nil {
				t.Fatal(err)
			}
			task, err := repo.ClaimNextTask("worker-a", time.Minute)
			if err != nil || task == nil {
				t.Fatalf("claim: %v %v", task, err)
			}
			ctx, cancel := context.WithDeadline(context.Background(), time.Now().Add(-time.Second))
			defer cancel()
			renew, cancelRenew := taskLeaseRenewContext(ctx)
			defer cancelRenew()
			if lost {
				if err := db.Model(&model.Task{}).Where("id = ?", task.ID).Update("lease_expires_at", time.Now().Add(-time.Second)).Error; err != nil {
					t.Fatal(err)
				}
				reclaimed, err := repo.ClaimNextTask("worker-b", time.Minute)
				if err != nil || reclaimed == nil {
					t.Fatalf("reclaim: %v %v", reclaimed, err)
				}
			}
			err = repo.WithContext(renew).RenewTaskLease(task.ID, task.LeaseOwner, time.Minute)
			if (err != nil) != lost {
				t.Fatalf("renew lost=%v: %v", lost, err)
			}
			billing, replay := &taskTerminalBillingStub{}, &taskTerminalReplayStub{}
			terminal := newTaskTerminalCoordinatorForTest(repo, billing, replay, &taskTerminalLoggerStub{}, &taskTerminalOutputStub{})
			err = terminal.handleExecutionFailure(task, ctx.Err(), false, false)
			stored, readErr := repo.Task(task.ID)
			if readErr != nil {
				t.Fatal(readErr)
			}
			if lost {
				if !errors.Is(err, repository.ErrTaskStateConflict) || stored.Status != model.TaskStatusRunning || stored.LeaseOwner != "worker-b" {
					t.Fatalf("stale terminal write: %v %#v", err, stored)
				}
				if len(billing.refund)+len(billing.uncertain)+len(replay.statuses) != 0 {
					t.Fatal("stale worker emitted terminal side effects")
				}
			} else {
				if !errors.Is(err, context.DeadlineExceeded) || stored.Status != model.TaskStatusFailed {
					t.Fatalf("deadline not finalized: %v %#v", err, stored)
				}
				next, err := repo.ClaimNextTask("worker-b", time.Minute)
				if err != nil || next != nil {
					t.Fatalf("terminal task reclaimed: %v %v", next, err)
				}
			}
		})
	}
}
