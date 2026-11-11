package model

// SiteTrafficEvent 与账号、请求日志隔离；只保存匿名摘要和服务端接收时刻，不保存任意客户端属性。
type SiteTrafficEvent struct {
	ID              string `gorm:"size:36;primaryKey"`
	VisitorHash     string `gorm:"size:64;not null"`
	SessionHash     string `gorm:"size:64;not null"`
	ReceivedAtEpoch int64  `gorm:"not null;index:idx_site_traffic_received_at;index:idx_site_traffic_type_received_at,priority:2"`
	Type            string `gorm:"size:16;not null;index:idx_site_traffic_type_received_at,priority:1"`
	Page            string `gorm:"size:32;not null"`
	Action          string `gorm:"size:40;not null"`
}
