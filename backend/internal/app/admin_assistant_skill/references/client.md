# Client commands

All commands take `--site https://canvas.example.com` before the command. The URL can also be supplied as `CANVAS_ADMIN_URL`.

```sh
python scripts/canvas_admin.py --site https://canvas.example.com login
python scripts/canvas_admin.py --site https://canvas.example.com status
python scripts/canvas_admin.py --site https://canvas.example.com list --module channels --page 1
python scripts/canvas_admin.py --site https://canvas.example.com describe AdminSystemChannelPage
python scripts/canvas_admin.py --site https://canvas.example.com execute AdminSystemChannelPage --args-file request.json
python scripts/canvas_admin.py --site https://canvas.example.com upload plugin.zip
python scripts/canvas_admin.py --site https://canvas.example.com download ATTACHMENT_ID --output export.zip
python scripts/canvas_admin.py --site https://canvas.example.com logout
python scripts/canvas_admin.py --site https://canvas.example.com version
python scripts/canvas_admin.py --site https://canvas.example.com update
```

`login --scope channels:read --scope channels:write` requests explicit permissions. With no scope options, the server defaults to read access. Personal Tokens are created and revoked on `/admin/agent-access`. `token` reads one at a hidden prompt and verifies it before saving.

The client stores each site's credentials under `~/.config/canvas-admin/` (or the platform XDG config directory). On Windows it restricts the directory and file ACL to the current account. OAuth credentials refresh automatically, with refresh token rotation; do not copy a refresh token between simultaneously running clients.

`logout` removes local credentials. Revoke the Token or OAuth grant in Agent access to invalidate other copies. An environment Token is never written to disk by this client.

## Import network media for official assets

The `official-assets:write` scope allows `ImportOfficialAssetResourceURL`. Discover and describe it before use; older deployments may not expose it. Save arguments to a local JSON file, for example:

```json
{"req":{"url":"https://media.example.com/sample.jpg","uploadKey":"official-test-image-001"}}
```

```sh
python scripts/canvas_admin.py --site https://canvas.example.com describe ImportOfficialAssetResourceURL
python scripts/canvas_admin.py --site https://canvas.example.com execute ImportOfficialAssetResourceURL --args-file import.json --key official-test-import-001
```

If confirmation is pending, provide the administrator's webpage link and retry with the same arguments and key after approval. A successful execution returns `result.id`, the persistent Resource ID. Describe `CreateOfficialAsset` and pass this ID as `req.resourceId`, together with title, detected media type, category, source and license information. Creating an asset produces a draft; publishing is a separate operation. Never use a temporary attachment ID as `resourceId` or send Agent OAuth credentials to the ordinary browser upload API.

Only direct image, video and audio URLs are supported. The server checks actual media content, outbound destination and redirects, upload limits and storage quotas. Private destinations are denied unless explicitly allowed by the server's existing policy. Resource ownership is fixed to the authenticated administrator. Keep `uploadKey` stable for the same media; reuse with changed content is rejected. Do not use signed or credential-bearing URLs as public source metadata.

`execute` prints a structured result including invocation ID and status. A successful HTTP response may still report a pending confirmation, failed operation, or unknown result. The command exits nonzero for a failed, rejected, expired or unknown invocation. Use the original key to retrieve a write's recorded result. File arguments use attachment IDs instead of local paths or URLs. Attachments expire after one hour; maximum individual size is 32 MiB.

Skill packages are public static resources and contain no account credentials. `update` checks API compatibility, archive size, SHA256 and paths, then replaces only files listed in the release. It rejects symbolic links and preserves other local files.
