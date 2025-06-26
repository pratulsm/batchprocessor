import * as vscode from 'vscode';
import axios from 'axios';

export interface LLMResponse {
    content: string;
    model?: string;
    usage?: {
        promptTokens?: number;
        completionTokens?: number;
        totalTokens?: number;
    };
}

export interface LLMRequest {
    prompt: string;
    model?: string;
    temperature?: number;
    maxTokens?: number;
}

export class LLMProvider {
    private provider: 'vscode.lm' | 'ollama' = 'vscode.lm';
    private ollamaEndpoint: string = 'http://localhost:11434';
    private availableModels: string[] = [];

    constructor() {
        this.updateConfiguration();
    }

    updateConfiguration() {
        const config = vscode.workspace.getConfiguration('batchAI');
        this.provider = config.get<'vscode.lm' | 'ollama'>('llmProvider', 'vscode.lm');
        this.ollamaEndpoint = config.get<string>('ollamaEndpoint', 'http://localhost:11434');
        this.refreshAvailableModels();
    }

    private async refreshAvailableModels() {
        if (this.provider === 'vscode.lm') {
            try {
                this.availableModels = (await vscode.lm.selectChatModels()).map(model => model.id);
            } catch (error) {
                console.error('Error getting VSCode LM models:', error);
                this.availableModels = [];
            }
        } else if (this.provider === 'ollama') {
            try {
                const response = await axios.get(`${this.ollamaEndpoint}/api/tags`);
                this.availableModels = response.data.models?.map((model: any) => model.name) || [];
            } catch (error) {
                console.error('Error getting Ollama models:', error);
                this.availableModels = [];
            }
        }
    }

    async getAvailableModels(): Promise<string[]> {
        if (this.availableModels.length === 0) {
            await this.refreshAvailableModels();
        }
        return this.availableModels;
    }

    async selectModel(): Promise<string | undefined> {
        const models = await this.getAvailableModels();
        
        if (models.length === 0) {
            vscode.window.showErrorMessage(`No models available for ${this.provider}`);
            return undefined;
        }

        if (models.length === 1) {
            return models[0];
        }

        return await vscode.window.showQuickPick(models, {
            placeHolder: `Select a model from ${this.provider}`
        });
    }

    async sendRequest(request: LLMRequest): Promise<LLMResponse> {
        if (this.provider === 'vscode.lm') {
            return await this.sendVSCodeLMRequest(request);
        } else if (this.provider === 'ollama') {
            return await this.sendOllamaRequest(request);
        } else {
            throw new Error(`Unsupported provider: ${this.provider}`);
        }
    }

    private async sendVSCodeLMRequest(request: LLMRequest): Promise<LLMResponse> {
        try {
            const models = await vscode.lm.selectChatModels({
                vendor: 'copilot',
                family: request.model ? undefined : 'gpt-4'
            });

            if (models.length === 0) {
                throw new Error('No language models available');
            }

            const model = models[0];
            const messages = [vscode.LanguageModelChatMessage.User(request.prompt)];
            
            const chatRequest = await model.sendRequest(messages, {}, new vscode.CancellationTokenSource().token);
            
            let content = '';
            for await (const fragment of chatRequest.text) {
                content += fragment;
            }

            return {
                content,
                model: model.id
            };
        } catch (error) {
            throw new Error(`VSCode LM error: ${error}`);
        }
    }

    private async sendOllamaRequest(request: LLMRequest): Promise<LLMResponse> {
        try {
            const response = await axios.post(`${this.ollamaEndpoint}/api/generate`, {
                model: request.model || 'llama2',
                prompt: request.prompt,
                stream: false,
                options: {
                    temperature: request.temperature || 0.7,
                    num_predict: request.maxTokens || -1
                }
            });

            return {
                content: response.data.response,
                model: request.model,
                usage: {
                    promptTokens: response.data.prompt_eval_count,
                    completionTokens: response.data.eval_count,
                    totalTokens: (response.data.prompt_eval_count || 0) + (response.data.eval_count || 0)
                }
            };
        } catch (error) {
            if (axios.isAxiosError(error)) {
                throw new Error(`Ollama error: ${error.response?.data?.error || error.message}`);
            }
            throw new Error(`Ollama error: ${error}`);
        }
    }

    async testConnection(): Promise<boolean> {
        try {
            if (this.provider === 'vscode.lm') {
                const models = await vscode.lm.selectChatModels();
                return models.length > 0;
            } else if (this.provider === 'ollama') {
                const response = await axios.get(`${this.ollamaEndpoint}/api/tags`, { timeout: 5000 });
                return response.status === 200;
            }
            return false;
        } catch (error) {
            console.error('Connection test failed:', error);
            return false;
        }
    }
}