@echo off
rem -------------------------------------------------
rem Start Server – double-click to launch the auth server
rem -------------------------------------------------
title Secure Auth Server (HTTPS) – Start

rem Change to the project root (directory of this .bat file)
cd /d "%~dp0"

rem Ensure Node.js is available
where node >nul 2>&1
if errorlevel 1 (
    echo Node.js is not installed or not in PATH.
    pause
    exit /b 1
)

rem Run the server from the src folder
node src\server.js

rem Open default browser to the server URL if started successfully
if %errorlevel%==0 (
    start "" "http://127.0.0.1:3000"
) else (
    echo Failed to start server.
)

rem Keep the window open so you can see any output
pause
