@echo off
setlocal
cd /d "%~dp0"

if not exist "%~dp0runtime\node.exe" goto missing_runtime

netstat -ano | findstr /C:"127.0.0.1:4173" | findstr /C:"LISTENING" >nul
if errorlevel 1 (
  start "" /b "%~dp0runtime\node.exe" "%~dp0server.mjs" >nul 2>&1
  for /l %%i in (1,1,20) do (
    netstat -ano | findstr /C:"127.0.0.1:4173" | findstr /C:"LISTENING" >nul
    if not errorlevel 1 goto server_ready
    timeout /t 1 /nobreak >nul
  )
)

:server_ready

set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER_EXE%" set "BROWSER_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER_EXE%" set "BROWSER_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%BROWSER_EXE%" goto browser_found
goto fallback_browser

:browser_found
start "" "%BROWSER_EXE%" --remote-debugging-port=9222 --user-data-dir="%~dp0browser-profile" "http://127.0.0.1:4173/" "https://coconala.com/mypage/analytics"
goto done

:fallback_browser
explorer.exe "http://127.0.0.1:4173/"
echo Chrome or Edge was not found.
pause
goto done

:missing_runtime
echo Required runtime file is missing.
echo Please download the complete folder again.
pause

:done
endlocal
