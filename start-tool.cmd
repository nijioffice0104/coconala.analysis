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

set "BROWSER_EXE="
for %%P in ("%ProgramFiles%\Google\Chrome\Application\chrome.exe" "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" "%LocalAppData%\Google\Chrome\Application\chrome.exe" "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" "%LocalAppData%\Microsoft\Edge\Application\msedge.exe") do if not defined BROWSER_EXE if exist "%%~P" set "BROWSER_EXE=%%~P"
if defined BROWSER_EXE goto browser_found
goto fallback_browser

:browser_found
start "" "%BROWSER_EXE%" --remote-debugging-port=9222 --user-data-dir="%~dp0browser-profile" --new-window "http://127.0.0.1:4173/"
timeout /t 2 /nobreak >nul
start "" "%BROWSER_EXE%" --remote-debugging-port=9222 --user-data-dir="%~dp0browser-profile" --new-tab "https://coconala.com/mypage/analytics"
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
