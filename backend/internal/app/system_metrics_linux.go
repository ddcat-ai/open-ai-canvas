//go:build linux

package app

import (
	"os"
	"strconv"
	"strings"
)

func platformMemory() (uint64, uint64, bool) {
	data, err := os.ReadFile("/proc/meminfo")
	if err != nil {
		return 0, 0, false
	}
	values := map[string]uint64{}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) < 2 {
			continue
		}
		key := strings.TrimSuffix(fields[0], ":")
		if key != "MemTotal" && key != "MemAvailable" {
			continue
		}
		value, err := strconv.ParseUint(fields[1], 10, 64)
		if err != nil || len(fields) != 3 || fields[2] != "kB" || value > ^uint64(0)/1024 {
			return 0, 0, false
		}
		values[key] = value * 1024
	}
	total := values["MemTotal"]
	available, found := values["MemAvailable"]
	return total, available, found && total > 0 && available <= total
}

func platformCPUTime() (uint64, uint64, bool) {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return 0, 0, false
	}
	return parseLinuxCPUTime(string(data))
}

func parseLinuxCPUTime(data string) (uint64, uint64, bool) {
	fields := strings.Fields(strings.SplitN(data, "\n", 2)[0])
	if len(fields) < 5 || fields[0] != "cpu" {
		return 0, 0, false
	}
	var total, idle uint64
	// guest/guest_nice 已计入 user/nice；iowait 作为非忙碌时间，不重复累计。
	for index := 1; index < min(len(fields), 9); index++ {
		value, err := strconv.ParseUint(fields[index], 10, 64)
		if err != nil || value > ^uint64(0)-total {
			return 0, 0, false
		}
		total += value
		if index == 4 || index == 5 {
			idle += value
		}
	}
	return total, idle, total > 0
}

func platformLoadAverage() ([3]float64, bool) {
	var result [3]float64
	data, err := os.ReadFile("/proc/loadavg")
	if err != nil {
		return result, false
	}
	fields := strings.Fields(string(data))
	if len(fields) < 3 {
		return result, false
	}
	for index := range 3 {
		result[index], _ = strconv.ParseFloat(fields[index], 64)
	}
	return result, true
}
