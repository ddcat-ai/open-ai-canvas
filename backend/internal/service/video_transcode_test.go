package service

import (
	"encoding/binary"
	"os"
	"os/exec"
	"path/filepath"
	"testing"
	"time"

	"infinite-canvas/backend/internal/model"
)

// stsdBox 构造仅含 first-sample-entry fourcc 的最小 stsd box（置于 moov 切片内）。
func stsdBoxWithFourcc(fourcc string) []byte {
	b := make([]byte, 24)
	binary.BigEndian.PutUint32(b[0:4], 24)
	copy(b[4:8], "stsd")
	// body: version/flags(4) + entry_count(4)=1 + entry_size(4) + fourcc(4)
	binary.BigEndian.PutUint32(b[12:16], 1)
	binary.BigEndian.PutUint32(b[16:20], 8)
	copy(b[20:24], fourcc)
	return b
}

func TestCodecFromMoov(t *testing.T) {
	cases := []struct {
		fourcc string
		want   string
	}{
		{"hvc1", videoCodecH265},
		{"hev1", videoCodecH265},
		{"avc1", videoCodecH264},
		{"av01", videoCodecAV1},
		{"vp09", videoCodecVP9},
	}
	for _, c := range cases {
		if got := codecFromMoov(stsdBoxWithFourcc(c.fourcc)); got != c.want {
			t.Errorf("codecFromMoov(%s) = %q, want %q", c.fourcc, got, c.want)
		}
	}
	if got := codecFromMoov([]byte{0, 1, 2, 3}); got != "" {
		t.Errorf("garbage moov codec = %q, want empty", got)
	}
}

func TestProbeVideoCodecReadsRealFile(t *testing.T) {
	// 构造 ftyp + moov(含 hvc1 stsd) 的最小 mp4 文件，验证 probeVideoCodec 走文件读取路径。
	stsd := stsdBoxWithFourcc("hvc1")
	moov := make([]byte, 8+len(stsd))
	binary.BigEndian.PutUint32(moov[0:4], uint32(len(moov)))
	copy(moov[4:8], "moov")
	copy(moov[8:], stsd)
	full := make([]byte, 0, 16+len(moov))
	ftyp := make([]byte, 16)
	binary.BigEndian.PutUint32(ftyp[0:4], 16)
	copy(ftyp[4:8], "ftyp")
	copy(ftyp[8:12], "isom")
	full = append(full, ftyp...)
	full = append(full, moov...)

	path := filepath.Join(t.TempDir(), "clip.mp4")
	if err := os.WriteFile(path, full, 0o644); err != nil {
		t.Fatal(err)
	}
	if got := probeVideoCodec(path); got != videoCodecH265 {
		t.Errorf("probeVideoCodec = %q, want h265", got)
	}
}

// TestBackfillRejudgesLegacyNoneVideos 覆盖修复：判定规则变更前（H.265/MPEG-4 Part 2
// 曾被误判可播）落 none 的存量本地视频，启动回填必须重新按 codec 判定——
// H.264 保持 none（幂等），MPEG-4 触发转码并最终落到 failed/ready 终态。
func TestBackfillRejudgesLegacyNoneVideos(t *testing.T) {
	service, db := newProjectAssetLinkTestService(t)
	dataDir := t.TempDir()
	service.dataDir = dataDir

	seedLegacy := func(id, fourcc string) {
		t.Helper()
		stsd := stsdBoxWithFourcc(fourcc)
		moov := make([]byte, 8+len(stsd))
		binary.BigEndian.PutUint32(moov[0:4], uint32(len(moov)))
		copy(moov[4:8], "moov")
		copy(moov[8:], stsd)
		ftyp := make([]byte, 16)
		binary.BigEndian.PutUint32(ftyp[0:4], 16)
		copy(ftyp[4:8], "ftyp")
		copy(ftyp[8:12], "isom")
		full := append(append([]byte{}, ftyp...), moov...)
		rel := filepath.Join("clips", id+".mp4")
		p := filepath.Join(dataDir, "resources", filepath.FromSlash(rel))
		if err := os.MkdirAll(filepath.Dir(p), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(p, full, 0o644); err != nil {
			t.Fatal(err)
		}
		res := model.Resource{
			ID: id, UserID: "user-1", Kind: "video", Status: model.ResourceStatusReady,
			Provider: "local", ObjectKey: rel, PlaybackStatus: model.PlaybackStatusNone,
		}
		if err := db.Create(&res).Error; err != nil {
			t.Fatal(err)
		}
	}
	seedLegacy("legacy-h264", "avc1")
	seedLegacy("legacy-mpeg4", "mp4v")

	service.BackfillPlaybackTranscodes()

	var h264 model.Resource
	if err := db.First(&h264, "id = ?", "legacy-h264").Error; err != nil {
		t.Fatal(err)
	}
	if h264.PlaybackStatus != model.PlaybackStatusNone {
		t.Fatalf("H.264 存量 none 行被错误改判为 %q", h264.PlaybackStatus)
	}

	// MPEG-4 行应被抢占转码。fake mp4 不含真实视频流，ffmpeg 解码必败 → failed；
	// 若某环境恰有同名 ready 副本则也接受。轮询直到终态，避免 goroutine 竞态。
	if _, err := exec.LookPath("ffmpeg"); err != nil {
		t.Log("无 ffmpeg，跳过 MPEG-4 终态断言")
		return
	}
	var mp4v model.Resource
	deadline := time.Now().Add(10 * time.Second)
	for {
		if err := db.First(&mp4v, "id = ?", "legacy-mpeg4").Error; err != nil {
			t.Fatal(err)
		}
		if mp4v.PlaybackStatus == model.PlaybackStatusFailed || mp4v.PlaybackStatus == model.PlaybackStatusReady {
			break
		}
		if time.Now().After(deadline) {
			t.Fatalf("MPEG-4 存量行未达终态，停在 %q（error=%q）", mp4v.PlaybackStatus, mp4v.PlaybackError)
		}
		time.Sleep(100 * time.Millisecond)
	}
	if mp4v.PlaybackStatus != model.PlaybackStatusFailed {
		t.Fatalf("fake mp4v 应转码失败落 failed，实际 %q", mp4v.PlaybackStatus)
	}
}
