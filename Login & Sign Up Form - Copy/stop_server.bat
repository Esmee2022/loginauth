@echo off
rem -------------------------------------------------
rem Stop Server – double‑click to terminate the auth server
rem -------------------------------------------------
title Secure Auth Server (HTTPS) – Stop

rem Attempt to gracefully stop the Node.js process used by the server
rem This assumes the server is the only running "node.exe" instance.
taskkill /im node.exe /f
nrem If you have other Node.js processes running, you may need to adjust the command.
pause
