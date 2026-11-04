// Package ecommercecatalog resolves a bilingual industry/category hierarchy.
package ecommercecatalog

import (
	"bytes"
	"compress/gzip"
	"embed"
	"encoding/json"
	"io"
	"sort"
	"strings"
	"sync"
	"unicode"
)

//go:embed data/*
var files embed.FS

type Node struct {
	ID          string `json:"id"`
	ParentID    string `json:"parentId"`
	RootID      string `json:"rootId"`
	Name        string `json:"name"`
	NameEn      string `json:"nameEn"`
	Path        string `json:"path"`
	PathEn      string `json:"pathEn"`
	Depth       int    `json:"depth"`
	Children    int    `json:"children"`
	Descendants int    `json:"descendants"`
}

type Source struct {
	Version string `json:"version"`
	Commit  string `json:"commit"`
	URL     string `json:"url"`
	License string `json:"license"`
	Nodes   int    `json:"nodes"`
	Roots   int    `json:"roots"`
	Leaves  int    `json:"leaves"`
	Level2  int    `json:"level2"`
}

type Match struct {
	Node             Node     `json:"node"`
	Confidence       string   `json:"confidence"`
	MethodAncestorID string   `json:"methodAncestorId"`
	MethodScope      string   `json:"methodScope"`
	Group            string   `json:"group"`
	Playbook         Playbook `json:"playbook"`
}

var once sync.Once
var nodes []Node
var byID map[string]int
var byTerm map[string][]string
var byPath map[string]string
var source Source

func normalize(s string) string {
	return strings.ToLower(strings.Join(strings.Fields(strings.TrimSpace(s)), " "))
}

func load() {
	once.Do(func() {
		raw, err := files.ReadFile("data/source.json")
		if err != nil {
			panic(err)
		}
		if err = json.Unmarshal(raw, &source); err != nil {
			panic(err)
		}
		raw, err = files.ReadFile("data/categories.json.gz")
		if err != nil {
			panic(err)
		}
		zip, err := gzip.NewReader(bytes.NewReader(raw))
		if err != nil {
			panic(err)
		}
		data, err := io.ReadAll(zip)
		_ = zip.Close()
		if err != nil {
			panic(err)
		}
		var rows [][4]string
		if err = json.Unmarshal(data, &rows); err != nil {
			panic(err)
		}
		byID = map[string]int{}
		byTerm = map[string][]string{}
		byPath = map[string]string{}
		for _, row := range rows {
			byID[row[0]] = len(nodes)
			nodes = append(nodes, Node{ID: row[0], ParentID: row[1], Name: row[2], NameEn: row[3]})
		}
		var complete func(int)
		complete = func(i int) {
			if nodes[i].Depth > 0 {
				return
			}
			n := &nodes[i]
			if n.ParentID == "" {
				n.Depth = 1
				n.RootID = n.ID
				n.Path = n.Name
				n.PathEn = n.NameEn
				return
			}
			p, ok := byID[n.ParentID]
			if !ok {
				panic("taxonomy parent missing")
			}
			complete(p)
			n.Depth = nodes[p].Depth + 1
			n.RootID = nodes[p].RootID
			n.Path = nodes[p].Path + " > " + n.Name
			n.PathEn = nodes[p].PathEn + " > " + n.NameEn
		}
		for i := range nodes {
			complete(i)
		}
		for i := range nodes {
			n := nodes[i]
			if n.ParentID != "" {
				nodes[byID[n.ParentID]].Children++
			}
			for _, label := range []string{n.Name, n.NameEn} {
				for _, term := range append([]string{label}, strings.FieldsFunc(label, func(r rune) bool { return r == '/' || r == '、' })...) {
					term = normalize(term)
					if len([]rune(term)) < 2 {
						continue
					}
					byTerm[term] = append(byTerm[term], n.ID)
					if strings.HasSuffix(term, "s") && !strings.HasSuffix(term, "ss") && len(term) > 4 {
						byTerm[strings.TrimSuffix(term, "s")] = append(byTerm[strings.TrimSuffix(term, "s")], n.ID)
					}
				}
			}
			byPath[normalize(n.Path)] = n.ID
			byPath[normalize(n.PathEn)] = n.ID
		}
		for _, n := range nodes {
			for id := n.ParentID; id != ""; id = nodes[byID[id]].ParentID {
				nodes[byID[id]].Descendants++
			}
		}
		for _, p := range RootPlaybooks {
			if _, ok := aliases[p.Group]; !ok {
				aliases[p.Group] = p.ID
			}
		}
	})
}

func Metadata() Source { load(); return source }
func LicenseText() string {
	raw, err := files.ReadFile("data/LICENSE.txt")
	if err != nil {
		panic(err)
	}
	return string(raw)
}
func All() []Node { load(); return append([]Node(nil), nodes...) }
func LevelTwo() []Node {
	load()
	var result []Node
	for _, node := range nodes {
		if node.Depth == 2 {
			result = append(result, node)
		}
	}
	return result
}
func Lookup(id string) (Node, bool) {
	load()
	i, ok := byID[id]
	if !ok {
		return Node{}, false
	}
	return nodes[i], true
}
func Lineage(id string) []Node {
	load()
	var result []Node
	for id != "" {
		n, ok := Lookup(id)
		if !ok {
			break
		}
		result = append(result, n)
		id = n.ParentID
	}
	return result
}

func Method(node Node) Match {
	p := RootPlaybooks[24]
	for _, root := range RootPlaybooks {
		if root.ID == node.RootID {
			p = root
			break
		}
	}
	ids := Lineage(node.ID)
	for _, n := range ids {
		found := false
		for _, family := range FamilyPlaybooks {
			if family.ID == n.ID {
				p = family
				found = true
				break
			}
		}
		if found {
			break
		}
	}
	scope := "inherited"
	if p.ID == node.ID {
		scope = "specific"
	}
	return Match{Node: node, MethodAncestorID: p.ID, MethodScope: scope, Group: p.Group, Playbook: p}
}

var aliases = map[string]string{
	"精华液": "hb-3-2-9-21", "精华": "hb-3-2-9-21", "洗面奶": "hb-3-2", "护肤": "hb-3-2",
	"马桶": "ha-10-3-6-2", "坐便器": "ha-10-3-6-2", "座便器": "ha-10-3-6-2", "toilet": "ha-10-3-6-2",
	"榨汁机": "hg-11-7-29", "果汁机": "hg-11-7-29", "破壁机": "hg-11-7-17-1", "搅拌机": "hg-11-7-17", "juicer": "hg-11-7-29", "blender": "hg-11-7-17-1",
	"耳机": "el-2-2-7-1", "headphone": "el-2-2-7-1", "奶瓶": "bt-10-16-6", "baby bottle": "bt-10-16-6", "连衣裙": "aa-1-4", "面包": "fb-2-1-3", "bread": "fb-2-1-3",
	"轮胎": "vp-1-4-20-3", "汽车配件": "vp-1", "狗粮": "ap-2-3-3", "猫粮": "ap-2-2-1", "牙刷": "hb-3-12-17", "沙发": "fr-22", "sofa": "fr-22", "咖啡": "fb-1-3",
	"电商商品": "na", "商品": "na", "general": "na", "taxonomy": "na", "办公": "os", "office": "os", "文具": "os-11", "五金": "ha", "hardware": "ha", "工业": "bi", "industrial": "bi", "服务": "se", "service": "se", "软件": "so", "software": "so",
	"母婴": "bt", "maternal": "bt", "baby": "bt", "母婴用品": "bt", "数码": "el", "数码产品": "el", "tech": "el", "食品": "fb", "food": "fb", "食品饮品": "fb",
	"美妆": "hb-3-2", "美妆个护": "hb-3-2", "beauty": "hb-3-2", "保健": "hb", "health": "hb", "家居": "hg", "home": "hg", "家电": "hg-9", "家居家电": "hg-9", "appliance": "hg-9",
	"服饰": "aa", "服饰鞋包": "aa", "apparel": "aa", "fashion": "aa", "宠物": "ap-2", "宠物用品": "ap-2", "pet": "ap-2", "运动户外": "sg", "运动": "sg", "sport": "sg", "户外": "sg-4",
	"珠宝": "aa-6", "jewelry": "aa-6", "手表": "aa-6-11", "watch": "aa-6-11", "园艺": "hg-12", "garden": "hg-12", "灯具": "hg-13", "灯": "hg-13", "lighting": "hg-13", "玩具": "tg-5", "toys": "tg-5", "家具": "fr", "furniture": "fr", "箱包": "lb", "luggage": "lb", "相机": "co-2", "camera": "co-2", "电脑": "el-6", "computer": "el-6", "笔记本电脑": "el-6-6",
}

func Resolve(text string) Match {
	load()
	text = normalize(text)
	if n, ok := Lookup(strings.TrimPrefix(text, "gid://shopify/taxonomycategory/")); ok {
		m := Method(n)
		m.Confidence = "explicit_id"
		return m
	}
	if id, ok := byPath[text]; ok {
		n, _ := Lookup(id)
		m := Method(n)
		m.Confidence = "exact_path"
		return m
	}
	if id, ok := aliases[text]; ok {
		n, _ := Lookup(id)
		m := Method(n)
		m.Confidence = "alias"
		return m
	}
	terms := map[string]bool{text: true}
	for _, chunk := range strings.FieldsFunc(text, func(r rune) bool { return !unicode.Is(unicode.Han, r) }) {
		runes := []rune(chunk)
		for start := range runes {
			for size := 2; size <= 24 && start+size <= len(runes); size++ {
				terms[string(runes[start:start+size])] = true
			}
		}
	}
	words := strings.FieldsFunc(text, func(r rune) bool { return !unicode.IsLetter(r) && !unicode.IsDigit(r) && r != '&' && r != '-' })
	for start := range words {
		for size := 1; size <= 8 && start+size <= len(words); size++ {
			terms[strings.Join(words[start:start+size], " ")] = true
		}
	}
	bestID := "na"
	bestScore := 0
	for term := range terms {
		ids := byTerm[term]
		if id, ok := aliases[term]; ok {
			ids = append(append([]string(nil), ids...), id)
		}
		for _, id := range ids {
			score := len([]rune(term)) * 20
			if term == text {
				score += 1000
			}
			if alias, ok := aliases[term]; ok && alias == id {
				score += 5
			}
			n, _ := Lookup(id)
			for root, signals := range map[string][]string{"ap": {"宠物", "猫", "狗", "犬"}, "bi": {"工业", "混凝土", "实验室"}, "vp": {"汽车", "车载", "车辆"}, "ha": {"五金"}, "so": {"软件", "云服务"}, "se": {"服务"}, "os": {"办公", "文具"}} {
				if n.RootID == root {
					for _, signal := range signals {
						if strings.Contains(text, signal) {
							score += 20
							break
						}
					}
				}
			}
			if n.RootID == "so" && strings.HasSuffix(text, "软件") {
				score += 60
			}
			if n.RootID == "se" && strings.HasSuffix(text, "服务") {
				score += 60
			}
			for _, ancestor := range Lineage(id) {
				if strings.Contains(text, normalize(ancestor.Name)) || strings.Contains(text, normalize(ancestor.NameEn)) {
					score += 5
				}
			}
			if score > bestScore || score == bestScore && id < bestID {
				bestScore, bestID = score, id
			}
		}
	}
	n, _ := Lookup(bestID)
	m := Method(n)
	m.Confidence = "name_match"
	if bestID == "na" {
		m.Confidence = "unclassified"
	}
	return m
}

func ResolveProduct(category, name string) Match {
	a, b := Resolve(category), Resolve(name)
	if a.Node.ID == "na" {
		return b
	}
	if b.Node.ID != "na" && b.Node.Depth > a.Node.Depth && (a.Node.RootID == b.Node.RootID || a.Node.Depth == 1) {
		return b
	}
	return a
}

func Browse(parent, query string, page, limit int) ([]Match, int) {
	load()
	query = normalize(query)
	parentNode, hasParent := Lookup(parent)
	var result []Match
	for _, n := range nodes {
		if query == "" && n.ParentID != parent {
			continue
		}
		if query != "" && (!strings.Contains(normalize(n.Path+" "+n.PathEn), query) && n.ID != query) {
			continue
		}
		if query != "" && parent != "" && (!hasParent || !strings.HasPrefix(n.PathEn, parentNode.PathEn+" > ")) {
			continue
		}
		result = append(result, Method(n))
	}
	sort.SliceStable(result, func(i, j int) bool {
		if result[i].Node.Depth != result[j].Node.Depth {
			return result[i].Node.Depth < result[j].Node.Depth
		}
		return result[i].Node.ID < result[j].Node.ID
	})
	total := len(result)
	if page < 1 {
		page = 1
	}
	if limit < 1 {
		limit = 50
	}
	if limit > 100 {
		limit = 100
	}
	if page-1 > total/limit {
		return []Match{}, total
	}
	start := (page - 1) * limit
	if start >= total {
		return []Match{}, total
	}
	end := start + limit
	if end > total {
		end = total
	}
	return result[start:end], total
}

func RoutingContext(m Match) string {
	return "【行业/品类/子品类路由】分类路径：" + m.Node.Path + "；英文：" + m.Node.PathEn + "；分类ID：" + m.Node.ID + "；匹配方式：" + m.Confidence + "；最近方法祖先：" + m.MethodAncestorID + "。分类是创作路由，不证明本商品规格。\n"
}

func Context(m Match) string {
	p := m.Playbook
	return RoutingContext(m) + "具体对象：" + m.Node.Name + "；场景候选：" + p.Scene + "；需要观察：" + p.Focus + "；字体：" + p.Typography + "；信息结构：" + p.Layout + "；叙事候选：" + p.Story + "。只展示与当前子品类和商品证据相符的动作、部件与场景；不得从父类方法推断本商品功能。\n"
}
