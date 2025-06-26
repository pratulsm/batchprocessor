import * as vscode from 'vscode';

export interface Task {
    label?: string;
    command: string;
    arguments?: any;
    aiPrompt?: string; // Add optional aiPrompt property to Task interface
}

export class TaskManager {
    private tasks: Task[] = [];

    constructor() {
        this.refresh();
    }

    public async refresh(): Promise<void> {
        const config = vscode.workspace.getConfiguration('batchAI');
        this.tasks = await vscode.commands.executeCommand<Task[]>('batchAI.getTasks') || [];
    }

    public getTasks(): Task[] {
        return this.tasks;
    }
}
