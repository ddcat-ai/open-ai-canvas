package protocol

import "testing"

func TestManifestAcceptsWorkbenchContribution(t *testing.T) {
	manifest := []byte(`{
        "apiVersion":"yingce.plugin/v1",
        "id":"workbench-extension",
        "name":"Workbench Extension",
        "version":"1.0.0",
        "contributes":{"workbench":[{"id":"workbench-extension-entry","label":"工作台入口","description":"打开一个工作区","icon":"sparkles","route":"/create","kind":"entry","group":"management"}]}
    }`)
	if _, err := LoadManifest(manifest); err != nil {
		t.Fatalf("workbench manifest was rejected: %v", err)
	}
}

func TestManifestRejectsExternalWorkbenchRoute(t *testing.T) {
	manifest := []byte(`{
        "apiVersion":"yingce.plugin/v1",
        "id":"unsafe-workbench",
        "name":"Unsafe Workbench",
        "version":"1.0.0",
        "contributes":{"workbench":[{"id":"unsafe-entry","label":"外部入口","route":"https://example.com"}]}
    }`)
	if _, err := LoadManifest(manifest); err == nil {
		t.Fatal("external workbench route was accepted")
	}
}
