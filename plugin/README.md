# VS Control for Claude Code

Use VS Code's browser, tests, diagnostics, code navigation, tasks, and debug configurations from the **Claude Code CLI or VS Code panel**. The included skill and session hook recommend available IDE tools when relevant.

## Setup

Requires **Node.js 20+** on Claude's PATH and Claude Code with plugin support.

1. Install the [companion extension](https://marketplace.visualstudio.com/items?itemName=morzan1001.vs-control-bridge) and open a trusted workspace:

   ```sh
   code --install-extension morzan1001.vs-control-bridge
   ```

   For manual installation, download the [VSIX from GitHub Releases](https://github.com/morzan1001/VS-Control/releases/latest) and use **Extensions: Install from VSIX…**. Uninstall the old extension first if upgrading from `0.0.1`.

2. Install this plugin in Claude Code:

   ```text
   /plugin marketplace add morzan1001/VS-Control
   /plugin install vs-control@vs-control
   ```

   For local development, replace the repository name with your checkout's absolute path.

3. Start a new conversation and run `/vs-control:doctor` to check the connection and tools.

## Try it

```text
Run the failing tests in VS Code and explain the results.

Open http://localhost:3000 in the integrated browser and take a screenshot.
```

For a CLI trial without installing the plugin:

```sh
claude --plugin-dir /absolute/path/to/VS-Control/plugin
```

Keep the companion extension running. Browser tools require `workbench.browser.enableChatTools`; tests require a test extension for your project.
