import * as vscode from 'vscode';
import * as fsix from './fsixManager';

export function registerLanguageProviders() {
  addDiagnostics();
  const completionProvider = new FsiXCompletionProvider();
  vscode.languages.registerCompletionItemProvider({notebookType: 'fsix-notebook'}, completionProvider);
  vscode.languages.registerCompletionItemProvider({scheme: 'vscode-interactive-input', language: 'fsharp'}, completionProvider);
}

function addDiagnostics() {
  let timeout: NodeJS.Timeout | null = null;
  const delay = 300; // ms
  const diagnostics = vscode.languages.createDiagnosticCollection('fsix-notebook');

  async function handleChange(event: vscode.TextDocumentChangeEvent) {
    if(event.document.languageId !== 'fsharp') {
      return;
    }
    const connection = fsix.getConnectionForDocument(event.document);
    if(connection !== undefined) {
      const fsDiagnostics = await connection.getDiagnostics(event.document.getText());
      const newDiagnostics = fsDiagnostics.map(d => {
        let severity;
        switch (d.severity) {
          case 'Error':
            severity = vscode.DiagnosticSeverity.Error;
            break;
          case 'Hidden':
            severity = vscode.DiagnosticSeverity.Hint;
            break;
          case 'Info':
            severity = vscode.DiagnosticSeverity.Information;
            break;
          case 'Warning':
            severity = vscode.DiagnosticSeverity.Warning;
            break;
        }
        const startPos = new vscode.Position(d.range.startLine - 1, d.range.startColumn);
        const endPos = new vscode.Position(d.range.endLine - 1, d.range.endColumn);
        const range = new vscode.Range(startPos, endPos);
        return new vscode.Diagnostic(range, d.message, severity);
      });
      diagnostics.set(event.document.uri, newDiagnostics);
    }
  }
  vscode.workspace.onDidChangeTextDocument(e => {
      if (timeout) clearTimeout(timeout);
      timeout = setTimeout(() => {
          handleChange(e);
      }, delay);
  });
}

export class FsiXCompletionProvider implements vscode.CompletionItemProvider {
    async provideCompletionItems(document: vscode.TextDocument, position: vscode.Position): Promise<vscode.CompletionItem[]> {
      const connection = fsix.getConnectionForDocument(document);
      if(connection === undefined) {
        return [];
      }
      const text = document.getText()
      const caret = document.getText(new vscode.Range(new vscode.Position(0, 0), position)).length;
      const words = document.getText(new vscode.Range(new vscode.Position(position.line, 0), position)).split(" ")
      const word = words.length == 0 ? "" : words[words.length - 1];
      
      const items = await connection.getCompletions(text, caret, word);
      return items.map(item => {
        const res = new vscode.CompletionItem(item.displayText);
        res.filterText = item.replacementText;
        res.insertText = item.replacementText;
        if(item.description !== null) {
          const docString = ["```fsharp", item.description, "```"].join("\n");
          res.documentation = new vscode.MarkdownString(docString);
        }
        res.kind = (vscode.CompletionItemKind as any)[item.kind];
        return res;
      });
    }

}
