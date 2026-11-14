# VS Control — Claude Code Bridge

Connect VS Code to the **VS Control Claude Code plugin** through a local MCP bridge. Expose integrated browser tools, native tests, editor diagnostics, code navigation, tasks, and debug configurations.

## Setup

Requires **VS Code Desktop 1.109+**. Use a recent version for browser tools. The Claude Code plugin requires **Node.js 20+** on Claude's PATH.

1. Install from the [VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=morzan1001.vs-control-bridge), or run:

   ```sh
   code --install-extension morzan1001.vs-control-bridge
   ```

   You can also download the [VSIX from GitHub Releases](https://github.com/morzan1001/VS-Control/releases/latest) and use **Extensions: Install from VSIX…**. Uninstall the old extension first if upgrading from `0.0.1`; the publisher ID changed.

2. Open a trusted workspace. Reload the window if needed; **VS Control** appears in the status bar.
3. Install the companion plugin in Claude Code:

   ```text
   /plugin marketplace add morzan1001/VS-Control
   /plugin install vs-control@vs-control
   ```

   For local development, replace the repository name with your checkout's absolute path.

4. Start a new Claude conversation and run `/vs-control:doctor`.

## Try it

```text
Read the active file's diagnostics and find the selected symbol's definition.

Open http://localhost:3000 in the integrated browser and test the login form.
```

## Settings and commands

Enable `workbench.browser.enableChatTools` for browser access. Existing tabs follow **Share with Agent** controls and native confirmations. Running tests requires a test extension for your project.

Browser and testing tools are enabled by default. Use `vsControl.nativeToolGroups` in user settings to also enable available terminal, notebook, or code tools.

In the Command Palette:

- **VS Control: Show Connection and Tools** — inspect the bridge and available tools.
- **VS Control: Restart Bridge** — restart the local connection.
- **VS Control: Stop Bridge** — stop the local connection.

Claude and the bridge must run on the same host as the same user. Available native tools depend on VS Code and installed extensions.
