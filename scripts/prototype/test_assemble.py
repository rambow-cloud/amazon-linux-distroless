"""Behavior checks for trust boundaries and rootfs selection, run in Actions."""
import copy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch
from assemble import Assembler, download_url, fetch, inspect_tree, license_paths, read_lock, rooted_path


class AssemblyTests(unittest.TestCase):
    def test_literal_plus_in_rpm_url_is_encoded_without_double_encoding(self):
        expected = "https://cdn.amazonlinux.com/al2023/blobstore/hash/libstdc%2B%2B.rpm"
        self.assertEqual(download_url("https://cdn.amazonlinux.com/al2023/blobstore/hash/libstdc++.rpm"), expected)
        self.assertEqual(download_url(expected), expected)

    def test_rpm_license_rows_allow_empty_flags_and_stripped_final_field(self):
        self.assertEqual(list(license_paths("/COPYING\tl\n/file\t\n/last-unflagged")), ["/COPYING"])

    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        self.source = self.root / "source"
        self.source.mkdir()

    def test_absolute_symlink_resolves_inside_install_root(self):
        (self.source / "usr/lib64").mkdir(parents=True)
        (self.source / "usr/lib64/libtest.so").write_bytes(b"runtime")
        (self.source / "lib64").symlink_to("/usr/lib64")
        self.assertEqual(rooted_path(self.source, "/lib64/libtest.so"),
                         self.source / "usr/lib64/libtest.so")
        image = Assembler(self.source, self.root / "selected")
        image.copy("/lib64/libtest.so")
        self.assertEqual((image.root / "usr/lib64/libtest.so").read_bytes(), b"runtime")
        self.assertFalse((image.root / "bin").exists())

    def test_excess_parent_segments_cannot_leave_virtual_root(self):
        (self.source / "etc").mkdir()
        (self.source / "etc/shadow").write_text("inside the disposable root")
        (self.source / "escape").symlink_to("/../../etc/shadow")
        resolved = rooted_path(self.source, "/escape")
        self.assertEqual(resolved, self.source / "etc/shadow")
        self.assertEqual(resolved.read_text(), "inside the disposable root")

    def test_symlink_cycle_is_rejected(self):
        (self.source / "a").symlink_to("b")
        (self.source / "b").symlink_to("a")
        with self.assertRaisesRegex(ValueError, "cycle"):
            rooted_path(self.source, "/a")

    def test_dangling_link_fails_final_audit(self):
        (self.source / "missing").symlink_to("/not-there")
        with self.assertRaisesRegex(ValueError, "Dangling"):
            inspect_tree(self.source)

    def test_forbidden_tool_symlink_fails_final_audit(self):
        (self.source / "runtime").write_text("runtime")
        (self.source / "sh").symlink_to("runtime")
        with self.assertRaisesRegex(ValueError, "Forbidden"):
            inspect_tree(self.source)

    def test_setuid_is_removed_on_copy_and_rejected_by_audit(self):
        binary = self.source / "runtime"
        binary.write_text("runtime")
        binary.chmod(0o4755)
        image = Assembler(self.source, self.root / "selected")
        image.copy("/runtime")
        self.assertEqual((image.root / "runtime").stat().st_mode & 0o7777, 0o755)
        with self.assertRaisesRegex(ValueError, "Setuid"):
            inspect_tree(self.source)

    def test_tampered_cached_rpm_is_rejected_without_network(self):
        cached = self.root / "cache"
        cached.mkdir()
        package = {"filename": "example.rpm", "sha256": "0" * 64}
        (cached / package["filename"]).write_bytes(b"modified")
        lock = {"tool_packages": ["example"], "variants": {"base": {"packages": [package]}}}
        with patch("assemble.run", return_value="example"), patch("assemble.subprocess.run"), \
                patch("assemble.urllib.request.urlopen", side_effect=AssertionError("unexpected network")):
            with self.assertRaisesRegex(RuntimeError, "checksum mismatch"):
                fetch(lock, cached)

    def test_lock_rejects_floating_builder_wrong_arch_untrusted_url_and_missing_source(self):
        original = json.loads(Path("/workspace/locks/linux-amd64.json").read_text())
        for mutation in ("builder", "arch", "url", "sources"):
            lock = copy.deepcopy(original)
            if mutation == "builder":
                lock["builder"] = "public.ecr.aws/amazonlinux/amazonlinux:2023"
            elif mutation == "arch":
                lock["variants"]["java"]["packages"][0]["arch"] = "aarch64"
            elif mutation == "url":
                lock["variants"]["java"]["packages"][0]["url"] = "https://example.invalid/package.rpm"
            else:
                lock["sources"] = []
            candidate = self.root / "lock.json"
            candidate.write_text(json.dumps(lock))
            with self.subTest(mutation=mutation), self.assertRaises(ValueError):
                read_lock(candidate)


if __name__ == "__main__":
    unittest.main()
