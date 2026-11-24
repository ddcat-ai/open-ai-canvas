"""Protocol and archive safety checks without third-party dependencies."""
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
import zipfile

spec = importlib.util.spec_from_file_location("canvas_admin", Path(__file__).resolve().parents[1] / "internal/app/admin_assistant_skill/scripts/canvas_admin.py")
client = importlib.util.module_from_spec(spec)
spec.loader.exec_module(client)


def package(extra=None):
    buffer = io.BytesIO()
    with zipfile.ZipFile(buffer, "w") as archive:
        archive.writestr("canvas-admin/SKILL.md", "skill")
        archive.writestr("canvas-admin/scripts/canvas_admin.py", "client")
        for path, value in (extra or {}).items():
            archive.writestr(path, value)
    data = buffer.getvalue()
    return data, {"apiVersion": 1, "size": len(data), "sha256": hashlib.sha256(data).hexdigest()}


class ClientTests(unittest.TestCase):
    def test_update_preserves_credentials_and_other_files(self):
        with tempfile.TemporaryDirectory() as folder:
            root = Path(folder)
            skill = root / "canvas-admin"
            skill.mkdir()
            local = skill / "local.txt"
            local.write_text("retain")
            credentials = root / "credentials.json"
            credentials.write_text("private")
            data, manifest = package()
            client.install_archive(data, manifest, skill)
            self.assertEqual((skill / "SKILL.md").read_text(), "skill")
            self.assertEqual(local.read_text(), "retain")
            self.assertEqual(credentials.read_text(), "private")

    def test_rejects_archive_paths_and_checksums(self):
        for name in ("canvas-admin/../../escape", "/tmp/escape", "canvas-admin/C:/escape", "canvas-admin/..\\escape"):
            with self.subTest(name=name), tempfile.TemporaryDirectory() as folder:
                data, manifest = package({name: "bad"})
                with self.assertRaises(RuntimeError):
                    client.install_archive(data, manifest, Path(folder) / "skill")
        data, manifest = package()
        manifest["sha256"] = "0" * 64
        with tempfile.TemporaryDirectory() as folder, self.assertRaises(RuntimeError):
            client.install_archive(data, manifest, folder)

    def test_credential_storage_is_separate_and_private(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"XDG_CONFIG_HOME": folder}):
            instance = client.Client("https://canvas.example.test")
            instance.save({"access_token": "test-only-value"})
            self.assertEqual(instance.load()["access_token"], "test-only-value")
            self.assertTrue(instance.config.is_relative_to(Path(folder)))
            if os.name != "nt":
                self.assertEqual(instance.config.stat().st_mode & 0o777, 0o600)

    def test_rejects_cross_origin_and_unsafe_site(self):
        instance = client.Client("https://canvas.example.test")
        with self.assertRaises(RuntimeError):
            instance.request("https://elsewhere.example/file", authenticated=False)
        for site in ("http://public.example", "https://user:pass@canvas.example", "https://canvas.example/path"):
            with self.assertRaises(ValueError):
                client.Client(site)

    def test_refresh_rotation_is_saved_without_disclosing_secrets(self):
        with tempfile.TemporaryDirectory() as folder, patch.dict(os.environ, {"XDG_CONFIG_HOME": folder}):
            instance = client.Client("https://canvas.example.test")
            instance.save({"access_token": "old", "refresh_token": "old-refresh", "client_id": "client", "expires_at": 0})
            with patch.dict(os.environ, {}, clear=True), patch.object(instance, "request", return_value={"access_token": "new", "refresh_token": "new-refresh", "expires_in": 3600}):
                self.assertEqual(instance.access_token(), "new")
            self.assertEqual(instance.load()["refresh_token"], "new-refresh")


if __name__ == "__main__":
    unittest.main()
