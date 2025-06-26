# Batchprocessor VS Code Extension

Batchprocessor helps you batch operate on files or folders using either VS Code tasks or workspace-defined prompts. It is designed to make it easy to:

- Select multiple files or folders and run a predefined task (from `tasks.json`) on each, in batch or serial mode.
- Select multiple files or folders and run a workspace-defined prompt (any `*.prompt.md` file) on each, in batch or serial mode.
- Choose the batch size for processing (default: 1, i.e., serial).
- Select the LLM to use for prompt operations, either from all available LLMs via the `vscode.lm` API or a local Ollama endpoint (configurable).
- See an estimated request count before running the operation.
- Use a right-click context menu (after selecting files/folders) to access two submenus: **Tasks** and **Prompts**. Each submenu lists available tasks or prompts for batch operation.
- Expose a chat participant, LLM operation API, and MCP API so that top-level requests in natural language can be handled by LLMs.

## Features

- Batch process files/folders with VS Code tasks or prompts
- Batch size selection (serial or parallel)
- LLM selection (vscode.lm API or Ollama)
- Estimated request count
- Context menu integration for easy access
- Extensible APIs for chat and LLM/MCP operations

## Getting Started

1. Select files or folders in the Explorer.
2. Right-click and choose **Tasks** or **Prompts** to see available options.
3. Choose a task or prompt, set the batch size, and select the LLM if needed.
4. Review the estimated request count and confirm to run.

## Development

- Source code is in `src/`.
- Update `package.json` to add new commands, menus, or configuration options.
- Prompts are any `*.prompt.md` files in the workspace.
- LLMs are discovered via the `vscode.lm` API or configured Ollama endpoint.

## License

MIT
