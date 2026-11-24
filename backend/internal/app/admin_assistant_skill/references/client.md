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

`execute` prints a structured result including invocation ID and status. A successful HTTP response may still report a pending confirmation, failed operation, or unknown result. The command exits nonzero for a failed, rejected, expired or unknown invocation. Use the original key to retrieve a write's recorded result. File arguments use attachment IDs instead of local paths or URLs. Attachments expire after one hour; maximum individual size is 32 MiB.

Skill packages are public static resources and contain no account credentials. `update` checks API compatibility, archive size, SHA256 and paths, then replaces only files listed in the release. It rejects symbolic links and preserves other local files.
