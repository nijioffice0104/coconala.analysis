@echo off
setlocal
cd /d "%~dp0"

set "BROWSER_EXE=%ProgramFiles%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER_EXE%" set "BROWSER_EXE=%LocalAppData%\Google\Chrome\Application\chrome.exe"
if not exist "%BROWSER_EXE%" set "BROWSER_EXE=%ProgramFiles%\Microsoft\Edge\Application\msedge.exe"
if exist "%BROWSER_EXE%" goto browser_found
goto missing_browser

:browser_found
start "" "%BROWSER_EXE%" --remote-debugging-port=9222 --user-data-dir="%~dp0browser-profile" "https://coconala.com/mypage/analytics"
echo Login browser started.
echo Please log in to Coconala in the opened browser.
goto done

:missing_browser
echo Chrome or Edge was not found.
pause

:done
endlocal
