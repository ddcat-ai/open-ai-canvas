package app

import (
	"archive/zip"
	"bytes"
	"encoding/json"
	"strings"
	"testing"
)

func TestEcommerceCreativeParametersPersistAndValidate(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	project, err := svc.CreateEcommerceProject("user")
	if err != nil {
		t.Fatal(err)
	}
	opts := &EcommerceCreativeOptions{TextMode: "rich", CopyTone: "professional", FontStyle: "geometric", ColorRhythm: "alternating", InformationDensity: "detailed", LayoutStyle: "feature-cards"}
	draft := EcommerceDraft{Platform: "taobao", ImageType: "detail", Count: 3, CreativeOptions: opts}
	saved, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: project.Revision, Draft: draft})
	if err != nil {
		t.Fatal(err)
	}
	loaded, err := svc.EcommerceProject("user", saved.ID)
	if err != nil {
		t.Fatal(err)
	}
	var restored EcommerceDraft
	if err := json.Unmarshal([]byte(loaded.DraftJSON), &restored); err != nil {
		t.Fatal(err)
	}
	if restored.CreativeOptions == nil || *restored.CreativeOptions != *opts {
		t.Fatalf("creative choices lost after save/reload: %#v", restored.CreativeOptions)
	}
	opts.FontStyle = "<script>arbitrary instruction</script>"
	if _, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft}); err == nil {
		t.Fatal("invalid font accepted")
	}
	draft.CreativeOptions = nil
	if _, err := svc.SaveEcommerceProject("user", project.ID, SaveEcommerceProjectRequest{Revision: saved.Revision, Draft: draft}); err != nil {
		t.Fatalf("legacy draft rejected: %v", err)
	}
}

func TestEcommerceUploadedSkillReadsReferencedMethods(t *testing.T) {
	svc, _, _, _ := ecommerceCreationTestService(t)
	var data bytes.Buffer
	archive := zip.NewWriter(&data)
	for name, body := range map[string]string{
		"SKILL.md":           "# 商品策划\n先读 [文案方法](references/copy.md#copy)。输出 `analysis.md`。外链 [样例](https://example.com/private.md) 不是包内文件。`scripts/run.py` 不执行。",
		"references/copy.md": "标题写具体场景。继续读 `../tone.md`。",
		"tone.md":            "每屏需要标题、场景说明与真实细节。回到 [入口](SKILL.md)。",
		"unused.md":          "此文档未被引用，不应进入上下文。",
		"scripts/run.py":     "do not execute",
	} {
		entry, err := archive.Create(name)
		if err != nil {
			t.Fatal(err)
		}
		if _, err := entry.Write([]byte(body)); err != nil {
			t.Fatal(err)
		}
	}
	if err := archive.Close(); err != nil {
		t.Fatal(err)
	}
	skill, err := svc.InstallSkillUpload("user", "zip", multipartFileHeader(t, "commerce.zip", "application/zip", data.Bytes()), SkillInstallRequest{Name: "商业文案", Tag: "others", IsPrivate: true})
	if err != nil {
		t.Fatal(err)
	}
	prompt, err := svc.EcommerceSkillPrompt("user", []string{skill.SkillID})
	if err != nil {
		t.Fatal(err)
	}
	for _, expected := range []string{"文件 SKILL.md", "文件 references/copy.md", "每屏需要标题、场景说明与真实细节"} {
		if !strings.Contains(prompt, expected) {
			t.Fatalf("missing %q in %q", expected, prompt)
		}
	}
	if strings.Contains(prompt, "此文档未被引用") || strings.Contains(prompt, "do not execute") {
		t.Fatal("unreferenced file/code entered context")
	}
	if _, err := svc.EcommerceSkillPrompt("other", []string{skill.SkillID}); err == nil {
		t.Fatal("private uploaded skill crossed owner boundary")
	}
}

func TestEcommerceSkillReferencesStayInPackage(t *testing.T) {
	got := ecommerceSkillReferences("refs/copy.md", "[escape](../../secret.md) [external](https://example.com/a.md) [absolute](/tmp/a.md) [local](../tone.md#voice) `script.py` `detail.txt` 输出 `analysis.md`", map[string]bool{"refs/detail.txt": true})
	if strings.Join(got, ",") != "tone.md,refs/detail.txt" {
		t.Fatalf("unexpected references: %v", got)
	}
}
