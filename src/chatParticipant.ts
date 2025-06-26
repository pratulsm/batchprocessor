import * as vscode from 'vscode';
import { BatchProcessor } from './batchProcessor';
import { TaskManager } from './taskManager';
import { PromptManager } from './promptManager';

export class ChatParticipant {
    constructor(
        private batchProcessor: BatchProcessor,
        private taskManager: TaskManager,
        private promptManager: PromptManager
    ) {}

    async handleChatRequest(
        request: vscode.ChatRequest,
        context: vscode.ChatContext,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        try {
            const command = this.parseCommand(request.prompt);
            
            switch (command.action) {
                case 'batch':
                    await this.handleBatchCommand(command, stream, token);
                    break;
                case 'list':
                    await this.handleListCommand(command, stream);
                    break;
                case 'help':
                    await this.handleHelpCommand(stream);
                    break;
                case 'status':
                    await this.handleStatusCommand(stream);
                    break;
                default:
                    await this.handleGeneralQuery(request.prompt, stream, token);
            }
        } catch (error) {
            stream.markdown(`❌ **Error**: ${error instanceof Error ? error.message : 'Unknown error occurred'}`);
        }
    }

    private parseCommand(prompt: string): { action: string; args: string[] } {
        const words = prompt.toLowerCase().trim().split(/\s+/);
        const action = words[0];
        const args = words.slice(1);
        
        return { action, args };
    }

    private async handleBatchCommand(
        command: { action: string; args: string[] },
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        if (command.args.length < 2) {
            stream.markdown(`❌ **Usage**: \`batch <task|prompt> <name> [files...]\`

**Examples**:
- \`batch task code-review src/**/*.ts\`
- \`batch prompt documentation lib/\`
- \`batch task refactor\` (uses currently selected files)`);
            return;
        }

        const type = command.args[0] as 'task' | 'prompt';
        const itemName = command.args[1];
        const filePatterns = command.args.slice(2);

        if (type !== 'task' && type !== 'prompt') {
            stream.markdown(`❌ **Error**: Type must be 'task' or 'prompt'`);
            return;
        }

        // Get the item
        let item;
        if (type === 'task') {
            item = this.taskManager.getTask(itemName);
            if (!item) {
                stream.markdown(`❌ **Error**: Task '${itemName}' not found`);
                return;
            }
        } else {
            item = this.promptManager.getPrompt(itemName);
            if (!item) {
                stream.markdown(`❌ **Error**: Prompt '${itemName}' not found`);
                return;
            }
        }

        // Get files to process
        let uris: vscode.Uri[] = [];
        
        if (filePatterns.length === 0) {
            // Use currently selected files/folders in explorer
            // This would need to be implemented with proper context
            stream.markdown(`ℹ️ **Info**: No file patterns specified. Please select files in the explorer and try again, or specify file patterns.`);
            return;
        } else {
            // Find files matching patterns
            uris = await this.findFilesFromPatterns(filePatterns);
        }

        if (uris.length === 0) {
            stream.markdown(`❌ **Error**: No files found matching the specified patterns`);
            return;
        }

        stream.markdown(`🚀 **Starting batch operation**:
- **Type**: ${type}
- **Item**: ${itemName}
- **Files**: ${uris.length} items
- **Estimated requests**: ${Math.ceil(uris.length / 1)}`);

        try {
            const result = await this.batchProcessor.process(uris, type, item, 1);
            
            stream.markdown(`✅ **Batch operation completed**:
- **Processed**: ${result.totalProcessed}
- **Successful**: ${result.totalSuccessful}
- **Failed**: ${result.totalFailed}
- **Duration**: ${Math.round(result.duration / 1000)}s
- **Tokens used**: ${result.totalTokens}

Results have been saved to \`.vscode/batch-ai-results/\``);
        } catch (error) {
            stream.markdown(`❌ **Batch operation failed**: ${error instanceof Error ? error.message : 'Unknown error'}`);
        }
    }

    private async handleListCommand(
        command: { action: string; args: string[] },
        stream: vscode.ChatResponseStream
    ): Promise<void> {
        const listType = command.args[0];

        if (!listType || (listType !== 'tasks' && listType !== 'prompts')) {
            stream.markdown(`❌ **Usage**: \`list <tasks|prompts>\`

**Examples**:
- \`list tasks\` - Show available tasks
- \`list prompts\` - Show available prompts`);
            return;
        }

        if (listType === 'tasks') {
            const tasks = this.taskManager.getTasks();
            if (tasks.length === 0) {
                stream.markdown(`ℹ️ **No tasks found**. Configure tasks in your \`tasks.json\` file.`);
                return;
            }

            stream.markdown(`📋 **Available Tasks** (${tasks.length}):\n`);
            for (const task of tasks) {
                const label = task.label || task.command;
                const description = task.description || task.aiPrompt || 'No description';
                stream.markdown(`- **${label}**: ${description}`);
            }
        } else {
            const prompts = this.promptManager.getPrompts();
            if (prompts.length === 0) {
                stream.markdown(`ℹ️ **No prompts found**. Create \`.prompt.md\` files in your prompts folder.`);
                return;
            }

            stream.markdown(`📝 **Available Prompts** (${prompts.length}):\n`);
            for (const prompt of prompts) {
                const description = prompt.description || 'No description';
                stream.markdown(`- **${prompt.name}**: ${description}`);
            }
        }
    }

    private async handleStatusCommand(stream: vscode.ChatResponseStream): Promise<void> {
        const isProcessing = this.batchProcessor.isCurrentlyProcessing();
        
        stream.markdown(`📊 **Batch AI Status**:
- **Processing**: ${isProcessing ? '🔄 Active' : '⏸️ Idle'}
- **Available Tasks**: ${this.taskManager.getTasks().length}
- **Available Prompts**: ${this.promptManager.getPrompts().length}`);

        if (isProcessing) {
            stream.markdown(`\n💡 **Tip**: You can cancel the current operation using the progress notification.`);
        }
    }

    private async handleHelpCommand(stream: vscode.ChatResponseStream): Promise<void> {
        stream.markdown(`# 🤖 Batch AI Operations Help

## Available Commands

### 📦 Batch Processing
- \`batch task <task-name> [file-patterns...]\` - Run a task on files
- \`batch prompt <prompt-name> [file-patterns...]\` - Apply a prompt to files

### 📋 Information
- \`list tasks\` - Show available tasks
- \`list prompts\` - Show available prompts
- \`status\` - Show current processing status
- \`help\` - Show this help message

## Examples

\`\`\`
@batchAI batch task code-review src/**/*.ts
@batchAI batch prompt documentation lib/
@batchAI list tasks
@batchAI status
\`\`\`

## File Patterns
- \`src/**/*.ts\` - All TypeScript files in src and subdirectories
- \`lib/\` - All files in lib directory
- \`*.js\` - All JavaScript files in current directory
- \`**/*.md\` - All Markdown files in all directories

## Configuration
Configure the extension in VSCode settings:
- **LLM Provider**: Choose between VSCode LM API or Ollama
- **Batch Size**: Number of files to process concurrently
- **Prompts Folder**: Location of your prompt templates
- **Tasks File**: Path to your tasks configuration`);
    }

    private async handleGeneralQuery(
        prompt: string,
        stream: vscode.ChatResponseStream,
        token: vscode.CancellationToken
    ): Promise<void> {
        // For general queries, provide helpful information about the extension
        const lowerPrompt = prompt.toLowerCase();
        
        if (lowerPrompt.includes('how') || lowerPrompt.includes('what') || lowerPrompt.includes('help')) {
            stream.markdown(`I'm here to help with batch AI operations! Here's what I can do:

🔧 **Batch Processing**: Run AI tasks or prompts on multiple files simultaneously
📝 **Task Management**: Execute predefined tasks from your tasks.json
💬 **Prompt Templates**: Apply custom prompts from .prompt.md files
⚙️ **Flexible Configuration**: Use VSCode LM API or local Ollama models

**Quick Start**:
1. Type \`@batchAI help\` for detailed commands
2. Type \`@batchAI list tasks\` to see available tasks
3. Type \`@batchAI list prompts\` to see available prompts

**Example**: \`@batchAI batch task code-review src/**/*.ts\`

What would you like to do?`);
        } else {
            stream.markdown(`I can help you with batch AI operations. Try:
- \`@batchAI help\` for all commands
- \`@batchAI list tasks\` to see available tasks
- \`@batchAI list prompts\` to see available prompts
- \`@batchAI batch task <name> <files>\` to process files

What specific operation would you like to perform?`);
        }
    }

    private async findFilesFromPatterns(patterns: string[]): Promise<vscode.Uri[]> {
        const uris: vscode.Uri[] = [];
        
        for (const pattern of patterns) {
            try {
                const files = await vscode.workspace.findFiles(pattern);
                uris.push(...files);
            } catch (error) {
                console.error(`Error finding files for pattern ${pattern}:`, error);
            }
        }
        
        // Remove duplicates
        const uniqueUris = Array.from(new Set(uris.map(uri => uri.toString())))
            .map(uriString => vscode.Uri.parse(uriString));
        
        return uniqueUris;
    }
}