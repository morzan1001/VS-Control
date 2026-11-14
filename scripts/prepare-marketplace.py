#!/usr/bin/env python3
"""Download and verify a published VSIX without executing release contents."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import re
import subprocess
import tempfile
import xml.etree.ElementTree as ET
import zipfile

ROOT = Path(__file__).resolve().parent.parent
VERSION = re.compile(r"(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)")


def validate_tag(tag):
    if not VERSION.fullmatch(tag):
        raise ValueError("Use a stable major.minor.patch tag without a v prefix.")


def validate_release(release, tag, filename):
    if release.get("tagName") != tag or release.get("isDraft") or release.get("isPrerelease") or not release.get("publishedAt"):
        raise ValueError("Only published, stable GitHub releases can be sent to the Marketplace.")
    names = [asset["name"] for asset in release["assets"]]
    for required in [filename, f"SHA256SUMS-{tag}.txt"]:
        if names.count(required) != 1:
            raise ValueError(f"Release must contain exactly one {required}.")


def validate_vsix(file, checksums, tag, manifest, source_files):
    validate_tag(tag)
    filename = f"{manifest['name']}-{tag}.vsix"
    if file.name != filename or manifest["version"] != tag:
        raise ValueError("Release tag, source version, and VSIX filename must match.")
    digest = hashlib.sha256(file.read_bytes()).hexdigest()
    expected = [line for line in checksums.splitlines() if line.endswith("  " + filename)]
    if expected != [f"{digest}  {filename}"]:
        raise ValueError("Missing, duplicate, or mismatched VSIX checksum.")
    with zipfile.ZipFile(file) as archive:
        names = archive.namelist()
        required = set(source_files) | {"extension.vsixmanifest", "[Content_Types].xml"}
        if len(names) != len(set(names)) or set(names) != required:
            raise ValueError("VSIX contents differ from the expected release files.")
        for name, data in source_files.items():
            if archive.read(name) != data:
                raise ValueError(f"VSIX content differs from the source tag: {name}")
        identity = ET.fromstring(archive.read("extension.vsixmanifest")).find("{*}Metadata/{*}Identity")
        if identity is None or any(identity.get(key) != value for key, value in {
            "Id": manifest["name"], "Publisher": manifest["publisher"], "Version": tag
        }.items()):
            raise ValueError("VSIX identity does not match the source manifest.")
        ET.fromstring(archive.read("[Content_Types].xml"))
    return digest


def run(*args):
    return subprocess.check_output(args, cwd=ROOT)


def git_source(commit, name):
    return run("git", "show", f"{commit}:{name}")


def prepare(tag, repository, output):
    validate_tag(tag)
    if not re.fullmatch(r"[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+", repository):
        raise ValueError("Set GITHUB_REPOSITORY to owner/repository.")
    ref = f"refs/tags/{tag}"
    if run("git", "cat-file", "-t", ref).strip() != b"tag":
        raise ValueError("The release must use an annotated tag.")
    commit = run("git", "rev-parse", f"{ref}^{{commit}}").decode().strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", commit, "HEAD"], cwd=ROOT, check=True)
    manifest = json.loads(git_source(commit, "extension/package.json"))
    current = json.loads((ROOT / "extension/package.json").read_text())
    if any(manifest[key] != current[key] for key in ["name", "publisher"]):
        raise ValueError("Release publisher and extension name must match the current project.")
    source_paths = {
        "extension/package.json": "extension/package.json",
        "extension/README.md": "extension/README.md",
        "extension/LICENSE": "LICENSE",
        "extension/CHANGELOG.md": "CHANGELOG.md",
        "extension/lib/state.cjs": "plugin/lib/state.cjs",
    }
    runtime = run("git", "ls-tree", "-r", "--name-only", commit, "--", "extension/src").decode().splitlines()
    source_paths.update({name: name for name in runtime if name.endswith(".cjs")})
    source_files = {target: git_source(commit, source) for target, source in source_paths.items()}
    filename = f"{manifest['name']}-{tag}.vsix"
    checksum_name = f"SHA256SUMS-{tag}.txt"
    release = json.loads(run("gh", "release", "view", tag, "--repo", repository,
                             "--json", "tagName,isDraft,isPrerelease,publishedAt,assets"))
    validate_release(release, tag, filename)
    with tempfile.TemporaryDirectory(prefix="vs-control-marketplace-") as directory:
        run("gh", "release", "download", tag, "--repo", repository, "--dir", directory,
            "--pattern", filename, "--pattern", checksum_name)
        file = Path(directory) / filename
        digest = validate_vsix(file, (Path(directory) / checksum_name).read_text(), tag, manifest, source_files)
        output.mkdir(parents=True, exist_ok=True)
        (output / filename).write_bytes(file.read_bytes())
        (output / "verified.sha256").write_text(f"{digest}  {filename}\n")
    print(f"Verified {manifest['publisher']}.{manifest['name']} {tag} against {commit}.")
    if os.environ.get("GITHUB_OUTPUT"):
        with open(os.environ["GITHUB_OUTPUT"], "a") as stream:
            stream.write(f"filename={filename}\n")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--tag", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    prepare(args.tag, os.environ.get("GITHUB_REPOSITORY", "morzan1001/VS-Control"), args.output)
