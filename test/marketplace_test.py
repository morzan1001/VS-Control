import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
import warnings
import zipfile

spec = importlib.util.spec_from_file_location("marketplace", Path(__file__).resolve().parents[1] / "scripts/prepare-marketplace.py")
marketplace = importlib.util.module_from_spec(spec)
spec.loader.exec_module(marketplace)


class MarketplaceReleaseTests(unittest.TestCase):
    def setUp(self):
        self.directory = tempfile.TemporaryDirectory()
        self.addCleanup(self.directory.cleanup)
        self.file = Path(self.directory.name) / "vs-control-bridge-0.0.1.vsix"
        self.manifest = {"name": "vs-control-bridge", "publisher": "vs-control", "version": "0.0.1"}
        self.sources = {
            "extension/package.json": json.dumps(self.manifest).encode(),
            "extension/src/extension.cjs": b"'use strict';\n",
        }
        self.entries = {
            **self.sources,
            "extension.vsixmanifest": b'<PackageManifest><Metadata><Identity Id="vs-control-bridge" Publisher="vs-control" Version="0.0.1"/></Metadata></PackageManifest>',
            "[Content_Types].xml": b'<Types/>',
        }
        self.release = {
            "tagName": "0.0.1", "isDraft": False, "isPrerelease": False,
            "publishedAt": "2026-11-14T16:58:20Z",
            "assets": [{"name": self.file.name}, {"name": "SHA256SUMS-0.0.1.txt"}],
        }

    def write_archive(self):
        with zipfile.ZipFile(self.file, "w") as archive:
            for name, data in self.entries.items():
                archive.writestr(name, data)
        return self.checksum()

    def checksum(self):
        return f"{hashlib.sha256(self.file.read_bytes()).hexdigest()}  {self.file.name}\n"

    def verify(self, checksum):
        return marketplace.validate_vsix(self.file, checksum, "0.0.1", self.manifest, self.sources)

    def test_only_stable_numeric_tags_are_accepted(self):
        marketplace.validate_tag("0.0.1")
        marketplace.validate_tag("12.30.4")
        for tag in ["v0.0.1", "0.0.1-beta", "01.0.1", "../0.0.1", "0.0.1\n", "$(id)"]:
            with self.subTest(tag=tag), self.assertRaises(ValueError):
                marketplace.validate_tag(tag)

    def test_release_must_be_published_and_stable(self):
        marketplace.validate_release(self.release, "0.0.1", self.file.name)
        for change in [{"isDraft": True}, {"isPrerelease": True}, {"publishedAt": None}, {"tagName": "0.0.2"}]:
            with self.subTest(change=change), self.assertRaises(ValueError):
                marketplace.validate_release({**self.release, **change}, "0.0.1", self.file.name)

    def test_release_requires_exactly_one_of_each_asset(self):
        for assets in [self.release["assets"][:1], self.release["assets"] * 2]:
            with self.subTest(assets=assets), self.assertRaises(ValueError):
                marketplace.validate_release({**self.release, "assets": assets}, "0.0.1", self.file.name)

    def test_valid_package_returns_its_digest(self):
        checksum = self.write_archive()
        self.assertEqual(self.verify(checksum), checksum.split()[0])

    def test_missing_duplicate_or_mismatched_checksum_is_rejected(self):
        checksum = self.write_archive()
        for value in ["", checksum * 2, "0" * 64 + "  " + self.file.name]:
            with self.subTest(value=value), self.assertRaisesRegex(ValueError, "checksum"):
                self.verify(value)

    def test_replaced_code_is_rejected_even_with_updated_checksum(self):
        self.entries["extension/src/extension.cjs"] = b"modified code"
        with self.assertRaisesRegex(ValueError, "differs from the source tag"):
            self.verify(self.write_archive())

    def test_wrong_publisher_or_version_is_rejected(self):
        for source, replacement in [(b'Publisher="vs-control"', b'Publisher="another"'), (b'Version="0.0.1"', b'Version="0.0.2"')]:
            original = self.entries["extension.vsixmanifest"]
            self.entries["extension.vsixmanifest"] = original.replace(source, replacement)
            with self.subTest(replacement=replacement), self.assertRaisesRegex(ValueError, "identity"):
                self.verify(self.write_archive())
            self.entries["extension.vsixmanifest"] = original

    def test_unexpected_and_duplicate_archive_entries_are_rejected(self):
        self.entries["../extra.cjs"] = b"unexpected"
        with self.assertRaisesRegex(ValueError, "contents differ"):
            self.verify(self.write_archive())
        del self.entries["../extra.cjs"]
        self.write_archive()
        with warnings.catch_warnings():
            warnings.simplefilter("ignore", UserWarning)
            with zipfile.ZipFile(self.file, "a") as archive:
                archive.writestr("extension/package.json", self.sources["extension/package.json"])
        with self.assertRaisesRegex(ValueError, "contents differ"):
            self.verify(self.checksum())


if __name__ == "__main__":
    unittest.main()
