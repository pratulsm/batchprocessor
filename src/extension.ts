import * as vscode from 'vscode';
import { TaskManager } from './taskManager';
import { PromptManager } from './promptManager';
import { LLMProvider } from './llmProvider';
import { BatchProcessor } from './batchProcessor';
import { ChatParticipant } from './chatParticipant';
import { MCPServer } from './mcpServer';

export function activate(context: vscode.ExtensionContext) {
    console.log('Batch AI Operations extension is now active!');

    // Initialize managers
    const taskManager = new TaskManager();
    const promptManager = new PromptManager();
    const llmProvider = new LLMProvider();
    const batchProcessor = new BatchProcessor(llmProvider);
    const chatParticipant = new ChatParticipant(batchProcessor, taskManager, promptManager);
    const mcpServer = new MCPServer(batchProcessor, taskManager, promptManager);

    // Register commands
    const disposables = [
        vscode.commands.registerCommand('batchAI.processWithTask', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            await handleTaskSelection(uri, uris, taskManager, batchProcessor);
        }),
        
        vscode.commands.registerCommand('batchAI.processWithPrompt', async (uri: vscode.Uri, uris: vscode.Uri[]) => {
            await handlePromptSelection(uri, uris, promptManager, batchProcessor);
        }),
        
        vscode.commands.registerCommand('batchAI.refreshPrompts', async () => {
            await promptManager.refresh();
            vscode.window.showInformationMessage('Prompts refreshed');
        }),
        
        vscode.commands.registerCommand('batchAI.refreshTasks', async () => {
            await taskManager.refresh();
            vscode.window.showInformationMessage('Tasks refreshed');
        })
    ];

// Menu contributions are now defined in package.json, no dynamic registration needed
    // Register chat participant
    const chatDisposable = vscode.chat.createChatParticipant('batchAI', chatParticipant.handleChatRequest.bind(chatParticipant));
    context.subscriptions.push(chatDisposable);

    // Start MCP server
    mcpServer.start();

    context.subscriptions.push(...disposables);

    // Watch for configuration changes
    context.subscriptions.push(
        vscode.workspace.onDidChangeConfiguration(e => {
            if (e.affectsConfiguration('batchAI')) {
                llmProvider.updateConfiguration();
            }
        })
    );

    // Watch for file changes to refresh prompts and tasks
    const watcher = vscode.workspace.createFileSystemWatcher('**/*.{prompt.md,tasks.json}');
    watcher.onDidChange(() => {
        promptManager.refresh();
        taskManager.refresh();
    });
    watcher.onDidCreate(() => {
        promptManager.refresh();
        taskManager.refresh();
    });
    watcher.onDidDelete(() => {
        promptManager.refresh();
        taskManager.refresh();
    });
    context.subscriptions.push(watcher);
}

async function handleTaskSelection(uri: vscode.Uri, uris: vscode.Uri[], taskManager: TaskManager, batchProcessor: BatchProcessor) {
    const selectedUris = uris && uris.length > 0 ? uris : [uri];
    const tasks = await taskManager.getTasks();
    
    if (tasks.length === 0) {
        vscode.window.showWarningMessage('No tasks found. Please configure tasks in tasks.json');
        return;
    }

    const taskNames = tasks.map(task => task.label || task.command);
    const selectedTask = await vscode.window.showQuickPick(taskNames, {
        placeHolder: 'Select a task to run on selected files/folders'
    });

    if (!selectedTask) return;

    const task = tasks.find((t: any) => (t.label || t.command) === selectedTask);
    if (!task) return;

    await showBatchConfigurationAndProcess(selectedUris, 'task', task, batchProcessor);
}

async function handlePromptSelection(uri: vscode.Uri, uris: vscode.Uri[], promptManager: PromptManager, batchProcessor: BatchProcessor) {
    const selectedUris = uris && uris.length > 0 ? uris : [uri];
    const prompts = await promptManager.getPrompts();
    
    if (prompts.length === 0) {
        vscode.window.showWarningMessage('No prompts found. Please create *.prompt.md files in your prompts folder');
        return;
    }

    const promptNames = prompts.map(prompt => prompt.name);
    const selectedPrompt = await vscode.window.showQuickPick(promptNames, {
        placeHolder: 'Select a prompt to apply to selected files/folders'
    });

    if (!selectedPrompt) return;

    const prompt = prompts.find((p: any) => p.name === selectedPrompt);
    if (!prompt) return;

    await showBatchConfigurationAndProcess(selectedUris, 'prompt', prompt, batchProcessor);
}

async function showBatchConfigurationAndProcess(
    uris: vscode.Uri[], 
    type: 'task' | 'prompt', 
    item: any, 
    batchProcessor: BatchProcessor
) {
    const config = vscode.workspace.getConfiguration('batchAI');
    const defaultBatchSize = config.get<number>('defaultBatchSize', 1);
    
    // Show batch size input
    const batchSizeInput = await vscode.window.showInputBox({
        prompt: `Enter batch size (default: ${defaultBatchSize})`,
        value: defaultBatchSize.toString(),
        validateInput: (value) => {
            const num = parseInt(value);
            if (isNaN(num) || num < 1 || num > 50) {
                return 'Batch size must be between 1 and 50';
            }
            return null;
        }
    });

    if (!batchSizeInput) return;

    const batchSize = parseInt(batchSizeInput);
    const estimatedRequests = Math.ceil(uris.length / batchSize);
    
    const proceed = await vscode.window.showInformationMessage(
        `This will process ${uris.length} items in ${estimatedRequests} requests (batch size: ${batchSize}). Continue?`,
        'Yes', 'No'
    );

    if (proceed !== 'Yes') return;

    // Start processing
    await batchProcessor.process(uris, type, item, batchSize);
}

export function deactivate() {}
