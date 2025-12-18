# Change Log

All notable changes to the "fsix-vscode" extension will be documented in this file.

Check [Keep a Changelog](http://keepachangelog.com/) for recommendations on how to structure this file.

## [0.0.2] - 2025-12-18

### Changed

- Use tcp sockets instead of stdio. Now, stdout in your app doesnt break fsix
- Dispose of connections and processes for closed notebooks
- Fixed cancellation support, for both notebooks and repls 

