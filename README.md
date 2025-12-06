# FsiX-VSCode

Proper REPL support for F# in VS Code! Uses [FsiX](https://github.com/soweli-p/FsiX) as backend.

[image]

## Features


You can create either VS Code's repl window, or saveable notebook window. Both of them, support these features:

 - Autocompletion, syntax and error highlightning right in the input box. All of these features use your current REPL's state as a context.
 - `.fsproj` and `.sln`/`.slnx` support.
 - Hot reloading! If you havent changed type signature of your functions, there is no need to recompile your code, relaunch or reevaluate everything - FsiX will patch even already running code.
 - Inline Async, Task and any other computation expressions. FsiX will rewrite code like `let! res = doSmthAsync()` into synchronous code, so debugging async code is way easier now.

## Requirements

- You need .NET 10.0 SDK installed.
- Extension also needs [FsiX.Daemon](https://github.com/soweli-p/FsiX/pkgs/nuget/FsiX.Daemon), but it will try to install it automatically.

## Extension Settings

Currently there is only one setting:

* `fsixNotebook.settings.fsixCommand`: Provide custom command to run FsiX.

## Known Issues

- Inline async expressions are marked as errors by intellisense. Will be fixed soon!
- Even if extension gives fsix context regarding currently openned file, auto-opening of modules is still not perfect.

## Release Notes

### 0.1.0

Initial release.

---

**Enjoy!**
