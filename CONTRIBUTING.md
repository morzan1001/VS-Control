# Contributing

Requires **Node.js 20+** and **Python 3**. No npm dependencies need to be installed. Keep documentation and user-facing text in English.

## Development

Run the checks before submitting changes:

```sh
npm run verify
```

This checks syntax and versions, runs tests, and verifies package contents, checksums, reproducibility, and MCP startup.

For changes affecting VS Code integration, also run:

```sh
npm run test:integration
```

This requires VS Code Desktop and uses a temporary profile. Set `VSCODE_EXECUTABLE` if needed. GitHub Actions covers tests and packaging on Linux and macOS with Node.js 20 and 24; the interactive suite runs locally.

## Changes

- Keep changes focused and describe how you verified them.
- Preserve native tool schemas and permission behavior.
- Update the relevant README when behavior or setup changes.
- Edit source files and keep generated artifacts out of Git.
- Keep project versions aligned; `npm run check` catches mismatches. Maintain a nonempty `## <version>` section in `CHANGELOG.md`.

## Releases

1. Update the changelog, run the checks, and merge the changes through a pull request.
2. On the merged commit, create an annotated tag matching the package version, for example `git tag -a 0.0.2 -m "Release 0.0.2"`. Use no `v` prefix.
3. Push the tag and wait for CI to pass.
4. Manually run **Draft release** with the tag. It builds the VSIX, plugin ZIP, and checksums using release notes from the changelog.
5. Review and publish the draft in GitHub.

Releases are published manually; pushing a tag only triggers checks.

## VS Code Marketplace

**Publish to VS Code Marketplace** verifies the published release's VSIX against its checksum and source tag, then publishes that exact file using OIDC. Drafts and prereleases are excluded.

One-time setup in your Marketplace publisher's **Trusted Publishing** settings:

| Field | Value |
| --- | --- |
| Publisher ID | `morzan1001` (must match the packaged manifest) |
| Repository owner | `morzan1001` |
| Repository | `VS-Control` |
| Workflow | `publish-marketplace.yml` |
| Environment | `marketplace` |

After creating the publisher and policy, set the GitHub repository variable `MARKETPLACE_PUBLISHING_ENABLED` to `true`. No PAT or repository secret is needed.

Published GitHub releases trigger publishing automatically. To retry a release, run the workflow manually on `main`, enter the tag, and enable **publish**. Leave it unchecked to verify without publishing. Version `0.0.1` used a different publisher and cannot be published by this workflow; use `0.0.2` or later. Never replace existing release assets.
