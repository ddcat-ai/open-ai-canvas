package app

import (
	"fmt"
	"sort"
	"strings"

	"yingce/backend/internal/model"
)

// 派发并发池：文字（作品圣经、分集规划、剧本、段提示词）、参考图、段视频与成片合成各按“同时生成数”计算，
// 互不占用。段视频在上游一跑就是几分钟到十几分钟，共用一个池时会把提示词和参考图堵在后面；大批参考图
// 排队时也会反过来挡住视频。
const (
	dramaPoolText   = "text"
	dramaPoolImage  = "image"
	dramaPoolVideo  = "video"
	dramaPoolRender = "render"
)

var dramaPoolLabels = map[string]string{dramaPoolText: "文字", dramaPoolImage: "参考图", dramaPoolVideo: "段视频", dramaPoolRender: "成片合成"}

func dramaDispatchPool(kind string) string {
	switch kind {
	case model.DramaJobCastImage:
		return dramaPoolImage
	case model.DramaJobSegmentVideo:
		return dramaPoolVideo
	case model.DramaJobRender:
		return dramaPoolRender
	}
	return dramaPoolText
}

// 作业优先级：作品级工作（圣经、分集规划、参考图）在前；单集工作先按集号排，前面的集整体优先，
// 同一集内再按 成片 > 剧本 > 段提示词 > 段视频。分池以后优先级只在同一池内、以及账号同时任务数
// 用满时决定谁先提交：例如第 1 集的段提示词排在第 5 集的剧本前面，第 1 集更早进入出片。
const (
	dramaPriorityBible     = 30_000_000
	dramaPriorityPlan      = 20_000_000
	dramaPriorityCastImage = 10_100_000

	dramaRankRender = 900
	dramaRankScript = 800
	dramaRankPrompt = 700
	dramaRankVideo  = 300
	// dramaRankSegmentSpan 是同一集内按段序再细分的范围，保证段序不会越过相邻的作业类型。
	dramaRankSegmentSpan = 299
)

// episodePriority 是第 number 集某类作业的优先级；集号越小越靠前，每集占 1000 的区间。
func episodePriority(rank int, number int) int {
	return (10000-min(max(number, 1), 9999))*1000 + rank
}

// segmentPriority 在同一集同类作业里让前面的段先提交。
func segmentPriority(rank int, number int, segmentIndex int) int {
	return episodePriority(rank, number) - min(max(segmentIndex, 0), dramaRankSegmentSpan)
}

func castImagePriority(position int) int {
	return dramaPriorityCastImage - min(max(position, 0), 99_999)
}

// sortDramaJobsForDispatch 是派发顺序：优先级高的在前，同优先级先排队的在前。
func sortDramaJobsForDispatch(jobs []model.DramaJob) {
	sort.SliceStable(jobs, func(i, j int) bool {
		if jobs[i].Priority != jobs[j].Priority {
			return jobs[i].Priority > jobs[j].Priority
		}
		return jobs[i].CreatedAt.Before(jobs[j].CreatedAt)
	})
}

// dramaProductionWait 是作品层面挡住所有提交的原因；空串表示作品在运行。
func dramaProductionWait(p *model.DramaProduction) string {
	switch {
	case p.Status == model.DramaStatusPaused:
		if reason := strings.TrimSpace(p.PauseReason); reason != "" {
			return "制作已暂停：" + reason
		}
		return "制作已暂停"
	case p.Status != model.DramaStatusRunning:
		return "制作未在运行，点“继续制作”后开始"
	}
	return ""
}

// dramaDispatchWaits 说明已排队的作业为什么还没提交，判断与 dispatch 同源：作品状态、账号同时任务上限、
// 本池同时生成数，以及池内排在它前面的作业。返回的函数对下一轮调度就会提交的作业给出空串。
func (s *Service) dramaDispatchWaits(p *model.DramaProduction) (func(job DramaJobView) string, error) {
	settings := parseDramaSettings(p.SettingsJSON)
	jobs, err := s.repo.DramaJobsByStatus(p.ProjectID, model.DramaJobQueued, model.DramaJobRunning)
	if err != nil {
		return nil, err
	}
	running := map[string]int{}
	queued := make([]model.DramaJob, 0, len(jobs))
	for _, job := range jobs {
		if job.Status == model.DramaJobRunning {
			running[dramaDispatchPool(job.Kind)]++
		} else {
			queued = append(queued, job)
		}
	}
	sortDramaJobsForDispatch(queued)
	ahead := make(map[string]int, len(queued))
	seen := map[string]int{}
	for _, job := range queued {
		pool := dramaDispatchPool(job.Kind)
		ahead[job.ID] = seen[pool]
		seen[pool]++
	}
	policy, err := s.RuntimePolicy()
	if err != nil {
		return nil, err
	}
	active, err := s.repo.ActiveTaskCountForUser(p.UserID)
	if err != nil {
		return nil, err
	}
	productionWait := dramaProductionWait(p)
	limit := policy.Task.ActiveTaskLimit
	return func(job DramaJobView) string {
		position, ok := ahead[job.ID]
		if job.Status != model.DramaJobQueued || !ok {
			return ""
		}
		if productionWait != "" {
			return productionWait
		}
		if limit > 0 && active >= int64(limit) {
			return fmt.Sprintf("等待账号空位：同时排队或运行的任务已达 %d 个上限（含画布等其他任务），有任务完成后自动提交", limit)
		}
		pool := dramaDispatchPool(job.Kind)
		if settings.Concurrency-running[pool] > position {
			return ""
		}
		label := dramaPoolLabels[pool]
		if position == 0 {
			return fmt.Sprintf("等待作品空位：%s同时生成 %d 个已满，完成一个后提交", label, settings.Concurrency)
		}
		return fmt.Sprintf("等待作品空位：%s同时生成 %d 个已满，前面还有 %d 项排队", label, settings.Concurrency, position)
	}, nil
}

// fillDramaJobWaits 为排队中的作业补上等待原因；没有排队作业时不读库。
func (s *Service) fillDramaJobWaits(p *model.DramaProduction, views ...*DramaJobView) error {
	needed := false
	for _, view := range views {
		if view != nil && view.Status == model.DramaJobQueued {
			needed = true
			break
		}
	}
	if !needed {
		return nil
	}
	wait, err := s.dramaDispatchWaits(p)
	if err != nil {
		return err
	}
	for _, view := range views {
		if view != nil {
			view.Wait = wait(*view)
		}
	}
	return nil
}
