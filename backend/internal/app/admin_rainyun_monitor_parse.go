package app

import (
	"encoding/json"
	"errors"
	"math"
	"sort"
	"strings"
	"time"
	"unicode"
)

// 官方控制台 7895/2987 的实例详情为 envelope.data.Data；只接已确认的精确字段，
// 不把 OpenAPI 中不完整的小写模型、缺失统计或未识别状态猜成已知值。
func parseRainyunInstance(body []byte, now time.Time, result *SystemPerformanceRainyun) error {
	var envelope map[string]json.RawMessage
	if json.Unmarshal(body, &envelope) != nil {
		return errors.New("invalid rainyun envelope")
	}
	var code int
	var data, instance map[string]json.RawMessage
	if json.Unmarshal(envelope["code"], &code) != nil || code != 200 || json.Unmarshal(envelope["data"], &data) != nil || json.Unmarshal(data["Data"], &instance) != nil || instance == nil {
		return errors.New("invalid rainyun instance")
	}
	var plan, usage map[string]json.RawMessage
	_ = json.Unmarshal(instance["Plan"], &plan)
	_ = json.Unmarshal(instance["UsageData"], &usage)
	result.Status, result.StatusMessage, result.CloudStatus = "unknown", "雨云实例返回了未识别状态，暂不能判断健康状态", "未知"
	switch rainyunMonitorText(instance["Status"]) {
	case "running":
		result.Status, result.StatusMessage, result.CloudStatus = "healthy", "雨云实例运行中", "运行中"
	case "stopped":
		result.Status, result.StatusMessage, result.CloudStatus = "warning", "雨云实例已停止，请检查套餐及服务状态", "已停止"
	}
	result.PlanName = rainyunMonitorText(plan["chinese"])
	if result.PlanName == "" {
		result.PlanName = rainyunMonitorText(plan["plan_name"])
	}
	result.ExpiresAt = rainyunMonitorTime(instance["ExpDate"])
	result.PeriodStart = rainyunMonitorTime(instance["last_reset_date"])
	result.PeriodEnd = rainyunMonitorTime(instance["next_reset_date"])
	if raw := instance["is_enable_extra_accounting"]; len(raw) > 0 && string(raw) != "null" {
		var enabled bool
		if json.Unmarshal(raw, &enabled) == nil {
			result.ExtraAccounting = &enabled
		}
	}
	result.StorageUsedBytes = rainyunMonitorBytes(usage["metrics_usage_total_bytes"], 1)
	result.TrafficUsedBytes = rainyunMonitorBytes(usage["metrics_sent_bytes"], 1)
	result.StorageQuotaBytes = rainyunMonitorBytes(plan["storage_size"], 1073741824)
	result.TrafficQuotaBytes = rainyunMonitorBytes(plan["bandwidth"], 1073741824)
	result.StatisticsMessage = "实例级统计，包含实例下全部桶；空间为当前存储量，流量为当前重置周期发送流量。"
	missing := []string{}
	for _, metric := range []struct {
		name  string
		value *int64
	}{
		{"已用空间", result.StorageUsedBytes}, {"已用流量", result.TrafficUsedBytes},
		{"空间额度", result.StorageQuotaBytes}, {"流量额度", result.TrafficQuotaBytes},
	} {
		if metric.value == nil {
			missing = append(missing, metric.name)
		}
	}
	if len(missing) > 0 {
		result.StatisticsMessage += " 暂无有效" + strings.Join(missing, "、") + "数据，不代表已用为零。"
	}
	if result.ExpiresAt != nil && !result.ExpiresAt.After(now) {
		result.Status, result.StatusMessage = "warning", "雨云实例套餐已到期"
	} else if rainyunMonitorQuotaReached(result.StorageUsedBytes, result.StorageQuotaBytes) || rainyunMonitorQuotaReached(result.TrafficUsedBytes, result.TrafficQuotaBytes) {
		result.Status, result.StatusMessage = "warning", "雨云实例用量已达到套餐额度"
		if result.ExtraAccounting != nil && *result.ExtraAccounting {
			result.StatusMessage += "，已开启超量计费"
		}
	}
	return nil
}

func rainyunMonitorText(raw json.RawMessage) string {
	var text string
	if json.Unmarshal(raw, &text) != nil || len(text) > 160 {
		return ""
	}
	for _, char := range text {
		if unicode.IsControl(char) {
			return ""
		}
	}
	return strings.TrimSpace(text)
}

func rainyunMonitorNumber(raw json.RawMessage) (float64, bool) {
	var value float64
	if len(raw) == 0 || string(raw) == "null" || json.Unmarshal(raw, &value) != nil || math.IsNaN(value) || math.IsInf(value, 0) || value < 0 {
		return 0, false
	}
	return value, true
}

func rainyunMonitorBytes(raw json.RawMessage, unit float64) *int64 {
	value, valid := rainyunMonitorNumber(raw)
	value *= unit
	if !valid || value >= float64(math.MaxInt64) || math.Trunc(value) != value {
		return nil
	}
	bytes := int64(value)
	return &bytes
}

func rainyunMonitorTime(raw json.RawMessage) *time.Time {
	value, valid := rainyunMonitorNumber(raw)
	if !valid || value <= 0 {
		return nil
	}
	// 与官方 chunk-common 模块 47292 的 i$ 相同：小于 1e11 为秒，其余为毫秒。
	if value < 1e11 {
		value *= 1000
	}
	if value > 253402300799999 {
		return nil
	}
	date := time.UnixMilli(int64(value)).UTC()
	return &date
}

func rainyunMonitorQuotaReached(used, quota *int64) bool {
	return used != nil && quota != nil && *quota > 0 && *used >= *quota
}

// 官方 2987/5483 直接使用 data.Columns/Values，time 为秒；流量不做累计差分，
// requests_total 也不逐点相加。缺列、null 和非法值必须保留为未知，不能补零。
func parseRainyunRealtime(body []byte, end time.Time) ([]RainyunRealtimePoint, error) {
	var envelope, data map[string]json.RawMessage
	var code int
	var columns []string
	var values [][]json.RawMessage
	if json.Unmarshal(body, &envelope) != nil || json.Unmarshal(envelope["code"], &code) != nil || code != 200 || json.Unmarshal(envelope["data"], &data) != nil || json.Unmarshal(data["Columns"], &columns) != nil || json.Unmarshal(data["Values"], &values) != nil || columns == nil || values == nil {
		return nil, errors.New("invalid rainyun realtime envelope")
	}
	indices := map[string]int{}
	for index, column := range columns {
		if _, exists := indices[column]; !exists {
			indices[column] = index
		}
	}
	timeIndex, exists := indices["time"]
	if !exists {
		return nil, errors.New("missing rainyun realtime time column")
	}
	metric := func(row []json.RawMessage, name string) *float64 {
		index, exists := indices[name]
		if !exists || index >= len(row) {
			return nil
		}
		value, valid := rainyunMonitorNumber(row[index])
		// 浏览器 number 超过安全整数范围会丢精度；不把超大值伪造成图表指标。
		if !valid || value > 9007199254740991 {
			return nil
		}
		return &value
	}
	byTime := make(map[int64]RainyunRealtimePoint)
	for _, row := range values {
		if timeIndex >= len(row) {
			continue
		}
		seconds, valid := rainyunMonitorNumber(row[timeIndex])
		if !valid || seconds <= 0 || seconds > 253402300799 {
			continue
		}
		at := time.UnixMilli(int64(seconds * 1000)).UTC()
		if at.Before(end.Add(-rainyunRealtimeWindow)) || at.After(end) {
			continue
		}
		byTime[at.UnixMilli()] = RainyunRealtimePoint{
			Time:                   at,
			ReceivedBytesPerSecond: metric(row, "minio_bucket_traffic_received_bytes"),
			SentBytesPerSecond:     metric(row, "minio_bucket_traffic_sent_bytes"),
			RequestsTotal:          metric(row, "minio_bucket_requests_total"),
		}
	}
	points := make([]RainyunRealtimePoint, 0, len(byTime))
	for _, point := range byTime {
		points = append(points, point)
	}
	sort.Slice(points, func(i, j int) bool { return points[i].Time.Before(points[j].Time) })
	if len(points) > rainyunRealtimeMaxPoints {
		points = append([]RainyunRealtimePoint(nil), points[len(points)-rainyunRealtimeMaxPoints:]...)
	}
	return points, nil
}

func rainyunRealtimeWindowPoints(points []RainyunRealtimePoint, now time.Time) []RainyunRealtimePoint {
	result := make([]RainyunRealtimePoint, 0, min(len(points), rainyunRealtimeMaxPoints))
	for _, point := range points {
		if !point.Time.Before(now.Add(-rainyunRealtimeWindow)) && !point.Time.After(now) {
			result = append(result, point)
		}
	}
	return result
}

func rainyunRealtimeSampleInterval(points []RainyunRealtimePoint) *float64 {
	if len(points) < 2 {
		return nil
	}
	interval := points[1].Time.Sub(points[0].Time)
	if interval <= 0 {
		return nil
	}
	for index := 2; index < len(points); index++ {
		if points[index].Time.Sub(points[index-1].Time) != interval {
			return nil
		}
	}
	seconds := interval.Seconds()
	return &seconds
}
