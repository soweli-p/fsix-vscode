import * as vscode from 'vscode';

type Selection = {code: string, fileName: string}
export function addAllCommands(context: vscode.ExtensionContext) {
  const getSelection = () => {
    const editor = vscode.window.activeTextEditor;
    if (!editor) { return; }

    const selection = editor.selection;
    return {code: editor.document.getText(selection), fileName: editor.document.fileName};
  };

  vscode.workspace.onDidCloseNotebookDocument(doc => {
    if(doc === cachedNotebook) {
      cachedNotebook = null;
    }
  });
  vscode.commands.registerCommand('fsixNotebook.startRepl', async () => { await openRepl(false, context); });
  vscode.commands.registerCommand('fsixNotebook.createNotebook', async () => { await openNotebook(false); });
  vscode.commands.registerCommand('fsixNotebook.openRepl', async () => { await openRepl(false, context); });
  vscode.commands.registerCommand('fsixNotebook.openNotebook', async () => { await openNotebook(false); });

  vscode.commands.registerCommand('fsixNotebook.sendToRepl', async () => { await openRepl(true, context, getSelection()); });
  vscode.commands.registerCommand('fsixNotebook.sendToNotebook', async () => { await openNotebook(true, getSelection()); });
}

async function mkFsiXArgs() {
  async function getAllProjectFiles() {
    const pattern = '**/*.{sln,slnx,fsproj}';
    const exclude = '**/{bin,obj}/**'; // exclude all bin and obj folders
    return await vscode.workspace.findFiles(pattern, exclude);
  }
  const fileUris = await getAllProjectFiles();
  const files = fileUris.map(uri => uri.fsPath);
  files.push('none');
  const selectedFile = await vscode.window.showQuickPick(files, {
    title: "Select project or solution to load into FsiX.",
    canPickMany: false
  });

  if(!selectedFile) {
    return;
  }
  if(selectedFile.endsWith(".sln") || selectedFile.endsWith(".slnx")) {
    return `fsix --sln ${selectedFile}`;
  } else if (selectedFile.endsWith(".fsproj")) {
    return `fsix --proj ${selectedFile}`;
  } else if (selectedFile === 'none') {
    return `fsix`;
  }
}

const mkCell = (code: string) => new vscode.NotebookCellData(vscode.NotebookCellKind.Code, code, 'fsharp');
const mkInitCells = (fsixArgs: string, selection?: Selection) => {
  const initCell = mkCell(fsixArgs);
  if(selection){
    const codeCell = mkCell(selection.code);
    codeCell.metadata = {
      fileName: selection.fileName
    };
    return [initCell, codeCell];
  } else {
    return [initCell];
  }
  
}
async function applyEdit(notebookUri: vscode.Uri, edit: vscode.NotebookEdit) {
  const wsEdit = new vscode.WorkspaceEdit();
  wsEdit.set(notebookUri, [edit]);
  await vscode.workspace.applyEdit(wsEdit);
}



async function createRepl(preserveFocus: boolean, context: vscode.ExtensionContext, selection?: Selection) {
  const fsixArgs = await mkFsiXArgs();
  if(!fsixArgs) {
    return;
  }
  const { notebookUri, notebookEditor } = (await vscode.commands.executeCommand('interactive.open', 
          { viewColumn: vscode.ViewColumn.Beside, preserveFocus},
          undefined,
          `${context.extension.id}/fsix-notebook-interactive-id`,
          "FsiX REPL"
      ) as { notebookUri: vscode.Uri; notebookEditor: vscode.NotebookEditor });

  const edit = vscode.NotebookEdit.insertCells(0, mkInitCells(fsixArgs, selection));
  await applyEdit(notebookUri, edit);

  await vscode.commands.executeCommand(
      'notebook.cell.execute',
      { start: 0, end: selection ? 2 : 1 }, notebookUri
  );

  return notebookEditor.notebook;

}
async function createNotebook(preserveFocus: boolean, selection?: Selection) {
  const fsixArgs = await mkFsiXArgs();
  if(!fsixArgs) {
    return;
  }
  const notebook = await vscode.workspace.openNotebookDocument('fsix-notebook', new vscode.NotebookData(mkInitCells(fsixArgs, selection)));

  await vscode.window.showNotebookDocument(notebook, {viewColumn: vscode.ViewColumn.Beside, preserveFocus});
  await vscode.commands.executeCommand(
      'notebook.cell.execute',
      { start: 0, end: selection ? 2 : 1 }, notebook.uri
  );

  return notebook;
}


async function executeCode(notebook: vscode.NotebookDocument, selection: Selection) {
  const index = notebook.cellCount;
  const codeCell = mkCell(selection.code);
  codeCell.metadata = {
    fileName: selection.fileName 
  };
  const edit = vscode.NotebookEdit.insertCells(index, [codeCell]);

  await applyEdit(notebook.uri, edit);
  await vscode.commands.executeCommand(
        'notebook.cell.execute',
        { start: index, end: index+1}, notebook.uri
    );

}

let cachedNotebook: vscode.NotebookDocument | null = null;
async function openRepl(preserveFocus: boolean, context: vscode.ExtensionContext, selection?: Selection) { 
  if(!cachedNotebook) {
    cachedNotebook = await createRepl(preserveFocus, context, selection) ?? null;
    return;
  }

  if(!vscode.window.activeNotebookEditor) {
    vscode.window.showNotebookDocument(cachedNotebook, {viewColumn: vscode.ViewColumn.Beside, preserveFocus});
  }
  if(selection) {
    await executeCode(cachedNotebook, selection);
  }
}
async function openNotebook(preserveFocus: boolean, selection?: Selection) { 
  if(!cachedNotebook) {
    cachedNotebook = await createNotebook(preserveFocus, selection) ?? null;
    return;
  }

  if(!vscode.window.activeNotebookEditor) {
    vscode.window.showNotebookDocument(cachedNotebook, {viewColumn: vscode.ViewColumn.Beside, preserveFocus});
  }

  if(selection) {
    await executeCode(cachedNotebook, selection);
  }
}
