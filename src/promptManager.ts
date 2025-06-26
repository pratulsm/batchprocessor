import * as vscode from 'vscode';
import * as fs from 'fs/promises';
import * as path from 'path';

export interface Prompt {
    name: string;
    content: string;
    description?: string;
    filePath: string;
    metadata?: {
        author?: string;
        version?: string;
        tags?: string[];
        model?: string[];
    };
}

export class PromptManager {
    private prompts: Prompt[] = [];
    private promptsFolder: string = '';

    constructor() {
        this.updatePromptsFolder();
        this.refresh();
    }

    private updatePromptsFolder() {
        const config = vscode.workspace.getConfiguration('batchAI');
        const folder = config.get<string>('promptsFolder', '.vscode/prompts');
        
        if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
            this.promptsFolder = path.join(vscode.workspace.workspaceFolders[0].uri.fsPath, folder);
        }
    }

    async refresh(): Promise<void> {
        this.updatePromptsFolder();
        await this.loadPrompts();
    }

    private async loadPrompts(): Promise<void> {
        try {
            if (!this.promptsFolder) {
                this.prompts = [];
                return;
            }

            // Check if prompts folder exists
            try {
                await fs.access(this.promptsFolder);
            } catch {
                // Create prompts folder and default prompts
                await this.createDefaultPrompts();
                return;
            }

            const files = await fs.readdir(this.promptsFolder);
            const promptFiles = files.filter(file => file.endsWith('.prompt.md'));
            
            this.prompts = [];
            
            for (const file of promptFiles) {
                const filePath = path.join(this.promptsFolder, file);
                const content = await fs.readFile(filePath, 'utf8');
                
                const prompt = this.parsePrompt(file, content, filePath);
                this.prompts.push(prompt);
            }
        } catch (error) {
            console.error('Error loading prompts:', error);
            this.prompts = [];
        }
    }

    private parsePrompt(fileName: string, content: string, filePath: string): Prompt {
        const name = path.basename(fileName, '.prompt.md');
        
        // Parse frontmatter if present
        let metadata: any = {};
        let promptContent = content;
        
        if (content.startsWith('---')) {
            const frontmatterEnd = content.indexOf('---', 3);
            if (frontmatterEnd !== -1) {
                const frontmatter = content.substring(3, frontmatterEnd).trim();
                promptContent = content.substring(frontmatterEnd + 3).trim();
                
                // Simple YAML-like parsing for metadata
                const lines = frontmatter.split('\n');
                for (const line of lines) {
                    const colonIndex = line.indexOf(':');
                    if (colonIndex !== -1) {
                        const key = line.substring(0, colonIndex).trim();
                        const value = line.substring(colonIndex + 1).trim();
                        
                        if (key === 'tags' || key === 'model') {
                            metadata[key] = value.split(',').map(s => s.trim());
                        } else {
                            metadata[key] = value;
                        }
                    }
                }
            }
        }

        return {
            name,
            content: promptContent,
            description: metadata.description,
            filePath,
            metadata
        };
    }

    private async createDefaultPrompts(): Promise<void> {
        try {
            await fs.mkdir(this.promptsFolder, { recursive: true });

            const defaultPrompts = [
                {
                    name: 'code-review',
                    content: `---
description: Comprehensive code review with suggestions
author: Batch AI Operations
tags: review, quality, best-practices
---

Please perform a thorough code review of the following code:

{{FILE_CONTENT}}

Focus on:
1. Code quality and best practices
2. Potential bugs or issues
3. Performance considerations
4. Security concerns
5. Readability and maintainability

Provide specific, actionable suggestions for improvement.`
                },
                {
                    name: 'generate-tests',
                    content: `---
description: Generate comprehensive unit tests
author: Batch AI Operations
tags: testing, unit-tests, quality
---

Generate comprehensive unit tests for the following code:

{{FILE_CONTENT}}

Requirements:
- Cover all functions and methods
- Include edge cases and error scenarios
- Use appropriate testing framework for the language
- Include setup and teardown if needed
- Add descriptive test names and comments

File path: {{FILE_PATH}}`
                },
                {
                    name: 'documentation',
                    content: `---
description: Generate detailed documentation
author: Batch AI Operations
tags: documentation, comments, api
---

Generate comprehensive documentation for the following code:

{{FILE_CONTENT}}

Include:
- Function/method descriptions
- Parameter descriptions with types
- Return value descriptions
- Usage examples
- Any important notes or warnings

Format the documentation appropriately for the programming language.`
                },
                {
                    name: 'refactor',
                    content: `---
description: Refactor code for better quality
author: Batch AI Operations
tags: refactoring, clean-code, optimization
---

Refactor the following code to improve:

{{FILE_CONTENT}}

Focus on:
1. Code readability and clarity
2. Performance optimization
3. Reducing complexity
4. Following language-specific best practices
5. Maintaining existing functionality

Explain the changes made and why they improve the code.`
                },
                {
                    name: 'explain-code',
                    content: `---
description: Explain code functionality and logic
author: Batch AI Operations
tags: explanation, learning, documentation
---

Please explain the following code in detail:

{{FILE_CONTENT}}

Provide:
1. High-level overview of what the code does
2. Explanation of key algorithms or logic
3. Description of important functions/methods
4. Any design patterns used
5. Potential use cases or applications

Make the explanation clear for someone learning this codebase.`
                }
            ];

            for (const prompt of defaultPrompts) {
                const filePath = path.join(this.promptsFolder, `${prompt.name}.prompt.md`);
                await fs.writeFile(filePath, prompt.content);
            }

            vscode.window.showInformationMessage('Created default prompt templates');
            
            // Reload prompts
            await this.loadPrompts();
        } catch (error) {
            console.error('Error creating default prompts:', error);
        }
    }

    getPrompts(): Prompt[] {
        return this.prompts;
    }

    getPrompt(name: string): Prompt | undefined {
        return this.prompts.find(prompt => prompt.name === name);
    }

    async createPrompt(name: string, content: string): Promise<void> {
        const filePath = path.join(this.promptsFolder, `${name}.prompt.md`);
        await fs.writeFile(filePath, content);
        await this.refresh();
    }
}