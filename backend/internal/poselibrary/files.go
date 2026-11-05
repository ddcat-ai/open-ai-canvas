package poselibrary

import (
	"bytes"
	"errors"
	"fmt"
	"image"
	"image/color"
	"image/jpeg"
	_ "image/png"
	"net/http"
	"os"
	"path/filepath"
	"strings"

	"golang.org/x/image/draw"
	_ "golang.org/x/image/webp"

	"yingce/backend/internal/kernel"
)

const libraryDirName = "pose-library"

// storedImage 是一张通过校验、可以落盘的图片。
type storedImage struct {
	data   []byte
	mime   string
	width  int
	height int
}

// inspectImage 只接受 JPEG/PNG/WebP，并在解码像素前用头信息限制尺寸，防止超大图耗尽内存。
func inspectImage(data []byte) (storedImage, error) {
	if len(data) == 0 {
		return storedImage{}, kernel.BadAuthRequest("图片内容为空")
	}
	mimeType := http.DetectContentType(data)
	switch mimeType {
	case "image/jpeg", "image/png", "image/webp":
	default:
		return storedImage{}, kernel.BadAuthRequest("姿势图只支持 JPEG、PNG 或 WebP")
	}
	config, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return storedImage{}, kernel.BadAuthRequest("图片文件无法识别")
	}
	if config.Width <= 0 || config.Height <= 0 || config.Width > maxImageEdge || config.Height > maxImageEdge || config.Width*config.Height > maxImagePixels {
		return storedImage{}, kernel.BadAuthRequest(fmt.Sprintf("图片尺寸须在 %d×%d 以内", maxImageEdge, maxImageEdge))
	}
	return storedImage{data: data, mime: mimeType, width: config.Width, height: config.Height}, nil
}

// makeThumbnail 把原图等比缩到最长边 thumbEdge，透明区域铺白底后编码为 JPEG。
func makeThumbnail(original storedImage) (storedImage, error) {
	source, _, err := image.Decode(bytes.NewReader(original.data))
	if err != nil {
		return storedImage{}, kernel.BadAuthRequest("图片文件无法解码")
	}
	bounds := source.Bounds()
	width, height := bounds.Dx(), bounds.Dy()
	if longest := max(width, height); longest > thumbEdge {
		width = max(1, width*thumbEdge/longest)
		height = max(1, height*thumbEdge/longest)
	}
	target := image.NewRGBA(image.Rect(0, 0, width, height))
	draw.Draw(target, target.Bounds(), &image.Uniform{C: color.White}, image.Point{}, draw.Src)
	draw.CatmullRom.Scale(target, target.Bounds(), source, bounds, draw.Over, nil)
	var buffer bytes.Buffer
	if err := jpeg.Encode(&buffer, target, &jpeg.Options{Quality: 85}); err != nil {
		return storedImage{}, err
	}
	return storedImage{data: buffer.Bytes(), mime: "image/jpeg", width: width, height: height}, nil
}

func imageExtension(mimeType string) string {
	switch mimeType {
	case "image/png":
		return ".png"
	case "image/webp":
		return ".webp"
	default:
		return ".jpg"
	}
}

func (s *Service) libraryRoot() string {
	return filepath.Join(s.dataDir, libraryDirName)
}

func validItemID(id string) bool {
	return id != "" && len(id) <= 64 && !strings.ContainsAny(id, `/\.:`)
}

// writeItemFile 先写临时文件再改名，读取方不会看到写了一半的图片。返回相对 pose-library/ 的路径。
func (s *Service) writeItemFile(itemID string, baseName string, image storedImage) (string, error) {
	if !validItemID(itemID) {
		return "", errors.New("姿势条目 ID 无效")
	}
	dir := filepath.Join(s.libraryRoot(), itemID)
	if err := os.MkdirAll(dir, 0o750); err != nil {
		return "", err
	}
	name := baseName + imageExtension(image.mime)
	temp, err := os.CreateTemp(dir, "."+baseName+"-*")
	if err != nil {
		return "", err
	}
	tempName := temp.Name()
	if _, err := temp.Write(image.data); err != nil {
		temp.Close()
		os.Remove(tempName)
		return "", err
	}
	if err := temp.Close(); err != nil {
		os.Remove(tempName)
		return "", err
	}
	if err := os.Rename(tempName, filepath.Join(dir, name)); err != nil {
		os.Remove(tempName)
		return "", err
	}
	// 同名不同扩展的旧文件（例如原图从 PNG 换成 WebP）不再被引用，顺手清掉。
	for _, ext := range []string{".jpg", ".png", ".webp"} {
		if ext != imageExtension(image.mime) {
			_ = os.Remove(filepath.Join(dir, baseName+ext))
		}
	}
	return itemID + "/" + name, nil
}

func (s *Service) openItemFile(relative string) (*os.File, os.FileInfo, error) {
	clean := filepath.ToSlash(filepath.Clean(relative))
	if relative == "" || clean != relative || strings.HasPrefix(clean, "/") || strings.HasPrefix(clean, "..") || strings.Count(clean, "/") != 1 {
		return nil, nil, kernel.NotFound("姿势图片不存在")
	}
	file, err := os.Open(filepath.Join(s.libraryRoot(), filepath.FromSlash(clean)))
	if err != nil {
		if errors.Is(err, os.ErrNotExist) {
			return nil, nil, kernel.NotFound("姿势图片文件缺失，请在后台重新同步")
		}
		return nil, nil, err
	}
	info, err := file.Stat()
	if err != nil {
		file.Close()
		return nil, nil, err
	}
	if !info.Mode().IsRegular() {
		file.Close()
		return nil, nil, kernel.NotFound("姿势图片不存在")
	}
	return file, info, nil
}

func (s *Service) removeItemFiles(itemID string) error {
	if !validItemID(itemID) {
		return nil
	}
	return os.RemoveAll(filepath.Join(s.libraryRoot(), itemID))
}
