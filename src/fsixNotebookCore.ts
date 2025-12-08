import * as vscode from 'vscode';
import * as fsix from './fsixManager';
import * as utils from './utils';


export function registerFsixNotebooks(context: vscode.ExtensionContext) {
  vscode.workspace.registerNotebookSerializer('fsix-notebook', new FsiXNotebookSerializer());

  const notebookCore = new FsiXNotebookCore();
  const replCore = new FsiXNotebookCore(true);
  context.subscriptions.push(notebookCore);
  context.subscriptions.push(replCore);
  vscode.workspace.onDidCloseNotebookDocument(fsix.dropConnection);


  const execCell = async (cell: vscode.NotebookCell, args: any) => {
    if(cell.notebook.notebookType === 'interactive') {
      await replCore.doExecution(cell, cell.notebook, args);
    } else {
      await notebookCore.doExecution(cell, cell.notebook, args);
    }
  };

  vscode.commands.registerCommand('fsixNotebook.cell.evalWithReload', async (cell: vscode.NotebookCell) => { await execCell(cell, {hotReload: true})});
  vscode.commands.registerCommand('fsixNotebook.cell.evalWithoutReload', async (cell: vscode.NotebookCell) => { await execCell(cell, {hotReload: false})});
}

export class FsiXNotebookCore {
  readonly controllerId: 'fsix-notebook-id'| 'fsix-notebook-interactive-id';
  readonly notebookType: 'fsix-notebook' | 'interactive';
  readonly label = 'FsiX Notebook';
  readonly supportedLanguages = ['fsharp'];

  private readonly _controller: vscode.NotebookController;
  private _executionOrder = 0;

  readonly isInteractive: boolean;
  readonly ctsMap: Record<string, vscode.CancellationTokenSource> = {}

  constructor(isInteractive?: boolean) {
    this.notebookType = isInteractive ? 'interactive' : 'fsix-notebook';
    this.controllerId = isInteractive ? 'fsix-notebook-interactive-id' : 'fsix-notebook-id';
    this.isInteractive = isInteractive ?? false;
    this._controller = vscode.notebooks.createNotebookController(
      this.controllerId,
      this.notebookType,
      this.label
    );

    this._controller.supportedLanguages = this.supportedLanguages;
    this._controller.supportsExecutionOrder = true;
    if (isInteractive) {
      this._controller.interruptHandler = (n: vscode.NotebookDocument) => {
        this.ctsMap[n.uri.path]?.cancel();
      };
      this._controller.onDidChangeSelectedNotebooks(e => {
        if(e.selected) {
          this.ctsMap[e.notebook.uri.path] = new vscode.CancellationTokenSource();
        } 
      })
    }
    this._controller.executeHandler = this._execute.bind(this);
  }

  private async _execute(
    cells: vscode.NotebookCell[],
    _notebook: vscode.NotebookDocument,
    _controller: vscode.NotebookController
  ): Promise<void> {
      for (let cell of cells) {
        await this.doExecution(cell, _notebook, {hotReload: true});
      }
  }

  async doExecution(cell: vscode.NotebookCell, notebook: vscode.NotebookDocument, args: Record<string, any>): Promise<void> {

    const execution = this._controller.createNotebookCellExecution(cell);
    execution.executionOrder = ++this._executionOrder;
    execution.start(Date.now());

    if (cell.index === 0) {
        const initCellResult = await fsix.executeInitCell(cell, execution, this.ctsMap[notebook.uri.path]?.token);
        switch (initCellResult.case) {
          case 'ok': 
            fsix.assignConnection(notebook, initCellResult.data);
            execution.end(true, Date.now());
            break;
          default:
            execution.end(false, Date.now());
      }
    } else {
        const isSuccess = await this._executeRegularCell(cell, execution, notebook, args);
        execution.end(isSuccess, Date.now());
    }
  }

  private async _executeRegularCell(cell: vscode.NotebookCell, execution: vscode.NotebookCellExecution, notebook: vscode.NotebookDocument, args: Record<string, any>) { 

    let connection = fsix.getConnectionForNotebook(notebook);
    execution.clearOutput(cell);

    const logToExecution = utils.logToExecution (cell) (execution);

    if(connection === undefined || !connection.isRunning()) {
      const initCell = cell.notebook.cellAt(0);
      logToExecution("Initializing FsiX first...", false);
      const connectionResult = await fsix.executeInitCell(initCell, execution, this.ctsMap[notebook.uri.path]?.token);
      switch (connectionResult.case) {
        case 'ok': 
          connection = connectionResult.data;
          fsix.assignConnection(notebook, connection);
          break;
        case 'error':
          logToExecution("Failed to initialize FsiX!", true);
          return false;
      }
    }

    return await fsix.executeRegularCell(connection, cell, execution, args, this.ctsMap[notebook.uri.path]?.token);
}

  public dispose() {}
}

type SerializableCellOutputItem = {
		mime: string;
		data: string;
}
type SerializableCellOutput = {
  items: SerializableCellOutputItem[]
}
type SerializableCell = {
  value: string
  outputs?: SerializableCellOutput[]
  metadata?: { [key: string]: any }
}
export class FsiXNotebookSerializer implements vscode.NotebookSerializer {
  private readonly decoder = new TextDecoder();
  private readonly encoder = new TextEncoder();

  deserializeNotebook(content: Uint8Array): vscode.NotebookData | Thenable<vscode.NotebookData> {
    try {
      const cellObjects: SerializableCell[] = JSON.parse(this.decoder.decode(content))?.cells ?? [];
      const cells = cellObjects.map(cellObj => {
        const cell = new vscode.NotebookCellData(vscode.NotebookCellKind.Code, cellObj.value, "fsharp");
        cell.outputs = cellObj?.outputs?.map(cellOutputObj => 
            new vscode.NotebookCellOutput(cellOutputObj.items.map(
              cellItem => new vscode.NotebookCellOutputItem(this.encoder.encode(cellItem.data), cellItem.mime)))
        );
        cell.metadata = cellObj.metadata;
        return cell;
      });
      return new vscode.NotebookData(cells);
    }
    catch {
      return new vscode.NotebookData([]);
    }
  }
  serializeNotebook(data: vscode.NotebookData): Uint8Array | Thenable<Uint8Array> {
    const serializableCells: SerializableCell[] = data.cells.map(cell => 
    ({
      value: cell.value,
      metadata: cell.metadata,
      outputs: cell.outputs?.map(output => ({items: output.items.map(item => ({data: this.decoder.decode(item.data), mime: item.mime}))}))
    }));
    const obj = {cells: serializableCells};
    return this.encoder.encode(JSON.stringify(obj));
  }

}
