package ecommercecatalog

import "testing"

func TestCompleteHierarchyHasBilingualPathsAndAnApplicableMethod(t *testing.T) {
	meta := Metadata()
	all := All()
	if meta.Nodes != 64292 || len(all) != meta.Nodes || meta.Roots != 26 || meta.Leaves != 50427 {
		t.Fatalf("incomplete catalog: %+v", meta)
	}
	roots, leaves := 0, 0
	for _, node := range all {
		if node.Name == "" || node.NameEn == "" || node.Path == "" || node.PathEn == "" {
			t.Fatal("translation/path missing", node.ID)
		}
		if node.ParentID == "" {
			roots++
		} else if p, ok := Lookup(node.ParentID); !ok || p.Depth+1 != node.Depth || p.RootID != node.RootID {
			t.Fatal("broken ancestry", node.ID)
		}
		if node.Children == 0 {
			leaves++
		}
		m := Method(node)
		if m.Playbook.ID == "" || m.Playbook.Scene == "" || m.Playbook.Focus == "" || m.Playbook.Typography == "" || m.Playbook.Story == "" {
			t.Fatal("unrouted category", node.ID)
		}
	}
	if roots != 26 || leaves != 50427 || len(LevelTwo()) != 220 {
		t.Fatal("hierarchy counts drifted", roots, leaves)
	}
}

func TestProductMatchingDistinguishesIndustriesAndSubcategories(t *testing.T) {
	for _, tc := range []struct{ name, root, group string }{
		{"白色智能马桶", "ha", "bathroom"}, {"玻璃精华液", "hb", "beauty"}, {"清透洗面奶", "hb", "beauty"},
		{"智能家电", "hg", "appliance"}, {"智能扫地机器人", "hg", "appliance"},
		{"便携榨汁机", "hg", "appliance"}, {"实验室搅拌机", "bi", "industrial"}, {"混凝土搅拌机", "bi", "industrial"}, {"面包", "fb", "food"}, {"宠物牙刷", "ap", "pet"}, {"牙刷", "hb", "health"}, {"轮胎", "vp", "automotive"}, {"软件", "so", "software"}, {"汽车维修服务", "se", "service"}, {"办公文具", "os", "office"}, {"连衣裙", "aa", "apparel"},
	} {
		m := Resolve(tc.name)
		if m.Node.RootID != tc.root || m.Group != tc.group {
			t.Errorf("%s routed to %s/%s (%s)", tc.name, m.Node.RootID, m.Group, m.Node.Path)
		}
	}
	for alias, id := range aliases {
		if _, ok := Lookup(id); !ok {
			t.Errorf("alias %s points at missing %s", alias, id)
		}
	}
	unknown := Resolve("unmatched-xyz-000")
	if unknown.Confidence != "unclassified" {
		t.Fatal("unknown product forced into a category", unknown)
	}
}
