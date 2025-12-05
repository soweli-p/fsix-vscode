import * as vscode from 'vscode';
import { spawn } from "child_process";
import { access, readFile } from "fs/promises";
import * as path from "path";
import * as os from "os";

type DefaultToolResult = 'local' | 'global' | undefined;
const runProcess = (name: string, args: string[], cwd?: string) => new Promise<number>(accept => spawn(name, args, {cwd}).on('exit', n => accept(n ?? -1)));
async function loadDefaultTool(currentDir?: string): Promise<DefaultToolResult> {
  if (await globalToolExists()) {
    return 'global';
  }
  if (await localToolExists(currentDir)) {
    return 'local';
  }

  const downloadTool = await vscode.window.showWarningMessage("FsiX.Daemon was not found. Download it from Nuget?", "Yes (globally)", "Yes (locally)", "No");
  switch (downloadTool) {
    case "Yes (globally)":
      await runProcess("dotnet", ["tool", "install", "-g", "FsiX.Daemon"]);
      return await loadDefaultTool(currentDir);
    case "Yes (locally)":
      await runProcess("dotnet", ["tool", "install", "FsiX.Daemon"], currentDir);
      return await loadDefaultTool(currentDir);
    default: 
      return;
  }
}
function globalToolExists() {
  const toolDir = path.join(os.homedir(), ".dotnet", "tools", "fsix-daemon");
  return access(toolDir).then(() => true).catch(() => false);
}
async function localToolExists(currentDir?: string) {
  const manifestPath = path.join(currentDir ?? process.cwd(), "dotnet-tools.json");
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


export async function runFsiXDaemonProcess(fsixInitLine: string) {
  const projectArgs = fsixInitLine.split(' ').filter((arg, i) => i !== 0 && arg !== '');
  const currentDir = vscode.workspace.workspaceFolders?.[0]?.uri?.fsPath;
  const commandString = vscode.workspace.getConfiguration('fsixNotebook.settings').get<string>('fsixCommand') ?? 'default';
  if (commandString === 'default') {
    const toolType = await loadDefaultTool(currentDir);
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
