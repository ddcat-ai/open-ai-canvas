package app

import (
	"errors"
	"fmt"
	"math"
	"strings"
	"time"

	"infinite-canvas/backend/internal/model"
)

const defaultChannelPricingMultiplierBPS int64 = 10_000

func normalizeChannelTimePricing(pricing *model.ChannelTimePricing) (*model.ChannelTimePricing, error) {
	if pricing == nil || len(pricing.Periods) == 0 {
		return nil, nil
	}
	normalized := &model.ChannelTimePricing{Timezone: strings.TrimSpace(pricing.Timezone), Periods: append([]model.ChannelTimePricingPeriod(nil), pricing.Periods...)}
	for index := range normalized.Periods {
		normalized.Periods[index].StartTime = strings.TrimSpace(normalized.Periods[index].StartTime)
		normalized.Periods[index].EndTime = strings.TrimSpace(normalized.Periods[index].EndTime)
	}
	return normalized, validateChannelTimePricing(normalized)
}

func validateChannelTimePricing(pricing *model.ChannelTimePricing) error {
	if pricing == nil {
		return nil
	}
	zone := strings.TrimSpace(pricing.Timezone)
	if zone == "" {
		return errors.New("时间段计费必须配置时区")
	}
	if _, err := time.LoadLocation(zone); err != nil || zone == "Local" {
		return errors.New("时间段计费时区无效，请使用 IANA 时区")
	}
	for index, period := range pricing.Periods {
		start, end, err := parseChannelTimePeriod(period)
		if err != nil {
			return fmt.Errorf("第 %d 条时间段无效：%w", index+1, err)
		}
		if math.IsNaN(period.Multiplier) || math.IsInf(period.Multiplier, 0) || period.Multiplier < 0.01 || period.Multiplier > 100 {
			return fmt.Errorf("第 %d 条时间段倍率必须在 0.01-100 之间", index+1)
		}
		if math.Abs(period.Multiplier*100-math.Round(period.Multiplier*100)) > 1e-9 {
			return fmt.Errorf("第 %d 条时间段倍率最多保留两位小数", index+1)
		}
		for previousIndex := 0; previousIndex < index; previousIndex++ {
			previousStart, previousEnd, _ := parseChannelTimePeriod(pricing.Periods[previousIndex])
			if start < previousEnd && previousStart < end {
				return errors.New("时间段不能重叠")
			}
		}
	}
	return nil
}

func channelTimePricingMultiplier(pricing *model.ChannelTimePricing, now time.Time) (int64, error) {
	if pricing == nil || len(pricing.Periods) == 0 {
		return defaultChannelPricingMultiplierBPS, nil
	}
	if err := validateChannelTimePricing(pricing); err != nil {
		return 0, err
	}
	location, err := time.LoadLocation(strings.TrimSpace(pricing.Timezone))
	if err != nil {
		return 0, err
	}
	local := now.In(location)
	second := local.Hour()*3600 + local.Minute()*60 + local.Second()
	for _, period := range pricing.Periods {
		start, end, _ := parseChannelTimePeriod(period)
		if second >= start && second < end {
			return int64(math.Round(period.Multiplier * float64(defaultChannelPricingMultiplierBPS))), nil
		}
	}
	return defaultChannelPricingMultiplierBPS, nil
}

func parseChannelTimePeriod(period model.ChannelTimePricingPeriod) (int, int, error) {
	parse := func(value string) (int, error) {
		value = strings.TrimSpace(value)
		for _, layout := range []string{"15:04", "15:04:05"} {
			if len(value) != len(layout) {
				continue
			}
			parsed, err := time.Parse(layout, value)
			if err == nil {
				return parsed.Hour()*3600 + parsed.Minute()*60 + parsed.Second(), nil
			}
		}
		return 0, errors.New("时间必须使用 HH:mm 或 HH:mm:ss 格式")
	}
	start, err := parse(period.StartTime)
	if err != nil {
		return 0, 0, err
	}
	end, err := parse(period.EndTime)
	if err != nil {
		return 0, 0, err
	}
	if end == 0 {
		end = 24 * 60 * 60
	}
	if start >= end {
		return 0, 0, errors.New("结束时间必须晚于开始时间，跨午夜请拆成两段")
	}
	return start, end, nil
}

func combineMultiplierBasisPoints(base int64, additional int64) (int64, error) {
	if base <= 0 || additional <= 0 || base > (1<<63-1)/additional {
		return 0, errors.New("积分倍率溢出")
	}
	product := base * additional
	if product > (1<<63-1)-9_999 {
		return 0, errors.New("积分倍率溢出")
	}
	return (product + 9_999) / 10_000, nil
}
