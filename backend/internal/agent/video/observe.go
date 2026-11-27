// Package video 提供有界的视频采样；只接收服务端已落盘文件，不接受网络地址。
package video

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"math"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	"sort"
	"strconv"
	"strings"
)

const MaxRangeMs int64 = 30_000

type Error struct {
	Reason  string
	Message string
}

func (e *Error) Error() string { return e.Message }

type Frame struct {
	TimestampMs int64  `json:"timestampMs"`
	Path        string `json:"-"`
}

type Result struct {
	DurationMs     int64   `json:"durationMs"`
	StartMs        int64   `json:"startMs"`
	EndMs          int64   `json:"endMs"`
	RequestedEndMs int64   `json:"requestedEndMs"`
	Truncated      bool    `json:"truncated"`
	Frames         []Frame `json:"frames"`
}

// 有界缓冲拒绝过量探测输出，避免高帧率或恶意容器耗尽进程内存。
type limitedBuffer struct {
	bytes.Buffer
	limit int
}

func (b *limitedBuffer) Write(p []byte) (int, error) {
	if b.Len()+len(p) > b.limit {
		return 0, errors.New("视频探测输出超限")
	}
	return b.Buffer.Write(p)
}

func run(ctx context.Context, bin string, args ...string) ([]byte, error) {
	out := &limitedBuffer{limit: 4 << 20}
	stderr := &limitedBuffer{limit: 64 << 10}
	cmd := exec.CommandContext(ctx, bin, args...)
	cmd.Stdout, cmd.Stderr = out, stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		// 解码器的错误可能包含本机路径，不向调用方透传原始 stderr。
		return nil, &Error{"video_decode_failed", "视频探测或解码失败，请检查文件格式和完整性"}
	}
	return out.Bytes(), nil
}

func failure(reason, message string) error { return &Error{reason, message} }

var frameTime = regexp.MustCompile(`\bpts_time:([-+0-9.eE]+)`)

// Observe 最多解码一个短时间段；时间依据来自原流 PTS，支持可变帧率与非零起点。
// 调用方负责超时、并发、下载限额及输出目录的生命周期。
func Observe(ctx context.Context, ffmpeg, ffprobe, input, output string, startMs int64, endMs *int64, maxFrames int) (Result, error) {
	var result Result
	if startMs < 0 || maxFrames < 1 || maxFrames > 16 {
		return result, failure("video_invalid_range", "视频时间范围或帧预算无效")
	}
	durationMs, origin, err := probeInfo(ctx, ffprobe, input)
	if err != nil {
		return result, err
	}
	result.DurationMs, result.StartMs = durationMs, startMs
	result.RequestedEndMs = durationMs
	if endMs != nil {
		result.RequestedEndMs = *endMs
	}
	if startMs >= durationMs || result.RequestedEndMs <= startMs || result.RequestedEndMs > durationMs {
		return result, failure("video_invalid_range", "视频范围须位于实际时长内，且结束时间大于开始时间")
	}
	result.EndMs = min(result.RequestedEndMs, startMs+MaxRangeMs)
	result.Truncated = result.EndMs < result.RequestedEndMs
	start, end := float64(startMs)/1000, float64(result.EndMs)/1000
	times, err := probeFrameTimes(ctx, ffprobe, input, origin+start, origin+end)
	if err != nil {
		return result, err
	}
	count := min(maxFrames, len(times), max(2, int(math.Ceil(end-start))+1))
	selected := make([]float64, 0, count)
	for i := 0; i < count; i++ {
		index := 0
		if count > 1 {
			index = i * (len(times) - 1) / (count - 1)
		}
		selected = append(selected, times[index])
	}
	result.Frames, err = decodeFrames(ctx, ffmpeg, input, output, start, end, origin, selected)
	return result, err
}

func probeArguments() []string {
	return []string{"-v", "error", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mpegts,mpeg,mpegvideo,flv,ogg", "-max_alloc", "67108864", "-threads", "1"}
}

// 探测只返回归一化后的时间原点与时长，不把容器 JSON 合同扩散到编排层。
func probeInfo(ctx context.Context, ffprobe, input string) (int64, float64, error) {
	args := append(probeArguments(), "-select_streams", "v:0", "-show_entries", "format=format_name,duration,start_time:stream=width,height,start_time,duration", "-of", "json", input)
	data, err := run(ctx, ffprobe, args...)
	if err != nil {
		return 0, 0, err
	}
	var info struct {
		Format struct {
			Name     string `json:"format_name"`
			Duration string `json:"duration"`
			Start    string `json:"start_time"`
		} `json:"format"`
		Streams []struct {
			Width    int    `json:"width"`
			Height   int    `json:"height"`
			Duration string `json:"duration"`
			Start    string `json:"start_time"`
		} `json:"streams"`
	}
	if json.Unmarshal(data, &info) != nil || len(info.Streams) != 1 {
		return 0, 0, failure("video_decode_failed", "视频中没有可解码的画面流")
	}
	stream := info.Streams[0]
	origin, _ := strconv.ParseFloat(info.Format.Start, 64)
	duration, _ := strconv.ParseFloat(stream.Duration, 64)
	if duration <= 0 {
		duration, _ = strconv.ParseFloat(info.Format.Duration, 64)
		// Matroska 的容器 duration 是时间轴终点，带非零起点时须换成相对时长。
		if strings.Contains(info.Format.Name, "matroska") || strings.Contains(info.Format.Name, "webm") {
			duration -= origin
		}
	} else {
		streamStart, err := strconv.ParseFloat(stream.Start, 64)
		if err == nil {
			duration += max(0, streamStart-origin)
		}
	}
	if math.IsNaN(duration) || math.IsInf(duration, 0) || duration <= 0 || duration > 86400 || stream.Width < 1 || stream.Height < 1 || int64(stream.Width)*int64(stream.Height) > 33_554_432 {
		return 0, 0, failure("video_decode_limit", "视频时长或画面尺寸超过观察限制")
	}
	return int64(math.Round(duration * 1000)), origin, nil
}

func probeFrameTimes(ctx context.Context, ffprobe, input string, start, end float64) ([]float64, error) {
	interval := fmt.Sprintf("%.6f%%%.6f", start, end)
	args := append(probeArguments(), "-select_streams", "v:0", "-read_intervals", interval, "-show_frames", "-show_entries", "frame=best_effort_timestamp_time", "-of", "json", input)
	data, err := run(ctx, ffprobe, args...)
	if err != nil {
		return nil, err
	}
	var probe struct {
		Frames []struct {
			Time string `json:"best_effort_timestamp_time"`
		} `json:"frames"`
	}
	if json.Unmarshal(data, &probe) != nil {
		return nil, failure("video_decode_failed", "无法读取视频帧时间")
	}
	times := make([]float64, 0, len(probe.Frames))
	for _, f := range probe.Frames {
		v, err := strconv.ParseFloat(f.Time, 64)
		if err == nil && !math.IsNaN(v) && !math.IsInf(v, 0) && v >= start-0.000001 && v < end {
			times = append(times, v)
		}
	}
	sort.Float64s(times)
	times = unique(times)
	if len(times) == 0 {
		return nil, failure("video_no_frames", "指定时间范围内没有可解码画面")
	}
	return times, nil
}

func decodeFrames(ctx context.Context, ffmpeg, input, output string, start, end, origin float64, selected []float64) ([]Frame, error) {
	count := len(selected)
	selectors := make([]string, 0, len(selected))
	for _, v := range selected {
		selectors = append(selectors, fmt.Sprintf("lt(abs(t-%.6f)\\,0.00001)", v))
	}
	// 先按显示比例求方形像素尺寸；不能只把 SAR 改成1，否则变形像素视频会被压扁。
	filter := "select=" + strings.Join(selectors, "+") + ",scale=w='max(1,min(960,min(iw*sar,960*dar)))':h='max(1,ow/dar)',setsar=1,showinfo"
	stderr := &limitedBuffer{limit: 128 << 10}
	cmd := exec.CommandContext(ctx, ffmpeg, "-hide_banner", "-loglevel", "info", "-nostdin", "-protocol_whitelist", "file,pipe", "-format_whitelist", "mov,matroska,webm,avi,mpegts,mpeg,mpegvideo,flv,ogg", "-max_alloc", "67108864", "-threads", "1", "-filter_threads", "1", "-copyts", "-ss", fmt.Sprintf("%.6f", start), "-t", fmt.Sprintf("%.6f", end-start), "-i", input, "-map", "0:v:0", "-an", "-sn", "-dn", "-vf", filter, "-frames:v", strconv.Itoa(count), "-fps_mode", "vfr", "-threads", "1", "-q:v", "4", filepath.Join(output, "frame-%02d.jpg"))
	cmd.Stderr = stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, ctx.Err()
		}
		return nil, failure("video_decode_failed", "视频画面提取失败")
	}
	frames := make([]Frame, 0, count)
	for _, match := range frameTime.FindAllStringSubmatch(stderr.String(), -1) {
		if _, err := strconv.ParseFloat(match[1], 64); err != nil {
			continue
		}
		if len(frames) >= len(selected) {
			return nil, failure("video_decode_failed", "视频帧超过已选择的时间点")
		}
		path := filepath.Join(output, fmt.Sprintf("frame-%02d.jpg", len(frames)+1))
		stat, err := os.Stat(path)
		if err != nil || stat.Size() <= 0 || stat.Size() > 2<<20 {
			return nil, failure("video_decode_failed", "视频帧缺失或超过大小限制")
		}
		// showinfo 的小数打印精度有限；实际选中帧以 FFprobe 的原始 PTS 为准。
		frames = append(frames, Frame{TimestampMs: int64(math.Round((selected[len(frames)] - origin) * 1000)), Path: path})
	}
	if len(frames) != count {
		return nil, failure("video_decode_failed", "视频帧与实际时间信息不一致")
	}
	return frames, nil
}

func unique(times []float64) []float64 {
	result := times[:0]
	for _, v := range times {
		if len(result) == 0 || v > result[len(result)-1]+0.000001 {
			result = append(result, v)
		}
	}
	return result
}
