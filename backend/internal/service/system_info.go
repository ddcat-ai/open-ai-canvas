package service

import (
	"bufio"
	"fmt"
	"net"
	"os"
	"os/exec"
	"runtime"
	"strconv"
	"strings"
	"time"
)

type SystemInstance struct {
	ID            string  `json:"id"`
	Name          string  `json:"name"`
	Role          string  `json:"role"`
	IP            string  `json:"ip"`
	Status        string  `json:"status"`
	Online        bool    `json:"online"`
	CPUPercent    float64 `json:"cpuPercent"`
	MemoryPercent float64 `json:"memoryPercent"`
	MemoryUsedGB  float64 `json:"memoryUsedGb"`
	MemoryTotalGB float64 `json:"memoryTotalGb"`
	DiskPercent   float64 `json:"diskPercent"`
	DiskUsedGB    float64 `json:"diskUsedGb"`
	DiskTotalGB   float64 `json:"diskTotalGb"`
	Version       string  `json:"version"`
	Platform      string  `json:"platform"`
	BootedAt      string  `json:"bootedAt"`
	ReportedAt    string  `json:"reportedAt"`
}

func CollectSystemInstances(commit string, buildTime string) []SystemInstance {
	memTotalKB, memAvailableKB := readMemInfo()
	memTotalGB := roundTo(float64(memTotalKB)/1024/1024, 2)
	memAvailableGB := roundTo(float64(memAvailableKB)/1024/1024, 2)
	memUsedGB := roundTo(maxFloat(memTotalGB-memAvailableGB, 0), 2)
	memPercent := 0.0
	if memTotalGB > 0 {
		memPercent = roundTo(memUsedGB/memTotalGB*100, 1)
	}
	diskTotalGB, diskUsedGB, diskPercent := readDiskUsage("/")
	hostname, _ := os.Hostname()
	hostname = pickNonEmpty(os.Getenv("CANVAS_INSTANCE_NAME"), hostname)
	if hostname == "" {
		hostname = "canvas-node"
	}
	now := time.Now().UTC()
	return []SystemInstance{{
		ID: hostname, Name: hostname, Role: "master", IP: readPrimaryIPv4(), Status: "online", Online: true,
		CPUPercent: readCPUPercent(), MemoryPercent: memPercent, MemoryUsedGB: memUsedGB, MemoryTotalGB: memTotalGB,
		DiskPercent: diskPercent, DiskUsedGB: diskUsedGB, DiskTotalGB: diskTotalGB,
		Version: fmt.Sprintf("%s · %s", trimTo(strings.TrimSpace(commit), 7), strings.TrimSpace(buildTime)),
		Platform: fmt.Sprintf("%s · %s · %s", runtime.GOOS, runtime.GOARCH, readKernelVersion()),
		BootedAt: readBootTime(), ReportedAt: now.Format(time.RFC3339),
	}}
}

func readMemInfo() (totalKB int64, availableKB int64) {
	f, err := os.Open("/proc/meminfo")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 2 {
			continue
		}
		value, parseErr := strconv.ParseInt(fields[1], 10, 64)
		if parseErr != nil {
			continue
		}
		switch fields[0] {
		case "MemTotal:":
			totalKB = value
		case "MemAvailable:":
			availableKB = value
		}
	}
	return totalKB, availableKB
}

func readCPUPercent() float64 {
	busy1, total1 := readProcStatBusyTotal()
	if total1 == 0 {
		return 0
	}
	time.Sleep(100 * time.Millisecond)
	busy2, total2 := readProcStatBusyTotal()
	if total2 <= total1 {
		return 0
	}
	return roundTo(float64(busy2-busy1)/float64(total2-total1)*100, 1)
}

func readProcStatBusyTotal() (busy, total uint64) {
	f, err := os.Open("/proc/stat")
	if err != nil {
		return 0, 0
	}
	defer f.Close()
	scanner := bufio.NewScanner(f)
	for scanner.Scan() {
		fields := strings.Fields(scanner.Text())
		if len(fields) < 5 || fields[0] != "cpu" {
			continue
		}
		var values [8]uint64
		for index := 0; index < len(values) && index+1 < len(fields); index++ {
			values[index], _ = strconv.ParseUint(fields[index+1], 10, 64)
		}
		busy = values[0] + values[1] + values[2] + values[5] + values[6] + values[7]
		for _, value := range values {
			total += value
		}
		return busy, total
	}
	return 0, 0
}

func readDiskUsage(path string) (totalGB, usedGB, percent float64) {
	out, err := exec.Command("df", "-B1", path).Output()
	if err != nil {
		return 0, 0, 0
	}
	lines := strings.Split(strings.TrimSpace(string(out)), "\n")
	if len(lines) < 2 {
		return 0, 0, 0
	}
	fields := strings.Fields(lines[len(lines)-1])
	if len(fields) < 5 {
		return 0, 0, 0
	}
	total, _ := strconv.ParseInt(fields[1], 10, 64)
	used, _ := strconv.ParseInt(fields[2], 10, 64)
	totalGB = roundTo(float64(total)/1024/1024/1024, 2)
	usedGB = roundTo(float64(used)/1024/1024/1024, 2)
	if total > 0 {
		percent = roundTo(float64(used)/float64(total)*100, 1)
	}
	return totalGB, usedGB, percent
}

func readBootTime() string {
	data, err := os.ReadFile("/proc/stat")
	if err != nil {
		return ""
	}
	for _, line := range strings.Split(string(data), "\n") {
		fields := strings.Fields(line)
		if len(fields) != 2 || fields[0] != "btime" {
			continue
		}
		seconds, _ := strconv.ParseInt(fields[1], 10, 64)
		if seconds > 0 {
			return time.Unix(seconds, 0).UTC().Format(time.RFC3339)
		}
	}
	return ""
}

func readKernelVersion() string {
	data, err := os.ReadFile("/proc/version")
	if err != nil {
		return ""
	}
	fields := strings.Fields(string(data))
	if len(fields) >= 3 {
		return fields[2]
	}
	return ""
}

func readPrimaryIPv4() string {
	interfaces, err := net.Interfaces()
	if err != nil {
		return ""
	}
	for _, iface := range interfaces {
		if iface.Flags&net.FlagUp == 0 || iface.Flags&net.FlagLoopback != 0 {
			continue
		}
		addresses, addressErr := iface.Addrs()
		if addressErr != nil {
			continue
		}
		for _, address := range addresses {
			ip, _, splitErr := net.ParseCIDR(address.String())
			if splitErr == nil && ip.To4() != nil {
				return ip.String()
			}
		}
	}
	return ""
}

func roundTo(value float64, digits int) float64 {
	pow := 1.0
	for index := 0; index < digits; index++ {
		pow *= 10
	}
	return float64(int64(value*pow+0.5)) / pow
}

func trimTo(value string, maxLength int) string {
	if len(value) <= maxLength {
		return value
	}
	return value[:maxLength]
}

func pickNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(value)
		}
	}
	return ""
}

func maxFloat(value float64, minimum float64) float64 {
	if value < minimum {
		return minimum
	}
	return value
}
