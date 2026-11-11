package app

import (
	"sync"
	"time"
)

type SystemPerformanceCPU struct {
	Status        string     `json:"status"`
	UsagePercent  *float64   `json:"usagePercent"`
	SampledAt     *time.Time `json:"sampledAt,omitempty"`
	SampleSeconds float64    `json:"sampleSeconds"`
}

type systemCPUSampler struct {
	total     uint64
	idle      uint64
	sampledAt time.Time
	result    SystemPerformanceCPU
}

var systemCPU = struct {
	sync.Mutex
	sampler systemCPUSampler
}{}

func collectSystemCPU() SystemPerformanceCPU {
	// 读计数与更新基线必须一起串行；多个管理员刷新不能颠倒采样顺序。
	systemCPU.Lock()
	defer systemCPU.Unlock()
	total, idle, ok := platformCPUTime()
	return systemCPU.sampler.sample(total, idle, ok, time.Now())
}

func (s *systemCPUSampler) sample(total, idle uint64, ok bool, now time.Time) SystemPerformanceCPU {
	if !ok || idle > total {
		*s = systemCPUSampler{}
		return SystemPerformanceCPU{Status: "unavailable"}
	}
	result := SystemPerformanceCPU{Status: "sampling"}
	elapsed := now.Sub(s.sampledAt)
	if !s.sampledAt.IsZero() && elapsed > 0 && total >= s.total && idle >= s.idle {
		// 快速连续刷新复用原窗口，不用极短差分制造不稳定的使用率。
		if elapsed < time.Second {
			return s.result
		}
		deltaTotal, deltaIdle := total-s.total, idle-s.idle
		if deltaTotal > 0 && deltaIdle <= deltaTotal {
			percentage := float64(deltaTotal-deltaIdle) / float64(deltaTotal) * 100
			result = SystemPerformanceCPU{Status: "ready", UsagePercent: &percentage, SampledAt: &now, SampleSeconds: elapsed.Seconds()}
		}
	}
	// 首次或计数重置后只建立基线，不把未知使用率当成 0%。
	s.total, s.idle, s.sampledAt, s.result = total, idle, now, result
	return result
}
