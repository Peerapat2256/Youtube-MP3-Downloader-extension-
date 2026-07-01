@echo off
setlocal

set "PYTHON=C:\Users\keenz\AppData\Local\Programs\Python\Python312\python.exe"
set "PROXY=C:\Users\keenz\YT_Downloader_Extension\native-app\yt_proxy.py"
set "APP_JSON=C:\Users\keenz\YT_Downloader_Extension\native-app\app.json"
set "HOST=com.yt.downloader"
set "EXT_EDGE=chrome-extension://gideepikgphlpecnogcolgoacedhicia/"

echo ============================================================
echo  YT Downloader - Fix Native Messaging
echo ============================================================
echo.

REM -- Write clean app.json (no BOM, pure ASCII-safe UTF-8)
echo Writing app.json...
%PYTHON% -c ^
"import json, sys; d={'name':'com.yt.downloader','description':'YT Downloader Backend Proxy','path':r'C:\Users\keenz\AppData\Local\Programs\Python\Python312\python.exe','args':['-u',r'C:\Users\keenz\YT_Downloader_Extension\native-app\yt_proxy.py'],'type':'stdio','allowed_origins':['chrome-extension://gideepikgphlpecnogcolgoacedhicia/','extension://gideepikgphlpecnogcolgoacedhicia/']}; open(r'C:\Users\keenz\YT_Downloader_Extension\native-app\app.json','w',encoding='utf-8',newline='\n').write(json.dumps(d,indent=2))"

if errorlevel 1 (
    echo [FAIL] Could not write app.json
    pause
    exit /b 1
)
echo [OK] app.json written

REM -- Register for Microsoft Edge (HKCU)
echo Registering Edge registry key...
reg add "HKCU\Software\Microsoft\Edge\NativeMessagingHosts\%HOST%" /ve /t REG_SZ /d "%APP_JSON%" /f >nul 2>&1
if errorlevel 1 (
    echo [FAIL] Registry write failed
) else (
    echo [OK] Edge registry key set
)

REM -- Also register for Chrome (in case Chrome is used too)
reg add "HKCU\Software\Google\Chrome\NativeMessagingHosts\%HOST%" /ve /t REG_SZ /d "%APP_JSON%" /f >nul 2>&1
echo [OK] Chrome registry key set

REM -- Verify
echo.
echo ============================================================
echo  Verification
echo ============================================================
%PYTHON% -c ^
"import winreg,os,json; key=r'Software\Microsoft\Edge\NativeMessagingHosts\com.yt.downloader'; k=winreg.OpenKey(winreg.HKEY_CURRENT_USER,key); v,_=winreg.QueryValueEx(k,''); print('  Edge registry ->', v); print('  File exists:', os.path.exists(v)); d=json.load(open(v)); print('  name:', d['name']); print('  path:', d['path']); [print('  origin:', o) for o in d['allowed_origins']]"

echo.
echo ============================================================
echo  DONE - Now do these steps:
echo ============================================================
echo.
echo  1. Close Microsoft Edge COMPLETELY (all windows)
echo  2. Reopen Edge
echo  3. Go to edge://extensions
echo  4. Click Reload button on YT Downloader extension
echo  5. Go to YouTube and try downloading
echo.
pause
