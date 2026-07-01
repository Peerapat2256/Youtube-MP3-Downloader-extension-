# YouTube MP3 Downloader Extension

A browser extension designed to download and convert YouTube videos into MP3 audio formats, utilizing a Python native messaging host.

## Features

* **Chrome Extension UI**: Simple popup interface to trigger download actions.
* **Background Scripting**: Handles message passing between the webpage and the native host.
* **Native Messaging Integration**: Connects the extension to a local Python server for downloading and converting tasks.
* **Registry Scripts**: Windows batch scripts (`register_host.bat` and `install.reg`) to easily register the native host in the registry.

## How to Install

### 1. Install the Extension
1. Open Google Chrome and navigate to `chrome://extensions/`.
2. Enable **Developer mode** in the top right.
3. Click **Load unpacked** and select this project directory.

### 2. Configure the Native Host
1. Run `register_host.bat` as Administrator to register the native messaging host in the Windows Registry.
2. Ensure you have Python installed, along with required download libraries (e.g. `yt-dlp`).
3. Download `ffmpeg.exe` and `ffprobe.exe` and place them inside the `native-app/` directory (these are excluded from the repository due to file size limits).
4. Run `run_server.bat` to start the backend listener.
