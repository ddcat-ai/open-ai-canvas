package service

import (
	"strings"
	"sync"
	"time"
)

const (
	taskTextStreamFlushBytes    = 2 << 10
	taskTextStreamFlushInterval = 500 * time.Millisecond
)

// taskTextStreamPublisher batches model deltas before persisting them. Streaming
// is an observability and recovery enhancement: persistence failure must not turn
// an otherwise successful model response into a failed generation task.
type taskTextStreamPublisher struct {
	service  *Service
	userID   string
	taskID   string
	mu       sync.Mutex
	buffer   strings.Builder
	timer    *time.Timer
	disabled bool
	closed   bool
}

func newTaskTextStreamPublisher(service *Service, userID string, taskID string) *taskTextStreamPublisher {
	return &taskTextStreamPublisher{service: service, userID: userID, taskID: taskID}
}

func (p *taskTextStreamPublisher) Publish(delta string) {
	if p == nil || delta == "" {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	if p.disabled || p.closed {
		return
	}
	p.buffer.WriteString(delta)
	if p.buffer.Len() >= taskTextStreamFlushBytes {
		p.flushLocked()
		return
	}
	if p.timer == nil {
		p.timer = time.AfterFunc(taskTextStreamFlushInterval, p.flush)
	}
}

func (p *taskTextStreamPublisher) Close() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.closed = true
	p.flushLocked()
}

func (p *taskTextStreamPublisher) flush() {
	if p == nil {
		return
	}
	p.mu.Lock()
	defer p.mu.Unlock()
	p.flushLocked()
}

func (p *taskTextStreamPublisher) flushLocked() {
	if p.timer != nil {
		p.timer.Stop()
		p.timer = nil
	}
	if p.disabled || p.buffer.Len() == 0 {
		return
	}
	content := p.buffer.String()
	p.buffer.Reset()
	if _, err := p.service.AppendTaskTextDelta(p.userID, p.taskID, content); err != nil {
		p.disabled = true
		_ = p.service.log(p.userID, p.taskID, "warn", "文本流持久化已降级", err.Error())
	}
}
