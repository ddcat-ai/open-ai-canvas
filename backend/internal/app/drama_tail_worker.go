package app

import (
	"context"
	"sync"
	"time"
)

// 剧情段尾帧在调度循环之外抽取：下载段视频（最长 3 分钟）、ffmpeg 取最后一帧再上传，放在循环里会让
// 所有作品在这段时间里都不派发。后台抽取按视频资源去重，单进程同时最多 dramaTailConcurrency 个，
// 跨实例用租约避免同一段视频被重复抽取；结果写库后唤醒调度。
const (
	dramaTailConcurrency = 4
	// dramaTailLeaseTTL 覆盖一次抽取的最长耗时：下载 3 分钟、ffmpeg 1 分钟、上传与写库。
	dramaTailLeaseTTL = 8 * time.Minute
	// dramaTailFailureLimit 是本进程暂存的失败结果上限；正常情况下下一轮调度就会取走。
	dramaTailFailureLimit = 256
)

type dramaTailWorker struct {
	mu      sync.Mutex
	running map[string]bool
	failed  map[string]error
}

// dramaPendingTail 表示段视频已入库、尾帧仍在后台抽取：作业保持运行，下一轮再看。
type dramaPendingTail struct{ resourceID string }

func (e *dramaPendingTail) Error() string { return "尾帧抽取中：" + e.resourceID }

// startDramaTail 在后台执行 work；同一视频资源已有在途抽取、本进程已满或服务正在停机时不启动，调用方下一轮再试。
// work 返回的错误暂存到 takeDramaTailFailure 取走为止。返回本次是否启动。
func (s *Service) startDramaTail(resourceID string, work func() error) bool {
	w := &s.dramaTails
	w.mu.Lock()
	if w.running == nil {
		w.running, w.failed = map[string]bool{}, map[string]error{}
	}
	if w.running[resourceID] || len(w.running) >= dramaTailConcurrency {
		w.mu.Unlock()
		return false
	}
	w.running[resourceID] = true
	w.mu.Unlock()
	run := s.dramaBackgroundRunner
	if run == nil {
		run = s.runWorkerTask
	}
	started := run(func() {
		var workErr error
		done := false
		if release, acquired := s.acquireDramaTailLease(resourceID); acquired {
			workErr, done = work(), true
			release()
		}
		w.mu.Lock()
		delete(w.running, resourceID)
		if workErr != nil {
			if len(w.failed) >= dramaTailFailureLimit {
				w.failed = map[string]error{}
			}
			w.failed[resourceID] = workErr
		}
		w.mu.Unlock()
		// 别的实例正在抽同一段时不唤醒，避免调度与租约竞争空转；按常规轮询再看。
		if done {
			s.wakeDramaScheduler()
		}
	})
	if !started {
		w.mu.Lock()
		delete(w.running, resourceID)
		w.mu.Unlock()
	}
	return started
}

func (s *Service) acquireDramaTailLease(resourceID string) (func(), bool) {
	if s.coordinator == nil {
		return func() {}, true
	}
	ctx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	release, acquired, err := s.coordinator.Acquire(ctx, "drama-tail:"+resourceID, 1, dramaTailLeaseTTL)
	if err != nil || !acquired {
		return nil, false
	}
	return release, true
}

// takeDramaTailFailure 取出并清除该视频最近一次后台抽取的失败原因；没有失败时返回 nil。
func (s *Service) takeDramaTailFailure(resourceID string) error {
	w := &s.dramaTails
	w.mu.Lock()
	defer w.mu.Unlock()
	err := w.failed[resourceID]
	delete(w.failed, resourceID)
	return err
}
