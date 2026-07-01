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
2. Ensure you have Python installed, and install the required libraries:
   ```bash
   pip install yt-dlp websockets
   ```
3. Download `ffmpeg.exe` and `ffprobe.exe` (since they are excluded from this repository due to GitHub's file size limits):
   * Download the latest release build from [gyan.dev FFmpeg Builds](https://www.gyan.dev/ffmpeg/builds/) (download `ffmpeg-release-essentials.zip`).
   * Extract the downloaded zip file.
   * Go to the extracted folder, enter the `bin/` directory, and copy both `ffmpeg.exe` and `ffprobe.exe` into the `native-app/` directory of this project.
4. Run `run_server.bat` to start the backend listener.
