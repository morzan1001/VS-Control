# VS Control

Give Claude Code control of VS Code's browser, tests, and editor.

Works with the **Claude Code CLI and VS Code extension** through a local MCP bridge. Install both the Claude Code plugin and the **VS Control — Claude Code Bridge** extension.

## What it does

- **Browser:** Open pages, click, type, read content, and take screenshots in VS Code's integrated browser.
- **Tests:** Run tests, inspect failures, and use the Test Explorer.
- **Editor:** Read diagnostics and selections, open files, and find symbols, definitions, and references.
- **Tasks and debugging:** Run configured tasks, check exit codes, and start or stop named debug configurations.

The included skill and session hook guide Claude toward available IDE tools when relevant.

## Installation

Requires **VS Code Desktop 1.109+**, **Claude Code with plugin support**, and **Node.js 20+** on Claude's PATH. Use a recent VS Code version for browser tools.

1. Install [VS Control — Claude Code Bridge](https://marketplace.visualstudio.com/items?itemName=morzan1001.vs-control-bridge) from the VS Code Marketplace, or run:

   ```sh
   code --install-extension morzan1001.vs-control-bridge
   ```

   Alternatively, download the [VSIX from GitHub Releases](https://github.com/morzan1001/VS-Control/releases/latest) and use **Extensions: Install from VSIX…**.

2. Open a trusted workspace and reload the window if needed.

3. Install the Claude Code plugin:

   ```text
   /plugin marketplace add morzan1001/VS-Control
   /plugin install vs-control@vs-control
   ```

   For local development, replace `morzan1001/VS-Control` with the absolute path to your checkout.

4. Start a new Claude conversation and run `/vs-control:doctor` to check the connection and available tools.

For a CLI trial, load the plugin directly:

```sh
claude --plugin-dir /absolute/path/to/VS-Control/plugin
```

## Try it

```text
Inspect the failing tests in VS Code, fix the cause, and rerun them.

Open http://localhost:3000 in the integrated browser and test the login form.

Read the active file's diagnostics and find the selected symbol's definition.
```

## Settings

For browser tools, enable `workbench.browser.enableChatTools` in VS Code. Existing tabs follow **Share with Agent** controls and native confirmations. Running tests requires a test extension for your project.

Browser and testing tools are enabled by default. To also expose available terminal, notebook, and code tools, add this to your VS Code user settings:

```json
{
  "vsControl.nativeToolGroups": ["browser", "testing", "terminal", "notebook", "code"]
}
```

Available tools depend on VS Code and installed extensions; most notebook and code tools come from GitHub Copilot Chat. The bridge and Claude must run on the same host as the same user. Windows and remote setups have not been tested.

## Development

```sh
npm run package           # Build installation files; requires Python 3
npm run verify            # Checks, tests, packaging, and package verification
npm run test:integration  # Real VS Code checks in a temporary profile
```

GitHub Actions runs tests and package checks on Linux and macOS with Node.js 20 and 24. The interactive VS Code suite runs locally. Generated packages stay in `dist/` and are excluded from Git.
