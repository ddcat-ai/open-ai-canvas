// 发给文本模型的图片：按渠道模型声明的单张图片上限决定要不要压缩。
//
// Agent 看图把画布素材读成内联 data URL 交给文本模型时，原样转发就等于把画布成品
// 的字节尺寸（模型配置里常见 30 MB）当成发送预算：base64 再膨胀约三分之一，
// 请求体可达四十多 MB，上游常见反应是 413、超时，或者干脆把上下文挤爆。
// 这里只在图片超过模型上限时，把发送副本压回上限以内：先等比缩小，再降 JPEG 质量；
// 带透明通道的图优先保持 PNG，PNG 缩到下限仍超上限才铺白底转 JPEG。
//
// 上限为 0（不限）或图片本来就不超限时零开销：只比长度，不解码。
// 只压缩发送副本：资源文件、任务输入 JSON 和检查点里的 resource: 占位都不动。

package app

import (
	"bytes"
	"encoding/base64"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	"image/png"
	"math"

	"golang.org/x/image/draw"

	_ "golang.org/x/image/webp"
)

const (
	// textModelImageCompressionMaxInput 是压缩时允许读进内存的原图硬顶。
	// 解码要在内存里放整张图，而 ResourceUploadMB 在自用态可配到几百 MB；
	// 取 32 MB 与出站内镜的单张读取上限同口径（模型单图上限的常见最大值就是 30 MB）。
	textModelImageCompressionMaxInput int64 = 32 << 20
	// textModelImageMaxEdge 是发送前的最长边上限。主流视觉模型本来就会把更长的边缩到
	// 一千多像素再编码，保留更多像素只会多付视觉 token 与带宽，换不到可用细节。
	textModelImageMaxEdge = 1568
	// textModelImageMinEdge 是缩放的最长边下限：再小就看不清画面了。到这里仍超上限时
	// 交出已得到的最小结果，由模型自己声明的上限决定这次请求是否成立。
	textModelImageMinEdge = 256
	// textModelImageQualityProbe 是每次尺寸档上的第一个探针质量：命中就只用这一次编码。
	textModelImageQualityProbe = 80
	// textModelImageQualityFloor 是质量地板。到这里仍超上限就缩一档尺寸继续，
	// 而不是把图压成一团马赛克。
	textModelImageQualityFloor = 45
	// textModelImageQualityStepRatio 是"每降 1 档质量体积约乘以多少"的实测经验值，
	// 用于一次探针之后解析式定位目标质量（实测 0.96–0.98）。
	textModelImageQualityStepRatio = 0.97
)

// textModelImageCompressionQualities 已由 textModelImageQualityProbe 的解析式定位取代。

// errTextModelImageLimitNeedsPixels 拦住"看图 + 对象存储 URL 交付"的组合策略：
// 签名 URL 会让上游自己取回原始字节，压缩随之失效，模型声明的单图上限也就失去了意义。
var errTextModelImageLimitNeedsPixels = errors.New("看图需要内联真实像素，不能按对象存储地址交付")

// textModelImageOversizedMessage 是"连压缩都做不了"时的拒绝文案：模型声明的单张图片上限
// 不再是拒绝理由（发送前会按它压缩），只有超出可读入内存的单张硬顶才算不可用。
func textModelImageOversizedMessage() string {
	return fmt.Sprintf("图片超过可处理的单张上限 %d MB，请先缩小后再查看", textModelImageCompressionMaxInput>>20)
}

// textModelImageRejectable 判断超出可读入内存上限的图片能否直接拒绝。
// 上限越大，压缩目标就越向硬顶靠拢：单图上限配到 32 MB 的本金规模时，真正的约束是解压内存，
// 这时拒绝可压缩范围之外的图；单图上限很小（甚至配成"不限"）的模型不受这条内存约束，
// 压缩目标仍由模型自己声明，不能因为 32 MB 硬顶新增拒绝。
func textModelImageRejectable(limit int64) bool {
	return limit > textModelImageCompressionMaxInput/2
}

// compressTextModelImageDataURL 按模型上限处理一份内联图片：没超过原样返回，超过才压缩。
// 非 image/ 或非 base64 的内联数据原样返回，交给调用方原有的校验。
func compressTextModelImageDataURL(value string, limit int64) string {
	if limit <= 0 {
		return value
	}
	mime, payload, ok := splitCreationDataURL(value)
	if !ok {
		return value
	}
	// base64 长度是字节数的 4/3，先按长度排除明显没超限的图，省掉一次解码。
	if int64(len(payload)/4*3) <= limit {
		return value
	}
	data, err := base64.StdEncoding.DecodeString(payload)
	if err != nil || int64(len(data)) <= limit {
		return value
	}
	compressed := compressImageForTextModel(data, mime, limit)
	if !compressed.Compressed {
		return value
	}
	return dataURL(compressed.MIME, compressed.Data)
}

// textModelImage 是一张准备发给文本模型的图片（可能是压缩后的副本）。
type textModelImage struct {
	Data       []byte
	MIME       string
	Width      int
	Height     int
	Compressed bool
}

// compressImageForTextModel 返回可发给文本模型的图片副本。
// limit 是渠道模型声明的单张图片上限（字节）；0 或负数表示未声明上限，原样返回。
// 未超限、或解码器认不出的编码（HEIC/TIFF 等）同样原样返回，
// 后者交给调用方原有的上限判断决定这次请求是否成立。
func compressImageForTextModel(data []byte, mimeType string, limit int64) textModelImage {
	unchanged := textModelImage{Data: data, MIME: mimeType}
	if limit <= 0 || int64(len(data)) <= limit {
		return unchanged
	}
	source, _, err := image.Decode(bytes.NewReader(data))
	if err != nil {
		return unchanged
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if width <= 0 || height <= 0 {
		return unchanged
	}
	alpha := !imageIsOpaque(source)
	edge := min(textModelImageMaxEdge, max(width, height))
	var best textModelImage
	for {
		frame, frameWidth, frameHeight := scaleTextModelImage(source, edge)
		if alpha {
			if encoded := encodeTextModelPNG(frame); encoded != nil {
				candidate := textModelImage{Data: encoded, MIME: "image/png", Width: frameWidth, Height: frameHeight, Compressed: true}
				if int64(len(encoded)) <= limit {
					return candidate
				}
				best = smallerTextModelImage(best, candidate)
			}
		}
		canvas := frame
		if alpha {
			canvas = flattenTextModelImage(frame)
		}
		encoded, fits := fitTextModelJPEG(canvas, limit)
		if encoded != nil {
			candidate := textModelImage{Data: encoded, MIME: "image/jpeg", Width: frameWidth, Height: frameHeight, Compressed: true}
			if fits {
				return candidate
			}
			best = smallerTextModelImage(best, candidate)
		}
		if edge <= textModelImageMinEdge {
			break
		}
		edge = max(textModelImageMinEdge, edge*3/4)
	}
	// 压不到上限内就保持原字节：调用方原有的模型上限判断继续负责拒绝，不引入新的拒绝理由。
	if !best.Compressed || len(best.Data) >= len(data) {
		return unchanged
	}
	return best
}

// fitTextModelJPEG 在一个尺寸档上找"能塞进上限的最高质量"。
//
// 先用 q80 探一次：命中就直接用（常见情况只有这一次编码，比固定档位从高往低试更快，
// 也不会像"首个可行即停"那样在 1 MB 预算下只发 122 KB）。
// 没命中就按实测比例解析式估出目标质量，最多再校验两次；到质量地板还不行就返回最小结果，
// 由调用方缩一档尺寸继续。
func fitTextModelJPEG(source image.Image, limit int64) ([]byte, bool) {
	quality := textModelImageQualityProbe
	encoded := encodeTextModelJPEG(source, quality)
	if encoded == nil {
		return nil, false
	}
	if int64(len(encoded)) <= limit {
		return encoded, true
	}
	best := encoded
	for attempt := 0; attempt < 2; attempt++ {
		next := estimateTextModelQuality(quality, int64(len(encoded)), limit)
		if next >= quality {
			break
		}
		quality = next
		encoded = encodeTextModelJPEG(source, quality)
		if encoded == nil {
			break
		}
		if int64(len(encoded)) <= limit {
			return encoded, true
		}
		if len(encoded) < len(best) {
			best = encoded
		}
	}
	return best, false
}

// estimateTextModelQuality 用"每降一档质量约乘以 stepRatio"估算目标质量。
func estimateTextModelQuality(current int, currentBytes, limit int64) int {
	if currentBytes <= limit || limit <= 0 {
		return current
	}
	steps := int(math.Ceil(math.Log(float64(currentBytes)/float64(limit)) / math.Log(1/textModelImageQualityStepRatio)))
	next := current - max(1, steps)
	if next < textModelImageQualityFloor {
		next = textModelImageQualityFloor
	}
	if next >= current {
		next = current - 1
	}
	return next
}

func smallerTextModelImage(current, candidate textModelImage) textModelImage {
	if !candidate.Compressed {
		return current
	}
	if !current.Compressed || len(candidate.Data) < len(current.Data) {
		return candidate
	}
	return current
}

// scaleTextModelImage 把图片等比缩到最长边不超过 edge；本来就够小时返回原图。
func scaleTextModelImage(source image.Image, edge int) (image.Image, int, int) {
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	longest := max(width, height)
	if longest <= edge || longest <= 0 {
		return source, width, height
	}
	scale := float64(edge) / float64(longest)
	targetWidth := max(1, int(math.Round(float64(width)*scale)))
	targetHeight := max(1, int(math.Round(float64(height)*scale)))
	target := image.NewNRGBA(image.Rect(0, 0, targetWidth, targetHeight))
	draw.CatmullRom.Scale(target, target.Bounds(), source, bounds, draw.Src, nil)
	return target, targetWidth, targetHeight
}

// flattenTextModelImage 把透明像素铺到白底：JPEG 没有透明通道，直接编码会把
// 透明区域涂黑，识图时看起来像画面里的黑色块。
func flattenTextModelImage(source image.Image) image.Image {
	bounds := source.Bounds()
	target := image.NewNRGBA(image.Rect(0, 0, bounds.Dx(), bounds.Dy()))
	draw.Draw(target, target.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.Draw(target, target.Bounds(), source, bounds.Min, draw.Over)
	return target
}

func encodeTextModelPNG(source image.Image) []byte {
	var buffer bytes.Buffer
	if err := png.Encode(&buffer, source); err != nil {
		return nil
	}
	return buffer.Bytes()
}

func encodeTextModelJPEG(source image.Image, quality int) []byte {
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, source, &jpeg.Options{Quality: quality}); err != nil {
		return nil
	}
	return buffer.Bytes()
}

// imageIsOpaque 判断图片有没有透明像素。标准库与 x/image 解出的图型都自带 Opaque，
// 逐像素回退只在未知图型上发生。
func imageIsOpaque(source image.Image) bool {
	if opaque, ok := source.(interface{ Opaque() bool }); ok {
		return opaque.Opaque()
	}
	bounds := source.Bounds()
	for y := bounds.Min.Y; y < bounds.Max.Y; y++ {
		for x := bounds.Min.X; x < bounds.Max.X; x++ {
			if _, _, _, alpha := source.At(x, y).RGBA(); alpha < 0xffff {
				return false
			}
		}
	}
	return true
}
