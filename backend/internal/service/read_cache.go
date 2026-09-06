package service

import (
	"container/list"
	"context"
	"errors"
	"sync"
	"time"
)

var errReadCacheBusy = errors.New("热点读取正在回源，请稍后重试")
var errReadCacheLoadAborted = errors.New("缓存回源异常中断")

// 仅用于可短暂延迟的读投影。限制条目、正文预算和同时回源数；失败短暂冷却，
// 不返回过期成功值，也不允许大量不同 key 将 singleflight 本身变成无界队列。
type boundedReadCache[K comparable, V any] struct {
	mu                             sync.Mutex
	entries                        map[K]*readCacheEntry[K, V]
	lru                            list.List
	bytes, loads                   int
	maxEntries, maxBytes, maxLoads int
	ttl                            time.Duration
}

type readCacheEntry[K comparable, V any] struct {
	key      K
	ready    chan struct{}
	value    V
	err      error
	expires  time.Time
	bytes    int
	position *list.Element
}

func newBoundedReadCache[K comparable, V any](entries, bytes, loads int, ttl time.Duration) *boundedReadCache[K, V] {
	return &boundedReadCache[K, V]{entries: make(map[K]*readCacheEntry[K, V]), maxEntries: entries, maxBytes: bytes, maxLoads: loads, ttl: ttl}
}

func (c *boundedReadCache[K, V]) get(ctx context.Context, key K, load func(context.Context) (V, int, error)) (V, error) {
	var zero V
	if err := ctx.Err(); err != nil {
		return zero, err
	}
	c.mu.Lock()
	if e := c.entries[key]; e != nil {
		if ready := e.ready; ready != nil {
			c.mu.Unlock()
			select {
			case <-ctx.Done():
				return zero, ctx.Err()
			case <-ready:
				return e.value, e.err
			}
		}
		if time.Now().Before(e.expires) {
			c.lru.MoveToFront(e.position)
			value, err := e.value, e.err
			c.mu.Unlock()
			return value, err
		}
		c.remove(e)
	}
	if c.loads >= c.maxLoads {
		c.mu.Unlock()
		return zero, errReadCacheBusy
	}
	for len(c.entries) >= c.maxEntries {
		if !c.evict() {
			c.mu.Unlock()
			return zero, errReadCacheBusy
		}
	}
	e := &readCacheEntry[K, V]{key: key, ready: make(chan struct{})}
	c.entries[key] = e
	c.loads++
	c.mu.Unlock()

	// 让原始 panic 继续传播给调用方，同时释放等待者和容量，避免永久卡住热点 key。
	loaded := false
	defer func() {
		if loaded {
			return
		}
		c.mu.Lock()
		defer c.mu.Unlock()
		c.loads--
		e.err = errReadCacheLoadAborted
		if c.entries[key] == e {
			delete(c.entries, key)
		}
		close(e.ready)
		e.ready = nil
	}()
	value, bytes, err := load(ctx)
	loaded = true
	c.mu.Lock()
	defer c.mu.Unlock()
	c.loads--
	e.value, e.err = value, err
	ready := e.ready
	e.ready = nil
	if c.entries[key] == e {
		ttl := c.ttl
		if err != nil {
			ttl, bytes = time.Second, 256
		}
		bytes = max(bytes, 256)
		if bytes > c.maxBytes || errors.Is(err, context.Canceled) || errors.Is(err, context.DeadlineExceeded) {
			delete(c.entries, key)
		} else {
			for c.bytes+bytes > c.maxBytes {
				if !c.evict() {
					break
				}
			}
			e.bytes, e.expires = bytes, time.Now().Add(ttl)
			e.position = c.lru.PushFront(e)
			c.bytes += bytes
		}
	}
	close(ready)
	return value, err
}

func (c *boundedReadCache[K, V]) evict() bool {
	if oldest := c.lru.Back(); oldest != nil {
		c.remove(oldest.Value.(*readCacheEntry[K, V]))
		return true
	}
	return false
}

func (c *boundedReadCache[K, V]) remove(e *readCacheEntry[K, V]) {
	delete(c.entries, e.key)
	if e.position != nil {
		c.lru.Remove(e.position)
		c.bytes -= e.bytes
	}
}

func (c *boundedReadCache[K, V]) clear() {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.entries = make(map[K]*readCacheEntry[K, V])
	c.lru.Init()
	c.bytes = 0
}
