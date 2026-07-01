import sys
import json
import struct
import subprocess
import os
import re

# STARTUP LOG - write immediately to prove this script was launched
try:
    _log_path = os.path.join(os.path.dirname(os.path.abspath(__file__)), "startup.log")
    with open(_log_path, "a") as _f:
        import datetime
        _f.write(f"[{datetime.datetime.now()}] yt_proxy.py started. args={sys.argv}\n")
except Exception:
    pass


# Function to read a message from standard input (Chrome Native Messaging protocol)
def get_message():
    raw_length = sys.stdin.buffer.read(4)
    if len(raw_length) == 0:
        sys.exit(0)
    message_length = struct.unpack('@I', raw_length)[0]
    message = sys.stdin.buffer.read(message_length).decode('utf-8')
    return json.loads(message)

# Function to write a message to standard output (Chrome Native Messaging protocol)
def send_message(message):
    encoded_message = json.dumps(message).encode('utf-8')
    sys.stdout.buffer.write(struct.pack('@I', len(encoded_message)))
    sys.stdout.buffer.write(encoded_message)
    sys.stdout.buffer.flush()

def main():
    try:
        # Add the native-app directory to PATH so yt-dlp finds ffmpeg.exe and ffprobe.exe
        script_dir = os.path.dirname(os.path.abspath(__file__))
        os.environ["PATH"] = script_dir + os.pathsep + os.environ.get("PATH", "")

        data = get_message()
        # Check if the command is to open the download folder
        if data.get("action") == "open_folder":
            save_folder = data.get("saveFolder")
            if save_folder and os.path.exists(save_folder):
                base_dir = os.path.normpath(save_folder)
            else:
                base_dir = os.path.join(os.path.expanduser("~"), "Downloads", "YT_Smart_Downloads")
                if not os.path.exists(base_dir):
                    os.makedirs(base_dir, exist_ok=True)
            
            if sys.platform == 'win32':
                os.startfile(base_dir)
            else:
                subprocess.Popen(["xdg-open", base_dir])
            
            send_message({"status": "success", "message": "Opened download folder"})
            return

        # Normal download workflow
        url = data.get("url")
        format_type = data.get("format")
        target = data.get("target")
        playlist_id = data.get("playlistId")
        save_folder = data.get("saveFolder")

        # Base download directory
        if save_folder:
            base_dir = os.path.normpath(save_folder)
        else:
            base_dir = os.path.join(os.path.expanduser("~"), "Downloads", "YT_Smart_Downloads")
            
        os.makedirs(base_dir, exist_ok=True)

        if target == "playlist":
            # Download playlist -> Save inside folder named after playlist title
            output_template = os.path.join(base_dir, "%(playlist_title)s", "%(playlist_index)s - %(title)s.%(ext)s")
            if playlist_id and not ("list=" in url):
                url = f"https://www.youtube.com/playlist?list={playlist_id}"
        else:
            # Download single video -> Sort into My_Music or My_Videos
            folder = "My_Music" if ("mp3" in format_type or "m4a" in format_type) else "My_Videos"
            output_template = os.path.join(base_dir, folder, "%(title)s.%(ext)s")

        # Configure command arguments
        cmd = [sys.executable, "-m", "yt_dlp", "-o", output_template, "--newline"]
        
        # Format-specific flags
        if format_type == "mp3_320":
            cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])
        elif format_type == "mp3_128":
            cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "5"])
        elif format_type == "m4a":
            cmd.extend(["-x", "--audio-format", "m4a"])
        elif format_type == "mp4_1080":
            cmd.extend(["-f", "bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4"])
        elif format_type == "mp4_720":
            cmd.extend(["-f", "bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4"])
        else:
            # Default fallback (mp3)
            cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])

        cmd.append(url)

        # Regex patterns to parse yt-dlp stdout progress
        # [download]  12.4% of 34.50MiB at 4.56MiB/s ETA 00:06
        progress_pattern = re.compile(r'\[download\]\s+([\d\.]+)%\s+of\s+~?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)')
        # [download] Downloading item 3 of 10
        playlist_pattern = re.compile(r'\[download\]\s+Downloading\s+item\s+(\d+)\s+of\s+(\d+)')
        # [download] Destination: ...
        dest_pattern = re.compile(r'\[download\]\s+Destination:\s+(.+)')

        # Run process
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,  # merge stderr into stdout to catch errors
            text=True,
            encoding='utf-8',
            errors='ignore',
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == 'win32' else 0
        )

        # Thread to monitor if Chrome/Edge closes stdin (e.g. cancelled download)
        import threading
        def monitor_stdin():
            try:
                sys.stdin.buffer.read(1) # Blocks until EOF or data
            except Exception:
                pass
            # Kill the download process immediately
            try:
                process.terminate()
                process.kill()
            except Exception:
                pass
            os._exit(0)
            
        monitor_thread = threading.Thread(target=monitor_stdin, daemon=True)
        monitor_thread.start()

        current_item = 1
        total_items = 1
        current_title = "Unknown Video"

        # Stream stdout line-by-line in real-time
        while True:
            line = process.stdout.readline()
            if not line:
                break
            
            line = line.strip()
            
            # Check for playlist item change
            playlist_match = playlist_pattern.search(line)
            if playlist_match:
                current_item = int(playlist_match.group(1))
                total_items = int(playlist_match.group(2))
                send_message({
                    "status": "downloading",
                    "progress": 0,
                    "speed": "0KiB/s",
                    "eta": "Unknown",
                    "item_index": current_item,
                    "item_total": total_items,
                    "title": f"Item {current_item} of {total_items}"
                })
                continue

            # Check for title/destination extraction
            dest_match = dest_pattern.search(line)
            if dest_match:
                file_path = dest_match.group(1)
                filename = os.path.basename(file_path)
                # Strip extension to get title
                current_title, _ = os.path.splitext(filename)
                continue

            # Check for download progress
            progress_match = progress_pattern.search(line)
            if progress_match:
                percent = float(progress_match.group(1))
                size = progress_match.group(2)
                speed = progress_match.group(3)
                eta = progress_match.group(4)
                
                send_message({
                    "status": "downloading",
                    "progress": percent,
                    "size": size,
                    "speed": speed,
                    "eta": eta,
                    "item_index": current_item,
                    "item_total": total_items,
                    "title": current_title
                })
                continue
            
            # Detect audio conversion/ffmpeg phase
            if "[ExtractAudio]" in line or "[ffmpeg]" in line:
                send_message({
                    "status": "converting",
                    "progress": 100,
                    "item_index": current_item,
                    "item_total": total_items,
                    "title": current_title
                })

        # Wait for the process to complete and check the return code
        process.wait()
        
        if process.returncode == 0:
            send_message({"status": "success", "dest": base_dir})
        else:
            send_message({"status": "failed", "error": f"yt-dlp exited with code {process.returncode}"})

    except Exception as e:
        send_message({"status": "error", "message": str(e)})

if __name__ == "__main__":
    main()