import * as vscode from 'vscode';

export const logToExecution = (cell: vscode.NotebookCell) => (execution: vscode.NotebookCellExecution) => (message: string, stderr?: boolean) => 
  execution.appendOutput(
      new vscode.NotebookCellOutput([
        stderr ? vscode.NotebookCellOutputItem.stderr(message) : vscode.NotebookCellOutputItem.stdout(message)
      ]), cell);
export const logError = (cell: vscode.NotebookCell) => (execution: vscode.NotebookCellExecution) => (error: Error) => 
    execution.appendOutput(
        new vscode.NotebookCellOutput([
          vscode.NotebookCellOutputItem.error(error)
        ]), cell);

