import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';
import { LLMProvider, LLMRequest } from './llmProvider';
import { Task } from './taskManager';
import { Prompt } from './promptManager';

export interface ProcessingResult {
    uri: vscode.Uri;
    success: boolean;
    response?: string;
    error?: string;
    model?: string;
    tokens?: number;
}

export interface BatchResult {
    results: ProcessingResult[];
    totalProcessed: number;
    totalSuccessful: number;
    totalFailed: number;
    totalTokens: number;
    duration: number;
}

export class BatchProcessor {
    private isProcessing = false;
    private cancellationToken?: vscode.CancellationTokenSource;

    constructor(private llmProvider: LLMProvider) {}

    async process(
        uris: vscode.Uri[],
        type: 'task' | 'prompt',
        item: Task | Prompt,
        batchSize: number = 1
    ): Promise<BatchResult> {
        if (this.isProcessing) {
            throw new Error('Another batch operation is already in progress');
        }

        this.isProcessing = true;
        this.cancellationToken = new vscode.CancellationTokenSource();
        
        const startTime = Date.now();
        const results: ProcessingResult[] = [];
        let totalTokens = 0;

        try {
            // Select model
            const selectedModel = await this.llmProvider.selectModel();
            if (!selectedModel) {
                throw new Error('No model selected');
            }

            // Process in batches
            const batches = this.createBatches(uris, batchSize);
            let processedCount = 0;

            await vscode.window.withProgress({
                location: vscode.ProgressLocation.Notification,
                title: `Processing ${uris.length} items with ${type}`,
                cancellable: true
            }, async (progress, token) => {
                token.onCancellationRequested(() => {
                    this.cancellationToken?.cancel();
                });

                for (let batchIndex = 0; batchIndex < batches.length; batchIndex++) {
                    if (this.cancellationToken?.token.isCancellationRequested) {
                        break;
                    }

                    const batch = batches[batchIndex];
                    const batchPromises = batch.map(uri => this.processItem(uri, type, item, selectedModel));
                    
                    const batchResults = await Promise.allSettled(batchPromises);
                    
                    for (let i = 0; i < batchResults.length; i++) {
                        const result = batchResults[i];
                        processedCount++;
                        
                        if (result.status === 'fulfilled') {
                            results.push(result.value);
                            totalTokens += result.value.tokens || 0;
                        } else {
                            results.push({
                                uri: batch[i],
                                success: false,
                                error: result.reason?.message || 'Unknown error'
                            });
                        }

                        progress.report({
                            increment: (100 / uris.length),
                            message: `Processed ${processedCount}/${uris.length} items`
                        });
                    }

                    // Add delay between batches to avoid rate limiting
                    if (batchIndex < batches.length - 1 && batchSize > 1) {
                        await this.delay(1000);
                    }
                }
            });

            const duration = Date.now() - startTime;
            const batchResult: BatchResult = {
                results,
                totalProcessed: results.length,
                totalSuccessful: results.filter(r => r.success).length,
                totalFailed: results.filter(r => !r.success).length,
                totalTokens,
                duration
            };

            await this.showResults(batchResult);
            return batchResult;

        } finally {
            this.isProcessing = false;
            this.cancellationToken = undefined;
        }
    }

    private createBatches<T>(items: T[], batchSize: number): T[][] {
        const batches: T[][] = [];
        for (let i = 0; i < items.length; i += batchSize) {
            batches.push(items.slice(i, i + batchSize));
        }
        return batches;
    }

    private async processItem(
        uri: vscode.Uri,
        type: 'task' | 'prompt',
        item: Task | Prompt,
        model: string
    ): Promise<ProcessingResult> {
        try {
            const content = await this.getFileContent(uri);
            const prompt = this.buildPrompt(uri, content, type, item);
            
            const request: LLMRequest = {
                prompt,
                model,
                temperature: 0.7,
                maxTokens: 4000
            };

            const response = await this.llmProvider.sendRequest(request);
            
            // Save result to output file
            await this.saveResult(uri, response.content, type, item);

            return {
                uri,
                success: true,
                response: response.content,
                model: response.model,
                tokens: response.usage?.totalTokens
            };
        } catch (error) {
            return {
                uri,
                success: false,
                error: error instanceof Error ? error.message : 'Unknown error'
            };
        }
    }

    private async getFileContent(uri: vscode.Uri): Promise<string> {
        try {
            const stat = await vscode.workspace.fs.stat(uri);
            
            if (stat.type === vscode.FileType.Directory) {
                // For directories, list contents
                const entries = await vscode.workspace.fs.readDirectory(uri);
                const fileList = entries.map(([name, type]) => 
                    `${type === vscode.FileType.Directory ? '[DIR]' : '[FILE]'} ${name}`
                ).join('\n');
                
                return `Directory: ${uri.fsPath}\nContents:\n${fileList}`;
            } else {
                // For files, read content
                const bytes = await vscode.workspace.fs.readFile(uri);
                return new TextDecoder().decode(bytes);
            }
        } catch (error) {
            throw new Error(`Failed to read ${uri.fsPath}: ${error}`);
        }
    }

    private buildPrompt(uri: vscode.Uri, content: string, type: 'task' | 'prompt', item: Task | Prompt): string {
    let promptTemplate = '';
    
    if (type === 'task') {
        const task = item as Task;
        promptTemplate = task.aiPrompt || `Execute task: ${task.command}\n\nFile content:\n${content}`;
    } else {
        const prompt = item as Prompt;
        promptTemplate = prompt.content;
    }

        // Replace placeholders
        return promptTemplate
            .replace(/\{\{FILE_CONTENT\}\}/g, content)
            .replace(/\{\{FILE_PATH\}\}/g, uri.fsPath)
            .replace(/\{\{FILE_NAME\}\}/g, path.basename(uri.fsPath))
            .replace(/\{\{WORKSPACE_PATH\}\}/g, vscode.workspace.workspaceFolders?.[0]?.uri.fsPath || '');
    }

    private async saveResult(uri: vscode.Uri, result: string, type: 'task' | 'prompt', item: Task | Prompt): Promise<void> {
        try {
            const workspaceFolder = vscode.workspace.workspaceFolders?.[0];
            if (!workspaceFolder) return;

            const outputDir = path.join(workspaceFolder.uri.fsPath, '.vscode', 'batch-ai-results');
            await fs.mkdir(outputDir, { recursive: true });

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const itemName = type === 'task' ? (item as Task).label || (item as Task).command : (item as Prompt).name;
            const fileName = `${path.basename(uri.fsPath)}_${itemName}_${timestamp}.md`;
            const outputPath = path.join(outputDir, fileName);

            const outputContent = `# AI Result for ${path.basename(uri.fsPath)}

**Type**: ${type}
**Item**: ${itemName}
**Timestamp**: ${new Date().toISOString()}
**File**: ${uri.fsPath}

## Result

${result}

---
*Generated by Batch AI Operations*`;

            await fs.writeFile(outputPath, outputContent);
        } catch (error) {
            console.error('Failed to save result:', error);
        }
    }

    private async showResults(result: BatchResult): Promise<void> {
        const { totalProcessed, totalSuccessful, totalFailed, totalTokens, duration } = result;
        
        const message = `Batch processing completed:
• Processed: ${totalProcessed} items
• Successful: ${totalSuccessful}
• Failed: ${totalFailed}
• Tokens used: ${totalTokens}
• Duration: ${Math.round(duration / 1000)}s`;

        const action = await vscode.window.showInformationMessage(
            message,
            'View Results', 'View Errors'
        );

        if (action === 'View Results') {
            await this.showResultsDocument(result);
        } else if (action === 'View Errors') {
            await this.showErrorsDocument(result);
        }
    }

    private async showResultsDocument(result: BatchResult): Promise<void> {
        const successful = result.results.filter(r => r.success);
        
        let content = `# Batch AI Results\n\n`;
        content += `**Total Processed**: ${result.totalProcessed}\n`;
        content += `**Successful**: ${result.totalSuccessful}\n`;
        content += `**Failed**: ${result.totalFailed}\n`;
        content += `**Total Tokens**: ${result.totalTokens}\n`;
        content += `**Duration**: ${Math.round(result.duration / 1000)}s\n\n`;

        content += `## Successful Operations\n\n`;
        
        for (const item of successful) {
            content += `### ${path.basename(item.uri.fsPath)}\n`;
            content += `**Path**: ${item.uri.fsPath}\n`;
            content += `**Model**: ${item.model || 'Unknown'}\n`;
            content += `**Tokens**: ${item.tokens || 0}\n\n`;
            content += `**Response**:\n\`\`\`\n${item.response}\n\`\`\`\n\n`;
        }

        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    private async showErrorsDocument(result: BatchResult): Promise<void> {
        const failed = result.results.filter(r => !r.success);
        
        if (failed.length === 0) {
            vscode.window.showInformationMessage('No errors to display!');
            return;
        }

        let content = `# Batch AI Errors\n\n`;
        
        for (const item of failed) {
            content += `### ${path.basename(item.uri.fsPath)}\n`;
            content += `**Path**: ${item.uri.fsPath}\n`;
            content += `**Error**: ${item.error}\n\n`;
        }

        const doc = await vscode.workspace.openTextDocument({
            content,
            language: 'markdown'
        });
        await vscode.window.showTextDocument(doc);
    }

    private delay(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    isCurrentlyProcessing(): boolean {
        return this.isProcessing;
    }

    cancel(): void {
        if (this.cancellationToken) {
            this.cancellationToken.cancel();
        }
    }
}
