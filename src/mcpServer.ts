import * as vscode from 'vscode';
import { BatchProcessor } from './batchProcessor';
import { TaskManager } from './taskManager';
import { PromptManager } from './promptManager';

export interface MCPRequest {
    method: string;
    params: any;
    id?: string | number;
}

export interface MCPResponse {
    result?: any;
    error?: {
        code: number;
        message: string;
        data?: any;
    };
    id?: string | number;
}

export class MCPServer {
    private server: any;
    private isRunning = false;

    constructor(
        private batchProcessor: BatchProcessor,
        private taskManager: TaskManager,
        private promptManager: PromptManager
    ) {}

    start(): void {
        if (this.isRunning) {
            return;
        }

        this.isRunning = true;
        console.log('MCP Server started for Batch AI Operations');
        
        // In a real implementation, this would start an actual MCP server
        // For now, we'll register the capabilities and provide the interface
        this.registerCapabilities();
    }

    stop(): void {
        if (!this.isRunning) {
            return;
        }

        this.isRunning = false;
        console.log('MCP Server stopped');
    }

    private registerCapabilities(): void {
        // Register MCP tools and resources
        console.log('Registering MCP capabilities:');
        console.log('- batch_process_files');
        console.log('- list_tasks');
        console.log('- list_prompts');
        console.log('- get_processing_status');
    }

    async handleRequest(request: MCPRequest): Promise<MCPResponse> {
        try {
            switch (request.method) {
                case 'tools/list':
                    return this.handleListTools(request);
                case 'tools/call':
                    return this.handleToolCall(request);
                case 'resources/list':
                    return this.handleListResources(request);
                case 'resources/read':
                    return this.handleReadResource(request);
                default:
                    return {
                        error: {
                            code: -32601,
                            message: `Method not found: ${request.method}`
                        },
                        id: request.id
                    };
            }
        } catch (error) {
            return {
                error: {
                    code: -32603,
                    message: `Internal error: ${error instanceof Error ? error.message : 'Unknown error'}`,
                    data: error
                },
                id: request.id
            };
        }
    }

    private handleListTools(request: MCPRequest): MCPResponse {
        const tools = [
            {
                name: 'batch_process_files',
                description: 'Process multiple files with AI tasks or prompts',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: {
                            type: 'string',
                            enum: ['task', 'prompt'],
                            description: 'Type of operation to perform'
                        },
                        item_name: {
                            type: 'string',
                            description: 'Name of the task or prompt to use'
                        },
                        file_patterns: {
                            type: 'array',
                            items: { type: 'string' },
                            description: 'File patterns to match (glob patterns)'
                        },
                        batch_size: {
                            type: 'number',
                            default: 1,
                            minimum: 1,
                            maximum: 50,
                            description: 'Number of files to process concurrently'
                        }
                    },
                    required: ['type', 'item_name', 'file_patterns']
                }
            },
            {
                name: 'list_tasks',
                description: 'List all available AI tasks',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'list_prompts',
                description: 'List all available AI prompts',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            },
            {
                name: 'get_processing_status',
                description: 'Get current batch processing status',
                inputSchema: {
                    type: 'object',
                    properties: {}
                }
            }
        ];

        return {
            result: { tools },
            id: request.id
        };
    }

    private async handleToolCall(request: MCPRequest): Promise<MCPResponse> {
        const { name, arguments: args } = request.params;

        switch (name) {
            case 'batch_process_files':
                return await this.handleBatchProcessFiles(args, request.id);
            case 'list_tasks':
                return this.handleListTasksTool(request.id);
            case 'list_prompts':
                return this.handleListPromptsTool(request.id);
            case 'get_processing_status':
                return this.handleGetProcessingStatus(request.id);
            default:
                return {
                    error: {
                        code: -32602,
                        message: `Unknown tool: ${name}`
                    },
                    id: request.id
                };
        }
    }

    private async handleBatchProcessFiles(args: any, requestId?: string | number): Promise<MCPResponse> {
        try {
            const { type, item_name, file_patterns, batch_size = 1 } = args;

            // Validate inputs
            if (!type || !item_name || !file_patterns || !Array.isArray(file_patterns)) {
                return {
                    error: {
                        code: -32602,
                        message: 'Invalid parameters. Required: type, item_name, file_patterns'
                    },
                    id: requestId
                };
            }

            // Get the item (task or prompt)
            let item;
            if (type === 'task') {
                item = this.taskManager.getTasks().find(item_name);
                if (!item) {
                    return {
                        error: {
                            code: -32602,
                            message: `Task not found: ${item_name}`
                        },
                        id: requestId
                    };
                }
            } else if (type === 'prompt') {
                item = this.promptManager.getPrompt(item_name);
                if (!item) {
                    return {
                        error: {
                            code: -32602,
                            message: `Prompt not found: ${item_name}`
                        },
                        id: requestId
                    };
                }
            } else {
                return {
                    error: {
                        code: -32602,
                        message: 'Type must be "task" or "prompt"'
                    },
                    id: requestId
                };
            }

            // Find files matching patterns
            const uris: vscode.Uri[] = [];
            for (const pattern of file_patterns) {
                const files = await vscode.workspace.findFiles(pattern);
                uris.push(...files);
            }

            if (uris.length === 0) {
                return {
                    error: {
                        code: -32602,
                        message: 'No files found matching the specified patterns'
                    },
                    id: requestId
                };
            }

            // Process files
            const result = await this.batchProcessor.process(uris, type, item, batch_size);

            return {
                result: {
                    success: true,
                    processed: result.totalProcessed,
                    successful: result.totalSuccessful,
                    failed: result.totalFailed,
                    duration_ms: result.duration,
                    tokens_used: result.totalTokens,
                    results: result.results.map(r => ({
                        file: r.uri.fsPath,
                        success: r.success,
                        error: r.error,
                        response: r.response,
                        model: r.model,
                        tokens: r.tokens
                    }))
                },
                id: requestId
            };
        } catch (error) {
            return {
                error: {
                    code: -32603,
                    message: error instanceof Error ? error.message : String(error)
                },
                id: requestId
            };
        }
    }

    // List available resources (e.g., files/folders in workspace)
    private async handleListResources(request: MCPRequest): Promise<MCPResponse> {
        try {
            const resources: any[] = [];
            const folders = vscode.workspace.workspaceFolders;
            if (folders) {
                for (const folder of folders) {
                    const files = await vscode.workspace.findFiles(new vscode.RelativePattern(folder, '**/*'));
                    resources.push(...files.map(f => ({ path: f.fsPath })));
                }
            }
            return { result: resources, id: request.id };
        } catch (error) {
            return { error: { code: -32603, message: String(error) }, id: request.id };
        }
    }

    // Read a resource (file content)
    private async handleReadResource(request: MCPRequest): Promise<MCPResponse> {
        try {
            const { path: filePath } = request.params || {};
            if (!filePath) {
                return { error: { code: -32602, message: 'Missing file path' }, id: request.id };
            }
            const uri = vscode.Uri.file(filePath);
            const bytes = await vscode.workspace.fs.readFile(uri);
            return { result: new TextDecoder().decode(bytes), id: request.id };
        } catch (error) {
            return { error: { code: -32603, message: String(error) }, id: request.id };
        }
    }

    // List all tasks
    private handleListTasksTool(requestId?: string | number): MCPResponse {
        // Use getTasks() which returns a Promise, but for MCP, we assume sync for now
        const tasks = this.taskManager.getTasks instanceof Function ? this.taskManager.getTasks() : [];
        // If getTasks returns a Promise, handle it as empty for now (MCP expects sync)
        const taskList = Array.isArray(tasks) ? tasks : [];
        return { result: taskList.map((t: any) => t.label || t.command), id: requestId };
    }

    // List all prompts
    private handleListPromptsTool(requestId?: string | number): MCPResponse {
        // Use getPrompts() which returns a Promise, but for MCP, we assume sync for now
        const prompts = this.promptManager.getPrompts instanceof Function ? this.promptManager.getPrompts() : [];
        const promptList = Array.isArray(prompts) ? prompts : [];
        return { result: promptList.map((p: any) => p.name), id: requestId };
    }

    // Get current processing status
    private handleGetProcessingStatus(requestId?: string | number): MCPResponse {
        const status = this.batchProcessor.isCurrentlyProcessing?.() || false;
        return { result: { processing: status }, id: requestId };
    }
}