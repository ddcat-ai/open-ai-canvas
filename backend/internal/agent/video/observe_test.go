package video

import (
	"context"
	"errors"
	"image"
	_ "image/jpeg"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"
)

func TestObserveRealVideoTimestampsAndRanges(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg 验证真实视频")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("需要 FFprobe 验证真实视频")
	}
	for _, sample := range []struct{ offset, extension string }{{"0", "mp4"}, {"5", "mp4"}, {"5", "mkv"}} {
		t.Run("origin-"+sample.offset+"-"+sample.extension, func(t *testing.T) {
			tmp := t.TempDir()
			input := filepath.Join(tmp, "sample."+sample.extension)
			cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=4:duration=2", "-an", "-c:v", "mpeg4", "-output_ts_offset", sample.offset, input)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("生成视频: %v %s", err, output)
			}
			for _, scenario := range []struct {
				name  string
				start int64
				end   *int64
				want  []int64
			}{
				{"overview", 0, nil, []int64{0, 750, 1750}},
				{"detail", 500, ptr(1500), []int64{500, 1250}},
			} {
				t.Run(scenario.name, func(t *testing.T) {
					out := t.TempDir()
					ctx, cancel := context.WithTimeout(context.Background(), 10*time.Second)
					defer cancel()
					result, err := Observe(ctx, ffmpeg, ffprobe, input, out, scenario.start, scenario.end, 3)
					if err != nil {
						t.Fatal(err)
					}
					if len(result.Frames) != len(scenario.want) {
						t.Fatalf("帧数: %+v", result)
					}
					for i, frame := range result.Frames {
						if frame.TimestampMs != scenario.want[i] {
							t.Fatalf("时间=%d 期望=%d", frame.TimestampMs, scenario.want[i])
						}
						file, err := os.Open(frame.Path)
						if err != nil {
							t.Fatal(err)
						}
						config, _, err := image.DecodeConfig(file)
						file.Close()
						if err != nil || config.Width != 160 || config.Height != 90 {
							t.Fatalf("真实帧无法读取: %+v %v", config, err)
						}
					}
				})
			}
		})
	}
}

func TestObserveCancelledContext(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	_, err := Observe(ctx, "ffmpeg", "ffprobe", "unused", t.TempDir(), 0, nil, 2)
	if !errors.Is(err, context.Canceled) {
		t.Fatalf("取消未传播: %v", err)
	}
}

func ptr(v int64) *int64 { return &v }

func TestObserveVariableFramesRotationAndSegmentBoundary(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("需要 FFprobe")
	}
	for _, scenario := range []struct {
		name, source, filter string
		end                  *int64
		want                 []int64
		truncated            bool
	}{
		{"variable_rate", "testsrc2=size=160x90:rate=8:duration=2", "select=not(eq(n\\,3)+eq(n\\,5)+eq(n\\,7))", nil, []int64{0, 1000, 1875}, false},
		{"segment", "testsrc2=size=160x90:rate=1:duration=32", "null", nil, []int64{0, 14000, 29000}, true},
	} {
		t.Run(scenario.name, func(t *testing.T) {
			tmp := t.TempDir()
			input := filepath.Join(tmp, "sample.mp4")
			cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", scenario.source, "-vf", scenario.filter, "-fps_mode", "vfr", "-c:v", "mpeg4", input)
			if output, err := cmd.CombinedOutput(); err != nil {
				t.Fatalf("生成样本: %v %s", err, output)
			}
			result, err := Observe(context.Background(), ffmpeg, ffprobe, input, t.TempDir(), 0, scenario.end, 3)
			if err != nil {
				t.Fatal(err)
			}
			if result.Truncated != scenario.truncated || len(result.Frames) != len(scenario.want) {
				t.Fatalf("分段或帧数错误: %+v", result)
			}
			for i, frame := range result.Frames {
				if frame.TimestampMs != scenario.want[i] {
					t.Fatalf("非均匀帧时间=%d，期望=%d", frame.TimestampMs, scenario.want[i])
				}
			}
			if scenario.truncated {
				next, err := Observe(context.Background(), ffmpeg, ffprobe, input, t.TempDir(), result.EndMs, nil, 3)
				if err != nil || len(next.Frames) != 2 || next.Frames[0].TimestampMs != 30000 || next.Frames[1].TimestampMs != 31000 {
					t.Fatalf("续读范围错误: %+v %v", next, err)
				}
			}
		})
	}
	t.Run("rotation", func(t *testing.T) {
		tmp := t.TempDir()
		input, rotated := filepath.Join(tmp, "sample.mp4"), filepath.Join(tmp, "rotated.mp4")
		cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=2:duration=1", "-c:v", "mpeg4", input)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("生成样本: %v %s", err, output)
		}
		cmd = exec.Command(ffmpeg, "-v", "error", "-display_rotation:v:0", "90", "-i", input, "-c", "copy", rotated)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("旋转样本: %v %s", err, output)
		}
		result, err := Observe(context.Background(), ffmpeg, ffprobe, rotated, t.TempDir(), 0, nil, 2)
		if err != nil {
			t.Fatal(err)
		}
		file, err := os.Open(result.Frames[0].Path)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		config, _, err := image.DecodeConfig(file)
		if err != nil || config.Width != 90 || config.Height != 160 {
			t.Fatalf("旋转画面错误: %+v %v", config, err)
		}
	})
	t.Run("display_aspect_ratio", func(t *testing.T) {
		tmp := t.TempDir()
		input := filepath.Join(tmp, "sample.mp4")
		cmd := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc2=size=160x90:rate=2:duration=1", "-vf", "setsar=2", "-c:v", "mpeg4", input)
		if output, err := cmd.CombinedOutput(); err != nil {
			t.Fatalf("生成样本: %v %s", err, output)
		}
		result, err := Observe(context.Background(), ffmpeg, ffprobe, input, t.TempDir(), 0, nil, 2)
		if err != nil {
			t.Fatal(err)
		}
		file, err := os.Open(result.Frames[0].Path)
		if err != nil {
			t.Fatal(err)
		}
		defer file.Close()
		config, _, err := image.DecodeConfig(file)
		if err != nil || config.Width != 320 || config.Height != 90 {
			t.Fatalf("显示比例错误: %+v %v", config, err)
		}
	})
}

func TestObserveRejectsPlaylistAndCorruptInput(t *testing.T) {
	ffmpeg, err := exec.LookPath("ffmpeg")
	if err != nil {
		t.Skip("需要 FFmpeg")
	}
	ffprobe, err := exec.LookPath("ffprobe")
	if err != nil {
		t.Skip("需要 FFprobe")
	}
	for _, body := range []string{"not a video", "#EXTM3U\n#EXT-X-TARGETDURATION:1\n#EXTINF:1,\nfile:///etc/passwd\n#EXT-X-ENDLIST\n"} {
		tmp := t.TempDir()
		input := filepath.Join(tmp, "input.video")
		if err := os.WriteFile(input, []byte(body), 0600); err != nil {
			t.Fatal(err)
		}
		_, err := Observe(context.Background(), ffmpeg, ffprobe, input, tmp, 0, nil, 2)
		var decodeErr *Error
		if !errors.As(err, &decodeErr) || decodeErr.Reason != "video_decode_failed" {
			t.Fatalf("恶意或损坏输入未拒绝: %v", err)
		}
	}
}
