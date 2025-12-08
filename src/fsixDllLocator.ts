import * as vscode from 'vscode';
import { spawn } from "child_process";
import { access, readFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

type DefaultToolResult = 'local' | 'global' | undefined;
const runProcess = (name: string, args: string[], token: vscode.CancellationToken, cwd?: string) => 
  new Promise<number>((accept, reject) => {
    spawn(name, args, {cwd}).on('exit', n => accept(n ?? -1));
    token.onCancellationRequested(() => reject());
  });
async function loadDefaultTool(token: vscode.CancellationToken, currentDir?: string): Promise<DefaultToolResult> {
  if (await globalToolExists()) {
    return 'global';
  }
  if (await localToolExists(currentDir)) {
    return 'local';
  }

  const downloadTool = await vscode.window.showWarningMessage("FsiX.Daemon was not found. Download it from Nuget?", "Yes (globally)", "Yes (locally)", "No");
  switch (downloadTool) {
    case "Yes (globally)":
      await runProcess("dotnet", ["tool", "install", "-g", "FsiX.Daemon"], token);
      return await loadDefaultTool(token, currentDir);
    case "Yes (locally)":
      await runProcess("dotnet", ["tool", "install", "FsiX.Daemon"], token, currentDir);
      return await loadDefaultTool(token, currentDir);
    default: 
      return;
  }
}
function globalToolExists() {
  const daemonBinary = os.platform() == 'win32' ? "fsix-daemon.exe" : 'fsix-daemon';
  const toolDir = path.join(os.homedir(), ".dotnet", "tools", daemonBinary);
  return access(toolDir).then(() => true).catch(() => false);
}
async function localToolExists(currentDir?: string) {
  async function localToolExists(manifestPath: string) {
    try {
      await access(manifestPath);
      const rawContents = await readFile(manifestPath, "utf8");
      const contents = JSON.parse(rawContents);
      return contents?.tools?.["fsix.daemon"] !== undefined;

    }
    catch {
      return false;
    }
  }
  currentDir ??= process.cwd();
  const manifestPathA = path.join(currentDir, "dotnet-tools.json");
  const manifestPathB = path.join(currentDir, ".config", "dotnet-tools.json");
  return await localToolExists(manifestPathA) || await localToolExists(manifestPathB);
}


export async function runFsiXDaemonProcess(fsixInitLine: string, ct: vscode.CancellationToken) {
  const projectArgs = fsixInitLine.split(' ').filter((arg, i) => i !== 0 && arg !== '');
  const currentDir = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  const commandString = vscode.workspace.getConfiguration('fsixNotebook.settings').get<string>('fsixCommand') ?? 'default';
  if (commandString === 'default') {
    const toolType = await loadDefaultTool(ct, currentDir);
    switch(toolType) {
      case 'local':
        return spawn("dotnet", ["tool", "run", "fsix-daemon", ...projectArgs], {cwd: currentDir});
      case 'global':
        return spawn("fsix-daemon", projectArgs, {cwd: currentDir});
      default:
        return;
    }
  }
  else {
    const splittedCommand = commandString.split(' ');
    const binary = splittedCommand[0];
    const commandArgs = splittedCommand.splice(1);
    return spawn(binary, commandArgs.concat(projectArgs), {cwd: currentDir});

  }
}
