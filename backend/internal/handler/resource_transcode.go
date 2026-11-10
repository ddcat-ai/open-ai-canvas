package handler

import (
	"bytes"
	"image"
	"image/color"
	"image/draw"
	"image/jpeg"
	"io"
	"net/http"

	"github.com/gin-gonic/gin"

	// 资源可能以 PNG/WebP 存储；注册解码器供 image.Decode 使用。
	_ "image/png"
)

// convertibleSourceSize 限制转码读取的原件大小，与电商导出的字节中转上限保持一致。
const convertibleSourceSize = int64(32 * 1024 * 1024)

// imageTranscodeEligible 判断原件是否值得转码：仅 PNG/WebP 位图、大小在限制内。
func imageTranscodeEligible(mimeType string, size int64, targetFormat string) bool {
	if size <= 0 || size > convertibleSourceSize {
		return false
	}
	if targetFormat != "jpeg" {
		// Go 标准库没有 WebP 编码器；webp 目标由前端在可读字节时自行转码。
		return false
	}
	return mimeType == "image/png" || mimeType == "image/webp"
}

// transcodeImageToJPEG 把 PNG/WebP 图片字节转码为 JPEG（透明像素铺白底）。
// 部分模型/渠道会忽略 output_format 参数仍返回 PNG，下载侧需要平台兜底兑现用户的选择。
func transcodeImageToJPEG(body io.Reader) ([]byte, error) {
	source, _, err := image.Decode(body)
	if err != nil {
		return nil, err
	}
	bounds := source.Bounds()
	// jpeg 没有透明通道，先铺白底再叠加原图，避免透明像素变成黑底。
	canvas := image.NewRGBA(bounds)
	draw.Draw(canvas, bounds, image.NewUniform(color.White), image.Point{}, draw.Src)
	draw.Draw(canvas, bounds, source, bounds.Min, draw.Over)
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, canvas, &jpeg.Options{Quality: 92}); err != nil {
		return nil, err
	}
	return buffer.Bytes(), nil
}

// tryServeImageTranscoded 按目标格式转码并直接输出；转码不可行或失败时返回 false，
// 由调用方回落到原交付链路（CDN/origin 重定向或原格式流）。
func tryServeImageTranscoded(c *gin.Context, body io.Reader, mimeType string, size int64, targetFormat string) bool {
	if !imageTranscodeEligible(mimeType, size, targetFormat) {
		return false
	}
	converted, err := transcodeImageToJPEG(body)
	if err != nil {
		return false
	}
	c.Header("Cache-Control", "private, no-store")
	c.Header("X-Content-Type-Options", "nosniff")
	c.Data(http.StatusOK, "image/jpeg", converted)
	return true
}
