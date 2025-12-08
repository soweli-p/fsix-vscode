import * as rpc from 'vscode-jsonrpc/node';
import * as cp from 'child_process';

import * as net from 'net';

export type EvalRequest = {
  code: string
  args: any
}

export type LogLevel = 'Error' | 'Debug' | 'Info' | 'Warning'
export type DiagnosticSeverity = 'Error' | 'Hidden' | 'Info' | 'Warning'
type LogNotification = {
  level: LogLevel
  message: string
}

type Range = {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}
export type Diagnostic = {
  message: string
  subcategory: string
  severity: DiagnosticSeverity
  range: Range
}
export type CsException = {
  ClassName: string
  Message: string
  InnerException: CsException | null
  StackTraceString: string | null
  AssemblyName: string
  Source: string | null
  HResult: number
}

export type CompletionItem = {
  displayText: string
  replacementText: string
  kind: string
  description: string | null
}

export function csToJsError(csException: CsException): Error {
  const jsErr = Object.create(Error.prototype);
  jsErr.message = csException.Message;
  jsErr.name = csException.ClassName
  jsErr.stack = csException.StackTraceString ?? undefined;
  
  if (csException.InnerException != null) {
    jsErr.cause = csToJsError(csException.InnerException);
  }

  return jsErr;
}
export type Result<T, E> = { case: 'ok', data: T} | {case: 'error'; error: E}

export type EvalResult = {
  evaluationResult: Result<string, CsException>
  evaluatedCode: string
  metadata: any
  diagnostics: Diagnostic[]
}

export type InitFailure =
  | {reason: 'csException', exception: CsException}
  | {reason: 'processExited', code: number}
  | {reason: 'other', error: Error}


export type FsiXConnection = {
  eval: (request: EvalRequest, ct: rpc.CancellationToken) => Promise<EvalResult>
  getCompletions: (text: string, caret: number, word: string) => Promise<CompletionItem[]>
  getDiagnostics: (text: string) => Promise<Diagnostic[]>,
  isRunning: () => boolean,
  dispose: () => void
}

export async function mkRpcConnection(process: cp.ChildProcessWithoutNullStreams, onLog: (n: LogNotification) => void) {

  const m = await new Promise<string>((accept, reject) => {
    process.stdout.on('data', data => accept(data.toString()));
    process.stderr.on('data', reject);
  });
  const [_, ip, port] = m.trim().replace(/\s/g, "").split(":");
  const socket = net.connect(Number(port), ip);
  socket.setNoDelay(true);
  process.on('exit', () => socket.destroy());
    
  const fsixConnection = rpc.createMessageConnection(
    new rpc.StreamMessageReader(socket),
    new rpc.StreamMessageWriter(socket));

  const evalRt = new rpc.RequestType1<EvalRequest, any, EvalResult>('eval');
  const completionsRt = new rpc.RequestType3<string, number, string, any, EvalResult>('autocomplete');
  const diagnosticsRt = new rpc.RequestType1<string, any, Diagnostic[]>('diagnostics');

  const logNt = new rpc.NotificationType<LogNotification>('logging');
  const initRt = new rpc.NotificationType<Result<null, CsException>>('initialized');

  fsixConnection.onNotification(logNt, onLog);

  let isRunning = true;
  const manager = {
    eval: (request: EvalRequest, ct: rpc.CancellationToken) => fsixConnection.sendRequest(evalRt, request, ct),
    getCompletions: (text: string, caret: number, word: string) => fsixConnection.sendRequest(completionsRt, text, caret, word, rpc.CancellationToken.None),
    getDiagnostics: (text: string) => fsixConnection.sendRequest(diagnosticsRt, text),
    isRunning: () => isRunning,
    dispose: () => {
        socket.destroy();
        process.kill();
      }
  };


  fsixConnection.listen();
  return await new Promise<Result<FsiXConnection, InitFailure>>(accept => {
    fsixConnection.onNotification(initRt, initResult => {
      switch (initResult.case) {
        case 'ok': 
          accept({case: 'ok', data: manager});
          return;
        case 'error':
          accept({case: 'error', error: {reason: 'csException', exception: initResult.error }});
      }
    });
    process.on('error', e => {
      accept({case: 'error', error: {reason: 'other', error: e}});
    });
    process.on('exit', code => {
      accept({case: 'error', error: {reason: 'processExited', code: code ?? -1 }});
      isRunning = false;
    });

    if(process.exitCode !== null) {
      accept({case: 'error', error: {reason: 'processExited', code: process.exitCode ?? -1 }});
      isRunning = false;
    }
  })


}
