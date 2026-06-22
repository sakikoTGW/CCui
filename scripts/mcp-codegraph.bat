@echo off
setlocal
rem Portable codegraph MCP launcher — repo root from this script dir, no hardcoded drive.
set "ROOT=%~dp0.."
pushd "%ROOT%" || (
  echo [mcp-codegraph] cannot cd to repo root: %ROOT%
  exit /b 1
)
if not defined CODEGRAPH_NO_DAEMON set "CODEGRAPH_NO_DAEMON=1"
codegraph serve --mcp --path "%CD%"
set "EC=%ERRORLEVEL%"
popd
exit /b %EC%
