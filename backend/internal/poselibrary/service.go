// Package poselibrary 维护站点级姿势参考图库。
//
// 数据边界：
//   - 姿势元数据由管理员导入（ai-pose-gallery-zh 的 data/pose-zh.json，或影策通用格式），
//     代码仓库和发布镜像不携带任何姿势图片。
//   - 图片由管理员触发同步，从导入时填写的来源地址下载到数据目录 pose-library/<条目ID>/，
//     之后浏览、预览和选用只读本站文件，不再访问来源站点。
//   - 用户选用时由 app 层把原图复制成该用户自己的资源，生成任务继续按资源归属校验。
package poselibrary

import (
	"net/http"
	"time"

	"yingce/backend/internal/model"
	"yingce/backend/internal/outbound"
	"yingce/backend/internal/repository"
)

const (
	// SourceAIPoseGalleryZH 是 anhao/ai-pose-gallery-zh 原始 JSON 导入后的来源键。
	SourceAIPoseGalleryZH = "ai-pose-gallery-zh"
	// SourceCustom 是管理员在后台逐张上传的自建姿势。
	SourceCustom = "custom"
	// PackFormat 是影策通用姿势包格式标识，供以后接入其他姿势来源。
	PackFormat = "yingce-pose-library"

	// MaxImportBytes 是导入 JSON 的大小上限；ai-pose-gallery-zh 的 pose-zh.json 约 0.6 MB。
	MaxImportBytes int64 = 16 << 20
	// MaxImageBytes 是单张原图上限（同步下载与后台上传共用）。
	MaxImageBytes int64 = 20 << 20
	// MaxUseItems 是一次插入画布的姿势图数量上限。
	MaxUseItems = 16

	maxThumbBytes   int64 = 4 << 20
	maxImportItems        = 20000
	maxImageEdge          = 8192
	maxImagePixels        = 40 << 20
	thumbEdge             = 480
	defaultSyncSize       = 12
	maxSyncSize           = 40
	syncWorkers           = 4
	// 单次同步请求的时间预算：超过后不再领取新条目，管理页继续发起下一批。
	syncBudget          = 40 * time.Second
	syncDownloadTimeout = 30 * time.Second
	defaultPageSize     = 24
	maxPageSize         = 60
)

// AdminGate 由 app 注入：管理员校验与审计写入。
type AdminGate interface {
	RequireAdmin(*model.User) error
	AppendAudit(actor *model.User, action, targetType, targetID, summary string, metadata any) error
}

type Service struct {
	repo    *repository.Repository
	dataDir string
	admin   AdminGate
	client  *http.Client
}

func New(repo *repository.Repository, dataDir string, admin AdminGate) *Service {
	return &Service{repo: repo, dataDir: dataDir, admin: admin, client: outbound.OutboundHTTPClient(syncDownloadTimeout)}
}

// angleOrder 是卡片内视角切换的固定顺序；不在列表里的自定义视角排在后面。
var angleOrder = []string{"正面", "斜侧", "侧面", "背面", "俯视", "仰视"}

var angleAliases = map[string]string{
	"front": "正面", "正面": "正面",
	"diag": "斜侧", "diagonal": "斜侧", "three-quarter": "斜侧", "斜侧": "斜侧", "斜前": "斜侧",
	"side": "侧面", "profile": "侧面", "侧面": "侧面",
	"back": "背面", "rear": "背面", "背面": "背面",
	"high": "俯视", "top": "俯视", "俯视": "俯视",
	"low": "仰视", "bottom": "仰视", "仰视": "仰视",
}

func angleRank(angle string) int {
	for index, value := range angleOrder {
		if value == angle {
			return index
		}
	}
	return len(angleOrder)
}
