#!/usr/bin/env python3
import json
import os
from pathlib import Path
import runpy
import stat
import subprocess
import sys
import tempfile
import unittest

SCRIPT = Path(__file__).resolve().parents[1] / "integration/configure-provider.py"
module = runpy.run_path(str(SCRIPT))


class CredentialStorage(unittest.TestCase):
    def test_initialization_and_private_storage_do_not_publish_key(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp) / "private keys"
            module["initialize"](root)
            self.assertFalse(any(item["stored"] for item in module["status"](root)))
            self.assertEqual(stat.S_IMODE(root.stat().st_mode), 0o700)
            key = "test-only-provider-credential"
            path = module["save_key"](root, "groq", key)
            self.assertEqual(stat.S_IMODE(path.stat().st_mode), 0o600)
            self.assertNotIn(key, (root / "providers.env").read_text())
            result = subprocess.run([sys.executable, str(SCRIPT), "--directory", str(root), "--status"], capture_output=True, text=True, check=True)
            self.assertNotIn(key, result.stdout + result.stderr)
            status = json.loads(result.stdout)
            self.assertTrue(status[0]["stored"])
            self.assertEqual(status[0]["liveValidation"], "not_verified")
            with self.assertRaises(ValueError):
                module["save_key"](root, "groq", "replacement")
            self.assertEqual(path.read_text().strip(), key)
            module["save_key"](root, "groq", "replacement", replace=True)
            self.assertEqual(path.read_text().strip(), "replacement")

    def test_rejects_symlinks_empty_input_and_echoing_non_tty_input(self):
        with tempfile.TemporaryDirectory() as temp:
            root = module["initialize"](Path(temp) / "private")
            target = Path(temp) / "untouched"
            target.write_text("original")
            (root / "zai.key").symlink_to(target)
            with self.assertRaises(ValueError):
                module["save_key"](root, "zai", "test-only", replace=True)
            self.assertEqual(target.read_text(), "original")
            for value in ["", "\n", "two lines", "test\nsecond"]:
                with self.assertRaises(ValueError):
                    module["save_key"](root, "groq", value)
            result = subprocess.run([sys.executable, str(SCRIPT), "groq", "--directory", str(root)], input="test-only-key", capture_output=True, text=True)
            self.assertNotEqual(result.returncode, 0)
            self.assertNotIn("test-only-key", result.stdout + result.stderr)
            self.assertFalse((root / "groq.key").exists())


if __name__ == "__main__":
    unittest.main()
