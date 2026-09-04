package service

import (
	"encoding/binary"
	"os"
	"path/filepath"
	"testing"
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
