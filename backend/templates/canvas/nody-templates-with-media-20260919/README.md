# Nody Public Template Data With Media

- Templates: 16
- Unique media URLs: 433
- Downloaded media files: 433
- Failed media files: 0
- Downloaded bytes: 463342813

## Directory layout

- `previews/{template-id}/preview.json`: original public preview graph
- `previews/{template-id}/detail.json`: original template metadata
- `previews/{template-id}/offline-preview.json`: graph with downloaded URLs replaced by local paths
- `previews/{template-id}/offline-detail.json`: metadata with downloaded URLs replaced by local paths
- `assets/{template-id}/`: cover images, image previews and video previews
- `metadata/media-manifest.json`: URL-to-local-file mapping and download status

The protected `/api/templates/{id}/download` endpoint was not bypassed. This package contains public preview template data and the public media files referenced by those previews.

The single 116 MB MP4 is stored as `.part-000` and `.part-001` files because GitHub rejects individual files over 100 MB. The importer recombines numbered parts automatically when `--package-dir` is used.
