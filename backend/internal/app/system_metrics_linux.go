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
		value, _ := strconv.ParseUint(fields[1], 10, 64)
		values[strings.TrimSuffix(fields[0], ":")] = value * 1024
	}
	total, available := values["MemTotal"], values["MemAvailable"]
	return total, available, total > 0
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
