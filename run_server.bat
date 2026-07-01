@echo off
title YT Downloader Server
echo ============================================================
echo  YT Smart Downloader - Local Server
echo ============================================================
echo.
echo  Keep this window open while using the extension.
echo  Press Ctrl+C to stop the server.
echo.
echo  Starting server on ws://localhost:9099 ...
echo.
C:\Users\keenz\AppData\Local\Programs\Python\Python312\python.exe -u "C:\Users\keenz\YT_Downloader_Extension\native-app\yt_server.py"
echo.
echo Server stopped. Press any key to exit.
pause >nul
