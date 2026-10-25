package app

import (
	"os"
	"strconv"
	"sync"
	"time"
)

// Waiting tasks remain in the database. This queue only arbitrates the next
// transfer slot; it never parks a worker or starts a goroutine per waiting task.
type mediaTransferScheduler struct {
	mu      sync.Mutex
	active  map[string]int
	waiting map[string]time.Time
	order   []string
}

func mediaEnvLimit(name string, fallback, maximum int) int {
	value, err := strconv.Atoi(os.Getenv(name))
	if err != nil || value < 1 || value > maximum {
		return fallback
	}
	return value
}

func (q *mediaTransferScheduler) acquire(userID string, slots chan struct{}, base, ceiling int) (func(), bool) {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.active == nil {
		q.active = make(map[string]int)
		q.waiting = make(map[string]time.Time)
	}
	now := time.Now()
	order := q.order[:0]
	for _, user := range q.order {
		// A cancelled task must not reserve the head of the queue forever.
		if now.Sub(q.waiting[user]) > 30*time.Second {
			delete(q.waiting, user)
			continue
		}
		order = append(order, user)
	}
	q.order = order
	wait := func() (func(), bool) {
		if _, exists := q.waiting[userID]; !exists {
			q.order = append(q.order, userID)
		}
		q.waiting[userID] = now
		return nil, false
	}
	limit := ceiling
	for _, user := range q.order {
		if user != userID {
			limit = base
			break
		}
	}
	if q.active[userID] >= limit {
		return wait()
	}
	// Skip accounts already at their fair share: they must not block an idle account.
	for _, user := range q.order {
		if q.active[user] >= base {
			continue
		}
		if user != userID {
			return wait()
		}
		break
	}
	select {
	case slots <- struct{}{}:
	default:
		return wait()
	}
	q.active[userID]++
	delete(q.waiting, userID)
	for i, user := range q.order {
		if user == userID {
			q.order = append(q.order[:i], q.order[i+1:]...)
			break
		}
	}
	var once sync.Once
	return func() {
		once.Do(func() {
			q.mu.Lock()
			defer q.mu.Unlock()
			<-slots
			q.active[userID]--
			if q.active[userID] == 0 {
				delete(q.active, userID)
			}
		})
	}, true
}
