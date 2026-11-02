package production

// LookRange 是一套造型默认适用的原著章节（从 1 起，0 表示该端不限）；两端都为 0 表示不按章节默认，只在剧情需要时选用。
type LookRange struct {
	ID   string
	From int
	To   int
}

// covers 判断造型的默认章节范围是否包含第 chapter 章。
func (l LookRange) covers(chapter int) bool {
	if l.From <= 0 && l.To <= 0 {
		return false
	}
	return (l.From <= 0 || chapter >= l.From) && (l.To <= 0 || chapter <= l.To)
}

// DefaultLook 按本集的原著章节选默认造型：取范围包含本集第一章的造型；有多套命中时取起始章节最晚的（最近一次换装），
// 再取范围更窄的。没有命中返回空串，表示用角色本身的基础造型。chapters 是本集章节序号（从 1 起）。
func DefaultLook(looks []LookRange, chapters []int) string {
	first := 0
	for _, chapter := range chapters {
		if chapter > 0 && (first == 0 || chapter < first) {
			first = chapter
		}
	}
	if first == 0 {
		return ""
	}
	best := -1
	for i, look := range looks {
		if !look.covers(first) {
			continue
		}
		if best < 0 || look.From > looks[best].From || (look.From == looks[best].From && lookSpan(look) < lookSpan(looks[best])) {
			best = i
		}
	}
	if best < 0 {
		return ""
	}
	return looks[best].ID
}

// lookSpan 是范围长度，开放的一端按很大处理，用于在起点相同的造型里优先范围更窄的。
func lookSpan(look LookRange) int {
	if look.To <= 0 {
		return 1 << 30
	}
	return look.To - max(look.From, 1)
}
