import * as vscode from 'vscode';
import * as fsixRpc from './rpc';
import {Result, InitFailure} from './rpc';
import * as utils from './utils';
import { runFsiXDaemonProcess } from './fsixDllLocator';

export type FsiXConnection = fsixRpc.FsiXConnection

type NotebookUri = string
let _connections: Record<NotebookUri, FsiXConnection> = {};

function getInteractiveNotebookId(notebook: vscode.NotebookDocument) {
  const path = notebook.uri.path;
  const m = path.match(/-(\d+)\.interactive$/i);
  if(m && m.length > 1) {
    const i = m[1];
    return `interactive-${i}`;
  }
  else {
    vscode.window.showErrorMessage(`Cannot parse interactive notebook with path ${path}`);
  }
}
export function assignConnection(notebook: vscode.NotebookDocument, connection: FsiXConnection) {
  const path = notebook.uri.path;
  if(path.endsWith('.interactive')) {
    const interactiveId = getInteractiveNotebookId(notebook);
    if(interactiveId) {
      _connections[interactiveId] = connection;
    }
  }
  else {
    _connections[path] = connection;
  }
}

export function getConnectionForNotebook(notebook: vscode.NotebookDocument): FsiXConnection | undefined {
  const path = notebook.uri.path;
  if(path.endsWith('.interactive')) {
    const interactiveId = getInteractiveNotebookId(notebook);
    if(interactiveId) {
      return _connections[interactiveId];
    }
  }
  else {
    return _connections[path];
  }
}


export function getConnectionForDocument(document: vscode.TextDocument): FsiXConnection | undefined {
  const path = document.uri.path;
  if(document.uri.scheme === 'vscode-interactive-input') {
    const splitted = path.split('-');
    const number = splitted[splitted.length - 1];
    return _connections[`interactive-${number}`];
  } 
  else {
    return _connections[document.uri.path];
  }
}



export async function executeInitCell(initCell: vscode.NotebookCell, execution: vscode.NotebookCellExecution): Promise<Result<FsiXConnection, InitFailure>> {

  const logToExecution = utils.logToExecution (initCell) (execution);
  const logError = utils.logError (initCell) (execution);

  for (let cell of initCell.notebook.getCells()) {
    execution.clearOutput(cell);
  }

  let wasInitialized = false;
  try {

    const fsiXProcess = await runFsiXDaemonProcess(initCell.document.getText());
    if(!fsiXProcess) {
      return {case: 'error', error: {reason: 'other', error: new Error("Not able to locate fsix-daemon")}};
    }
    const channel = vscode.window.createOutputChannel("FsiX", {log: true});
    fsiXProcess.stderr.on('data', data => channel.error(data.toString()));



    const connectionResult = await fsixRpc.mkRpcConnection(fsiXProcess, ({level, message}) => {
      if(!wasInitialized) {
        logToExecution(message, level === 'Error');
      }
      switch (level) {
        case 'Info':
          channel.info(message);
        case 'Debug':
          channel.debug(message);
        case 'Error':
          channel.error(message);
        case 'Warning':
          channel.warn(message);
      }
    });

    switch (connectionResult.case) {
      case 'ok':
        logToExecution("Done!", false);
        wasInitialized = true;
        break;
      case 'error': 
        const error = connectionResult.error;
        switch (error.reason) {
          case 'csException':
            logError(fsixRpc.csToJsError(error.exception));
            break;
          case 'processExited':
            logToExecution(`FsiX process exited with code ${error.code}`, true);
            channel.show();
            break;
          case 'other': 
            logError(error.error);
            channel.show();
            break;
            
        }
    }

    return connectionResult;
  } 
  catch(err: any) {
    logError(err);
    return {case: 'error', error: {reason: 'other', error: err}};
  }
}

export async function executeRegularCell(connection: FsiXConnection, cell: vscode.NotebookCell, execution: vscode.NotebookCellExecution, args: Record<string, any>) {
  const logToExecution = utils.logToExecution (cell) (execution);
  const logError = utils.logError (cell) (execution);
  execution.clearOutput(cell);

  let combinedArgs: {[key: string]: any} = {};
  for(const [key, value] of Object.entries(cell.metadata)) {
    combinedArgs[key] = value;
  }
  for(const [key, value] of Object.entries(args)) {
    combinedArgs[key] = value;
  }


  try {
    const response = await connection.eval({code: cell.document.getText(), args: combinedArgs}) (execution.token);
      for (let d of response.diagnostics) {
        logToExecution(d.message, d.severity === 'Error');
      }

      let isSuccess = true;
      const evalRes = response.evaluationResult;
      if(response.metadata.stdout !== undefined && response.metadata.stdout !== "") {
        logToExecution (response.metadata.stdout, evalRes.case === 'error');
      }
      const outputs = [];
      switch (evalRes.case) {
        case 'ok':
          outputs.push(vscode.NotebookCellOutputItem.text(evalRes.data, "text/x-fsharp"));
          isSuccess = true;
          break;
        case 'error':
          outputs.push(vscode.NotebookCellOutputItem.error(fsixRpc.csToJsError(evalRes.error)));
          isSuccess = false;
          break;
      }

      outputs.push(vscode.NotebookCellOutputItem.json(response));

      execution.appendOutput(new vscode.NotebookCellOutput(outputs));
      if(response.metadata.reloadedMethods !== undefined) {
        for(let method in response.metadata.reloadedMethods) {
          logToExecution(`Method ${method} was updated`);
        }
      }
      return isSuccess;
  }
  catch (err: any) {
    logError(err);
    return false;

  }
}
