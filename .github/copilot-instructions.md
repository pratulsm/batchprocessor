<!-- Use this file to provide workspace-specific custom instructions to Copilot. For more details, visit https://code.visualstudio.com/docs/copilot/copilot-customization#_use-a-githubcopilotinstructionsmd-file -->

This is a VS Code extension project for batch processing files/folders using either VS Code tasks or workspace-defined prompts.

- Users can select files/folders and batch run a task (from tasks.json) or a prompt (from *.prompt.md files).
- Batch size is user-selectable (default: 1 for serial processing).
- LLM selection is configurable via VS Code settings, supporting all LLMs from vscode.lm API or a local Ollama endpoint.
- Show estimated request count before running.
- Add right-click context menus: two submenus (Tasks, Prompts), each listing available options.
- Expose a chat participant, LLM operation API, and MCP API for natural language top-level requests.

When generating code, prefer using the get_vscode_api tool for VS Code API references, especially for context menus, tasks, workspace file discovery, and LLM integration.
