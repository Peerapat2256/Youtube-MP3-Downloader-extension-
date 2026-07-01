"""
yt_server.py - WebSocket server replacing native messaging
Run this script manually before using the extension:
  python yt_server.py

Listens on ws://localhost:9099
"""
import asyncio
import json
import subprocess
import os
import re
import sys
import datetime
import websockets

SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
PORT = 9099

def log(msg):
    ts = datetime.datetime.now().strftime("%H:%M:%S")
    formatted = f"[{ts}] {msg}"
    print(formatted, flush=True)
    try:
        log_file = os.path.join(SCRIPT_DIR, "server.log")
        with open(log_file, "a", encoding="utf-8") as f:
            f.write(formatted + "\n")
    except Exception:
        pass


active_downloads = {}  # websocket -> subprocess.Popen

async def safe_send(websocket, data_dict):
    try:
        await websocket.send(json.dumps(data_dict))
    except websockets.exceptions.ConnectionClosed:
        pass

async def run_download_task(websocket, data):
    # Clear server.log at the beginning of a new download task
    try:
        log_file = os.path.join(SCRIPT_DIR, "server.log")
        if os.path.exists(log_file):
            os.remove(log_file)
    except Exception:
        pass

    url            = data.get("url", "")
    format_type    = data.get("format", "mp3_320")
    target         = data.get("target", "single")
    playlist_id    = data.get("playlistId", "")
    save_folder    = data.get("saveFolder", "")
    playlist_start = data.get("playlistStart", "")
    playlist_end   = data.get("playlistEnd", "")
    urls_list      = data.get("urlsList", [])
    playlist_title = data.get("playlistTitle", "Mix_Downloads")

    # Add native-app dir to PATH so yt-dlp can find ffmpeg/ffprobe
    os.environ["PATH"] = SCRIPT_DIR + os.pathsep + os.environ.get("PATH", "")

    if save_folder:
        base_dir = os.path.normpath(save_folder)
    else:
        base_dir = os.path.join(os.path.expanduser("~"), "Downloads", "YT_Smart_Downloads")
    os.makedirs(base_dir, exist_ok=True)

    import urllib.parse
    import re

    # Flat playlist metadata extraction (For regular playlists)
    extracted_urls = []
    extracted_title = "Playlist_Downloads"
    
    if target == "playlist":
        is_mix = playlist_id.startswith("RD") if playlist_id else False
        if not is_mix:
            try:
                log(f"Extracting playlist info for flat-playlist: {url}")
                extract_cmd = [sys.executable, "-m", "yt_dlp", "--no-config", "--flat-playlist", "-J", url]
                
                playlist_items = ""
                if playlist_start and playlist_end:
                    playlist_items = f"{playlist_start}-{playlist_end}"
                elif playlist_start:
                    playlist_items = f"{playlist_start}:"
                elif playlist_end:
                    playlist_items = f":{playlist_end}"
                if playlist_items:
                    extract_cmd.extend(["--playlist-items", playlist_items])
                    
                proc = await asyncio.create_subprocess_exec(
                    *extract_cmd,
                    stdout=asyncio.subprocess.PIPE,
                    stderr=asyncio.subprocess.PIPE,
                    creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
                )
                stdout, stderr = await proc.communicate()
                if proc.returncode == 0:
                    playlist_data = json.loads(stdout.decode('utf-8', errors='ignore'))
                    extracted_title = playlist_data.get("title", "Playlist_Downloads")
                    entries = playlist_data.get("entries", [])
                    
                    for entry in entries:
                        if entry:
                            entry_url = entry.get("url")
                            if not entry_url and entry.get("id"):
                                entry_url = f"https://www.youtube.com/watch?v={entry.get('id')}"
                            
                            if entry_url:
                                idx = entry.get("playlist_index")
                                if idx is None:
                                    idx = len(extracted_urls) + 1
                                # Prefix to preserve the playlist order
                                prefix = f"{idx:02d} - "
                                extracted_urls.append((entry_url, idx, prefix))
                    log(f"Successfully extracted {len(extracted_urls)} videos from playlist: {extracted_title}")
                else:
                    err_txt = stderr.decode('utf-8', errors='ignore')
                    log(f"Flat-playlist extraction failed: {err_txt}")
            except Exception as e:
                log(f"Error during flat-playlist extraction: {e}")

    # Determine if we run concurrent downloads
    run_concurrent = (target == "playlist_queue") or (target == "single") or (target == "playlist" and extracted_urls)

    if run_concurrent:
        if target == "playlist":
            urls_to_download = extracted_urls
            safe_title = re.sub(r'[\\/*?:"<>|]', "", extracted_title).strip()
            if not safe_title:
                safe_title = "Playlist_Downloads"
            target_dir = os.path.normpath(os.path.join(base_dir, safe_title))
        elif target == "playlist_queue":
            urls_to_download = [(u, idx + 1, "") for idx, u in enumerate(urls_list)]
            safe_title = re.sub(r'[\\/*?:"<>|]', "", playlist_title).strip()
            if not safe_title:
                safe_title = "Mix_Downloads"
            target_dir = os.path.normpath(os.path.join(base_dir, safe_title))
        else: # single video
            folder = "My_Music" if ("mp3" in format_type or "m4a" in format_type) else "My_Videos"
            target_dir = os.path.normpath(os.path.join(base_dir, folder))
            urls_to_download = [(url, 1, "")]

        os.makedirs(target_dir, exist_ok=True)
        log(f"Concurrent download starting. Target folder: {target_dir}")
        log(f"Total items: {len(urls_to_download)}")

        # Concurrency limit (5 downloads at the same time)
        sem = asyncio.Semaphore(5)
        
        # State tracking variables
        active_processes = set()
        active_downloads[websocket] = active_processes

        total_items = len(urls_to_download)
        completed_items = 0
        failed_items = 0
        failed_tasks = []
        
        progress_dict = {u: 0.0 for u, _, _ in urls_to_download}
        title_dict = {u: "Unknown Video" for u, _, _ in urls_to_download}
        speed_dict = {u: "0KiB/s" for u, _, _ in urls_to_download}
        status_dict = {u: "pending" for u, _, _ in urls_to_download}
        
        progress_re  = re.compile(r'\[download\]\s+([\d\.]+)%\s+of\s+~?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)')
        dest_re      = re.compile(r'\[download\]\s+Destination:\s+(.+)')

        def parse_speed(speed_str):
            try:
                m = re.match(r'([\d\.]+)(KiB|MiB|GiB|B)/s', speed_str)
                if m:
                    val = float(m.group(1))
                    unit = m.group(2)
                    if unit == "B": return val / 1024.0
                    if unit == "KiB": return val
                    if unit == "MiB": return val * 1024.0
                    if unit == "GiB": return val * 1024.0 * 1024.0
            except Exception:
                pass
            return 0.0

        async def download_single_item(url, index, prefix):
            nonlocal completed_items, failed_items
            
            # Check if file starting with prefix already exists physically in target_dir
            if prefix and os.path.exists(target_dir):
                file_exists = False
                try:
                    for f in os.listdir(target_dir):
                        if f.startswith(prefix) and os.path.isfile(os.path.join(target_dir, f)):
                            if f.lower().endswith(('.mp3', '.m4a', '.mp4', '.webm', '.mkv')):
                                file_exists = True
                                break
                except Exception:
                    pass
                
                if file_exists:
                    log(f"File with prefix '{prefix}' already exists in '{target_dir}'. Skipping download.")
                    status_dict[url] = "success"
                    progress_dict[url] = 100.0
                    completed_items += 1
                    
                    # Send instant success tick
                    overall_progress = sum(progress_dict.values()) / total_items
                    await safe_send(websocket, {
                        "status": "downloading",
                        "progress": round(overall_progress, 1),
                        "speed": "0KiB/s",
                        "eta": "...",
                        "item_index": completed_items,
                        "item_total": total_items,
                        "title": f"เสร็จสิ้น: {prefix} (มีไฟล์อยู่แล้ว)"
                    })
                    return

            success = False
            for attempt in range(1, 4):  # 1 first attempt + 2 retries = 3 attempts total
                async with sem:
                    # Output template
                    if prefix:
                        out_tmpl = os.path.join(target_dir, f"{prefix}%(title)s.%(ext)s")
                    else:
                        out_tmpl = os.path.join(target_dir, "%(title)s.%(ext)s")
                    
                    cmd = [sys.executable, "-m", "yt_dlp", "--no-config", "-o", out_tmpl, "--newline"]
                    # Use local archive history for each specific folder to avoid cross-skipping
                    archive_file = os.path.normpath(os.path.join(target_dir, "downloaded_history.txt"))
                    cmd.extend(["--download-archive", archive_file])
                    cmd.append("--no-playlist")

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
                        cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])

                    cmd.extend([
                        "--embed-thumbnail",
                        "--convert-thumbnails", "jpg",
                        "--embed-metadata",
                        "--add-metadata",
                        url
                    ])

                    status_dict[url] = "downloading"
                    process = await asyncio.create_subprocess_exec(
                        *cmd,
                        stdout=asyncio.subprocess.PIPE,
                        stderr=asyncio.subprocess.STDOUT,
                        creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0
                    )
                    active_processes.add(process)
                    
                    try:
                        while True:
                            line_bytes = await process.stdout.readline()
                            if not line_bytes:
                                break
                            line = line_bytes.decode('utf-8', errors='ignore').strip()
                            if not line:
                                continue

                            # Log non-progress lines to server.log for troubleshooting
                            if not progress_re.search(line):
                                log(f"yt-dlp [{index}]: {line}")

                            # Parse title / destination
                            m = dest_re.search(line)
                            if m:
                                fn = os.path.basename(m.group(1))
                                title_dict[url], _ = os.path.splitext(fn)
                                if prefix and title_dict[url].startswith(prefix):
                                    title_dict[url] = title_dict[url][len(prefix):]
                                continue

                            # Parse progress
                            m = progress_re.search(line)
                            if m:
                                progress_dict[url] = float(m.group(1))
                                speed_dict[url] = m.group(3)
                            
                            # Parse conversions
                            if "[ExtractAudio]" in line or "[ffmpeg]" in line:
                                status_dict[url] = "converting"
                                progress_dict[url] = 100.0

                            # Calculate aggregated progress
                            overall_progress = sum(progress_dict.values()) / total_items
                            
                            # Sum up active download speeds
                            total_speed_kbps = sum(parse_speed(sp) for sp in speed_dict.values())
                            if total_speed_kbps > 1024.0:
                                overall_speed = f"{total_speed_kbps / 1024.0:.1f} MiB/s"
                            else:
                                overall_speed = f"{total_speed_kbps:.1f} KiB/s"
                            
                            # Build combined title string of active downloads
                            active_titles = [title_dict[u] for u in progress_dict if status_dict[u] in ("downloading", "converting")]
                            if active_titles:
                                title_str = f"โหลดขนาน: {', '.join(active_titles[:2])}"
                                if len(active_titles) > 2:
                                    title_str += f" (+{len(active_titles)-2})"
                            else:
                                title_str = f"คิว: {completed_items}/{total_items}"

                            # Send aggregated update to frontend
                            await safe_send(websocket, {
                                "status": "downloading" if any(s == "downloading" for s in status_dict.values()) else "converting",
                                "progress": round(overall_progress, 1),
                                "speed": overall_speed,
                                "eta": "...",
                                "item_index": completed_items + 1,
                                "item_total": total_items,
                                "title": title_str
                            })
                    except Exception as e:
                        log(f"Error reading process output for {url}: {e}")
                    finally:
                        rc = await process.wait()
                        active_processes.discard(process)
                        
                        if rc == 0:
                            success = True
                            break
                        else:
                            log(f"Attempt {attempt} failed for {url} (rc={rc})")
                            speed_dict[url] = "0KiB/s"
                            if attempt < 3:
                                await asyncio.sleep(1)
            
            if success:
                status_dict[url] = "success"
                progress_dict[url] = 100.0
                completed_items += 1
                
                # Send success progress update
                overall_progress = sum(progress_dict.values()) / total_items
                await safe_send(websocket, {
                    "status": "downloading",
                    "progress": round(overall_progress, 1),
                    "speed": "0KiB/s",
                    "eta": "...",
                    "item_index": completed_items,
                    "item_total": total_items,
                    "title": f"เสร็จสิ้น: {title_dict[url]}"
                })
            else:
                status_dict[url] = "failed"
                progress_dict[url] = 0.0
                failed_items += 1
                failed_tasks.append((url, index, prefix))

        # Run concurrent downloads
        tasks = [download_single_item(url, idx, pref) for url, idx, pref in urls_to_download]
        await asyncio.gather(*tasks)

        # Remove websocket from active_downloads since all processes finished
        active_downloads.pop(websocket, None)

        if failed_items == 0:
            await safe_send(websocket, {"status": "success", "dest": target_dir})
            log("Concurrent download completed successfully!")
        else:
            await safe_send(websocket, {
                "status": "failed",
                "error": f"ดาวน์โหลดล้มเหลว {failed_items} จาก {total_items} เพลง (ตรวจพบความผิดพลาดเครือข่าย)"
            })
            log(f"Concurrent download finished with {failed_items} failures.")

    else:
        # FALLBACK SEQUENTIAL DOWNLOAD BLOCK
        log("Falling back to standard sequential playlist download...")
        
        if target == "playlist":
            is_mix = playlist_id.startswith("RD") if playlist_id else False

            if playlist_id and not is_mix:
                url = f"https://www.youtube.com/playlist?list={playlist_id}"
            else:
                parsed = urllib.parse.urlparse(url)
                qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
                list_val = qs.get("list", [playlist_id])[0]
                video_val = qs.get("v", [None])[0]
                if list_val:
                    new_qs = {"list": list_val}
                    if video_val:
                        new_qs["v"] = video_val
                    clean_query = urllib.parse.urlencode(new_qs)
                    url = urllib.parse.urlunparse(parsed._replace(query=clean_query))

            output_template = os.path.join(base_dir, "%(playlist_title)s", "%(playlist_index)s - %(title)s.%(ext)s")
            log(f"Playlist URL: {url}")
        else:
            parsed = urllib.parse.urlparse(url)
            qs = urllib.parse.parse_qs(parsed.query, keep_blank_values=True)
            qs.pop("list", None)
            qs.pop("index", None)
            qs.pop("start_radio", None)
            clean_query = urllib.parse.urlencode({k: v[0] for k, v in qs.items()})
            url = urllib.parse.urlunparse(parsed._replace(query=clean_query))
            folder = "My_Music" if ("mp3" in format_type or "m4a" in format_type) else "My_Videos"
            output_template = os.path.join(base_dir, folder, "%(title)s.%(ext)s")
            log(f"Single video URL: {url}")

        cmd = [sys.executable, "-m", "yt_dlp", "--no-config", "-o", output_template, "--newline"]
        archive_file = os.path.normpath(os.path.join(base_dir, "downloaded_history.txt"))
        cmd.extend(["--download-archive", archive_file])

        if target != "playlist":
            cmd.append("--no-playlist")
        else:
            playlist_items = ""
            if playlist_start and playlist_end:
                playlist_items = f"{playlist_start}-{playlist_end}"
            elif playlist_start:
                playlist_items = f"{playlist_start}:"
            elif playlist_end:
                playlist_items = f":{playlist_end}"
                
            if playlist_items:
                cmd.extend(["--playlist-items", playlist_items])

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
            cmd.extend(["-x", "--audio-format", "mp3", "--audio-quality", "0"])

        cmd.extend([
            "--embed-thumbnail",
            "--convert-thumbnails", "jpg",
            "--embed-metadata",
            "--add-metadata",
        ])
        cmd.append(url)

        log(f"Starting fallback download task: {url[:60]}...")
        log(f"Full command: {' '.join(cmd)}")

        progress_re  = re.compile(r'\[download\]\s+([\d\.]+)%\s+of\s+~?([^\s]+)\s+at\s+([^\s]+)\s+ETA\s+([^\s]+)')
        playlist_re  = re.compile(r'\[download\]\s+Downloading\s+item\s+(\d+)\s+of\s+(\d+)')
        dest_re      = re.compile(r'\[download\]\s+Destination:\s+(.+)')

        # Wrap in a subprocess.Popen to maintain compatibility
        process = subprocess.Popen(
            cmd,
            stdout=subprocess.PIPE,
            stderr=subprocess.STDOUT,
            text=True,
            encoding="utf-8",
            errors="ignore",
            creationflags=subprocess.CREATE_NO_WINDOW if sys.platform == "win32" else 0,
        )
        
        active_processes = {process}
        active_downloads[websocket] = active_processes

        current_item = 1
        total_items  = 1
        current_title = "Unknown Video"
        loop = asyncio.get_event_loop()
        error_lines = []

        async def read_lines():
            nonlocal current_item, total_items, current_title
            while True:
                line = await loop.run_in_executor(None, process.stdout.readline)
                if not line:
                    break
                line = line.strip()
                if not line:
                    continue

                error_lines.append(line)
                if len(error_lines) > 12:
                    error_lines.pop(0)

                if not progress_re.search(line):
                    log(f"yt-dlp: {line}")

                m = playlist_re.search(line)
                if m:
                    current_item = int(m.group(1))
                    total_items  = int(m.group(2))
                    await safe_send(websocket, {
                        "status": "downloading", "progress": 0,
                        "speed": "0KiB/s", "eta": "...",
                        "item_index": current_item, "item_total": total_items,
                        "title": f"Item {current_item}/{total_items}"
                    })
                    continue

                m = dest_re.search(line)
                if m:
                    fn = os.path.basename(m.group(1))
                    current_title, _ = os.path.splitext(fn)
                    continue

                m = progress_re.search(line)
                if m:
                    await safe_send(websocket, {
                        "status": "downloading",
                        "progress": float(m.group(1)),
                        "size":  m.group(2),
                        "speed": m.group(3),
                        "eta":   m.group(4),
                        "item_index": current_item,
                        "item_total":  total_items,
                        "title": current_title,
                    })
                    continue

                if "[ExtractAudio]" in line or "[ffmpeg]" in line:
                    await safe_send(websocket, {
                        "status": "converting", "progress": 100,
                        "item_index": current_item, "item_total": total_items,
                        "title": current_title,
                    })

        try:
            await read_lines()
            rc = await loop.run_in_executor(None, process.wait)
            active_processes.discard(process)
            active_downloads.pop(websocket, None)
            
            if rc == 0:
                await safe_send(websocket, {"status": "success", "dest": base_dir})
                log("Fallback download succeeded")
            else:
                explicit_errors = [l for l in error_lines if l.startswith("ERROR:") or "error:" in l.lower()]
                if explicit_errors:
                    err_msg = explicit_errors[-1].replace("ERROR:", "").strip()
                elif error_lines:
                    non_progress = [l for l in error_lines if not progress_re.search(l) and not playlist_re.search(l)]
                    err_msg = non_progress[-1] if non_progress else error_lines[-1]
                else:
                    err_msg = f"yt-dlp exited with code {rc}"

                await safe_send(websocket, {"status": "failed", "error": err_msg})
                log(f"Fallback download failed rc={rc}: {err_msg}")
        except Exception as e:
            log(f"Error in fallback: {e}")
            active_downloads.pop(websocket, None)


async def handle_client(websocket):
    client_addr = websocket.remote_address
    log(f"Client connected: {client_addr}")
    try:
        async for raw in websocket:
            try:
                data = json.loads(raw)
            except Exception as e:
                await safe_send(websocket, {"status": "error", "message": f"JSON parse error: {e}"})
                continue

            action = data.get("action", "download")

            # ── open_folder ──────────────────────────────────────────────
            if action == "open_folder":
                save_folder = data.get("saveFolder", "")
                if save_folder and os.path.exists(save_folder):
                    base_dir = os.path.normpath(save_folder)
                else:
                    base_dir = os.path.join(os.path.expanduser("~"), "Downloads", "YT_Smart_Downloads")
                    os.makedirs(base_dir, exist_ok=True)

                if sys.platform == "win32":
                    os.startfile(base_dir)
                else:
                    subprocess.Popen(["xdg-open", base_dir])

                await safe_send(websocket, {"status": "success", "message": "Opened folder"})
                continue

            # ── cancel ──────────────────────────────────────────────────
            if action == "cancel":
                processes = active_downloads.get(websocket)
                if processes:
                    log("Cancel requested — terminating download processes")
                    for p in list(processes):
                        try:
                            p.terminate()
                            p.kill()
                        except Exception:
                            pass
                await safe_send(websocket, {"status": "cancelled"})
                await websocket.close()
                continue

            # ── download ──────────────────────────────────────────────────
            if action == "download":
                # Start download in a non-blocking background task
                asyncio.create_task(run_download_task(websocket, data))
                await safe_send(websocket, {"status": "initiated"})
                continue

    except websockets.exceptions.ConnectionClosed:
        log(f"Client disconnected (closed connection): {client_addr}")
    except Exception as e:
        log(f"Error in client handler: {e}")


async def main():
    log(f"YT Downloader Server starting on ws://localhost:{PORT}")
    log("Keep this window open while using the extension.")
    log("Press Ctrl+C to stop.\n")

    async with websockets.serve(handle_client, "localhost", PORT):
        await asyncio.Future()  # run forever


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        log("Server stopped.")
