package app

import "sync"

type canvasStorageOwnerLock struct {
	mu   sync.Mutex
	refs int
}

// refs 同时统计持有者和等待者；最后一个调用退出后释放键，避免账号数持续累积。
type canvasStorageOwnerLocks struct {
	mu    sync.Mutex
	locks map[string]*canvasStorageOwnerLock
}

func (l *canvasStorageOwnerLocks) acquire(ownerKey string) func() {
	l.mu.Lock()
	if l.locks == nil {
		l.locks = make(map[string]*canvasStorageOwnerLock)
	}
	entry := l.locks[ownerKey]
	if entry == nil {
		entry = &canvasStorageOwnerLock{}
		l.locks[ownerKey] = entry
	}
	entry.refs++
	l.mu.Unlock()
	entry.mu.Lock()
	return func() {
		entry.mu.Unlock()
		l.mu.Lock()
		entry.refs--
		if entry.refs == 0 {
			delete(l.locks, ownerKey)
		}
		l.mu.Unlock()
	}
}

func (s *Service) withCanvasStorageLock(ownerKey string, fn func() error) error {
	if ownerKey == "" {
		return BadAuthRequest("画布存储归属不能为空")
	}
	// 同一归属键覆盖其全部画布的共享配额；先等账号锁，避免等待者长期占用全局读锁。
	release := s.canvasStorageOwners.acquire(ownerKey)
	defer release()
	// 不同账号只共享读侧。现有素材写入、任务落库和清理仍持写锁，继续保护引用和配额。
	s.storageMu.RLock()
	defer s.storageMu.RUnlock()
	return fn()
}
