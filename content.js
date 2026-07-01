// Keep track of current page info
let currentPageInfo = { type: "unknown", url: "", playlistId: "", videoId: "" };
let shadowRoot = null;
let container = null;
let lastUrl = "";
let currentSaveFolder = "C:\\Users\\keenz\\Downloads\\YT_Smart_Downloads";
let pollInterval = null;
let keepAliveInterval = null;

function startKeepAlive() {
  if (keepAliveInterval) clearInterval(keepAliveInterval);
  keepAliveInterval = setInterval(() => {
    if (isCtxValid()) {
      try {
        chrome.runtime.sendMessage({ action: "keep_alive" });
      } catch (e) {
        clearInterval(keepAliveInterval);
      }
    } else {
      clearInterval(keepAliveInterval);
    }
  }, 10000); // 10 seconds
}

function stopKeepAlive() {
  if (keepAliveInterval) {
    clearInterval(keepAliveInterval);
    keepAliveInterval = null;
  }
}

// Check if extension context is still valid (becomes invalid after extension reload)
function isCtxValid() {
  try {
    return !!(chrome && chrome.runtime && chrome.runtime.id);
  } catch (e) {
    return false;
  }
}

// Check the current YouTube URL and determine if it's a video, playlist, or both
function checkYouTubeUrl() {
  const url = window.location.href;
  if (url === lastUrl) return currentPageInfo;
  lastUrl = url;

  let type = "unknown";
  let playlistId = null;
  let videoId = null;

  try {
    const urlObj = new URL(url);
    if (urlObj.pathname.includes("/watch")) {
      type = "video";
      videoId = urlObj.searchParams.get("v");
      if (urlObj.searchParams.has("list")) {
        type = "video_in_playlist";
        playlistId = urlObj.searchParams.get("list");
      }
    } else if (urlObj.pathname.includes("/playlist")) {
      type = "playlist";
      playlistId = urlObj.searchParams.get("list");
    }
  } catch (e) {
    console.error("Error parsing YouTube URL", e);
  }

  const isNewVideo = videoId !== currentPageInfo.videoId || playlistId !== currentPageInfo.playlistId;
  currentPageInfo = { type, url, videoId, playlistId };
  updateUIState(isNewVideo);
  return currentPageInfo;
}

function loadSaveFolder() {
  if (!isCtxValid()) return;
  try {
    chrome.storage.local.get(["saveFolder"], (res) => {
      if (chrome.runtime.lastError) return;
      if (res && res.saveFolder) {
        currentSaveFolder = res.saveFolder;
        const inputEl = shadowRoot && shadowRoot.getElementById("save-folder-path");
        if (inputEl) inputEl.value = currentSaveFolder;
      }
    });
  } catch (e) {
    console.warn("[YTDl] loadSaveFolder skipped — context invalidated");
  }
}

// Create and inject the floating UI inside a Shadow DOM (isolates styling from YouTube)
function injectUI() {
  if (document.getElementById("yt-smart-downloader-host")) return;

  const host = document.createElement("div");
  host.id = "yt-smart-downloader-host";
  // Fixed container on top right of page
  host.style.position = "fixed";
  host.style.top = "70px";
  host.style.right = "24px";
  host.style.zIndex = "99999";
  host.style.fontFamily = "'Outfit', 'Inter', 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif";
  document.body.appendChild(host);

  shadowRoot = host.attachShadow({ mode: "open" });

  // Stylesheet inside the shadow DOM
  const style = document.createElement("style");
  style.textContent = `
    @import url('https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;600;700&display=swap');
    
    .downloader-container {
      display: flex;
      flex-direction: column;
      align-items: flex-end;
      user-select: none;
    }

    /* Floating icon trigger button */
    .trigger-btn {
      width: 52px;
      height: 52px;
      border-radius: 50%;
      background: linear-gradient(135deg, #FF0000, #B30000);
      box-shadow: 0 4px 15px rgba(255, 0, 0, 0.4);
      display: flex;
      justify-content: center;
      align-items: center;
      cursor: pointer;
      transition: all 0.3s cubic-bezier(0.175, 0.885, 0.32, 1.275);
      border: 2px solid rgba(255, 255, 255, 0.1);
      position: relative;
    }

    .trigger-btn:hover {
      transform: scale(1.1) rotate(15deg);
      box-shadow: 0 6px 20px rgba(255, 0, 0, 0.6);
    }

    .trigger-btn svg {
      width: 24px;
      height: 24px;
      fill: white;
      transition: transform 0.3s ease;
    }

    /* Main glassmorphism card */
    .downloader-card {
      width: 320px;
      background: rgba(20, 20, 22, 0.95);
      backdrop-filter: blur(15px);
      -webkit-backdrop-filter: blur(15px);
      border: 1px solid rgba(255, 255, 255, 0.1);
      border-radius: 16px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.6);
      padding: 20px;
      color: #FFFFFF;
      margin-bottom: 12px;
      display: none; /* Initially hidden */
      flex-direction: column;
      gap: 16px;
      animation: slideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards;
      transform-origin: top right;
    }

    @keyframes slideIn {
      from {
        opacity: 0;
        transform: scale(0.8) translateY(-20px);
      }
      to {
        opacity: 1;
        transform: scale(1) translateY(0);
      }
    }

    /* Header */
    .card-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      border-bottom: 1px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 12px;
    }

    .brand {
      display: flex;
      align-items: center;
      gap: 8px;
      font-weight: 700;
      font-size: 16px;
      background: linear-gradient(90deg, #FF3333, #FF8888);
      -webkit-background-clip: text;
      -webkit-text-fill-color: transparent;
    }

    .close-btn {
      cursor: pointer;
      color: #8E8E93;
      transition: color 0.2s ease;
      display: flex;
      align-items: center;
      justify-content: center;
    }

    .close-btn:hover {
      color: #FFFFFF;
    }

    /* Video Info Section */
    .video-info {
      font-size: 13px;
      line-height: 1.4;
      background: rgba(255, 255, 255, 0.04);
      padding: 10px 12px;
      border-radius: 8px;
      border-left: 3px solid #FF3333;
      max-height: 55px;
      overflow: hidden;
      text-overflow: ellipsis;
      display: -webkit-box;
      -webkit-line-clamp: 2;
      -webkit-box-orient: vertical;
    }

    /* Form Styles */
    .form-group {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }

    .form-label {
      font-size: 12px;
      font-weight: 600;
      color: #AEAEB2;
      text-transform: uppercase;
      letter-spacing: 0.5px;
    }

    select {
      background: #2C2C2E;
      border: 1px solid rgba(255, 255, 255, 0.15);
      border-radius: 8px;
      padding: 10px;
      color: white;
      font-size: 13px;
      outline: none;
      cursor: pointer;
      transition: border-color 0.2s ease;
    }

    select:focus {
      border-color: #FF3333;
    }

    /* Radio button options for playlist */
    .playlist-options {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: rgba(255, 51, 51, 0.05);
      border: 1px dashed rgba(255, 51, 51, 0.2);
      padding: 12px;
      border-radius: 10px;
    }

    .radio-label {
      display: flex;
      align-items: center;
      gap: 8px;
      font-size: 13px;
      cursor: pointer;
    }

    .radio-label input {
      accent-color: #FF3333;
      cursor: pointer;
    }

    /* Buttons */
    .btn-primary {
      background: linear-gradient(135deg, #FF3333, #CC0000);
      color: white;
      font-weight: 600;
      font-size: 14px;
      border: none;
      padding: 12px;
      border-radius: 10px;
      cursor: pointer;
      box-shadow: 0 4px 15px rgba(255, 51, 51, 0.2);
      transition: all 0.2s ease;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 8px;
    }

    .btn-primary:hover {
      transform: translateY(-2px);
      box-shadow: 0 6px 20px rgba(255, 51, 51, 0.4);
      background: linear-gradient(135deg, #FF4D4D, #E60000);
    }

    .btn-primary:active {
      transform: translateY(0);
    }

    .btn-primary:disabled {
      background: #3A3A3C;
      color: #8E8E93;
      box-shadow: none;
      cursor: not-allowed;
      transform: none;
    }

    .btn-secondary {
      background: transparent;
      border: 1px solid rgba(255, 255, 255, 0.2);
      color: #E5E5EA;
      font-weight: 500;
      font-size: 13px;
      padding: 10px;
      border-radius: 10px;
      cursor: pointer;
      transition: all 0.2s ease;
      display: flex;
      justify-content: center;
      align-items: center;
      gap: 6px;
    }

    .btn-secondary:hover {
      border-color: rgba(255, 255, 255, 0.5);
      color: white;
      background: rgba(255, 255, 255, 0.05);
    }

    /* Progress and Status Zone */
    .progress-section {
      background: rgba(255, 255, 255, 0.04);
      padding: 12px 14px;
      border-radius: 10px;
      display: none;
      flex-direction: column;
      gap: 8px;
      border: 1px solid rgba(255, 255, 255, 0.05);
    }

    .status-text {
      font-size: 13px;
      font-weight: 600;
      color: #FFD60A; /* Yellow text for loading state */
      display: flex;
      justify-content: space-between;
    }

    .progress-bar-container {
      width: 100%;
      height: 8px;
      background: rgba(255, 255, 255, 0.1);
      border-radius: 4px;
      overflow: hidden;
    }

    .progress-bar {
      height: 100%;
      width: 0%;
      background: linear-gradient(90deg, #FF6666, #FF0000);
      border-radius: 4px;
      transition: width 0.1s linear;
    }

    .stats-row {
      display: flex;
      justify-content: space-between;
      font-size: 11px;
      color: #AEAEB2;
    }

    .hidden {
      display: none !important;
    }
  `;
  shadowRoot.appendChild(style);

  // UI Template structure
  container = document.createElement("div");
  container.className = "downloader-container";
  container.innerHTML = `
    <!-- Expanded Panel -->
    <div class="downloader-card" id="downloader-card">
      <div class="card-header">
        <div class="brand">
          <svg viewBox="0 0 24 24" width="18" height="18" fill="url(#brand-grad)"><path d="M23.498 6.163a3.003 3.003 0 0 0-2.11-2.11C19.517 3.545 12 3.545 12 3.545s-7.516 0-9.387.507a3.003 3.003 0 0 0-2.11 2.11C0 8.033 0 12 0 12s0 3.967.502 5.837a3.003 3.003 0 0 0 2.11 2.11c1.871.507 9.387.507 9.387.507s7.517 0 9.387-.507a3.003 3.003 0 0 0 2.11-2.11C24 15.967 24 12 24 12s0-3.967-.502-5.837zM9.545 15.568V8.432L15.818 12l-6.273 3.568z"/></svg>
          YT Downloader Pro
        </div>
        <div style="display: flex; gap: 12px; align-items: center;">
          <!-- Minimize button (Minus symbol) -->
          <div class="close-btn" id="minimize-card-btn" title="ย่อเมนู (Minimize)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="5" y1="12" x2="19" y2="12"></line></svg>
          </div>
          <!-- Close button (Close symbol) -->
          <div class="close-btn" id="close-card-btn" title="ปิดเมนู (Close)">
            <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.5"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
          </div>
        </div>
      </div>

      <div class="video-info" id="video-title">กำลังดึงข้อมูล...</div>

      <!-- Playlist Selection (Shown conditionally) -->
      <div class="playlist-options hidden" id="playlist-options-zone">
        <label class="radio-label">
          <input type="radio" name="download-target" value="playlist" checked>
          <span>🔄 ดาวน์โหลดทั้งเพลย์ลิสต์</span>
        </label>
        <div id="playlist-range-zone" style="margin-left: 22px; margin-top: 6px; display: flex; flex-direction: column; gap: 6px;">
          <div style="font-size: 11px; color: #AEAEB2; display: flex; align-items: center; justify-content: space-between;">
            <span>🔢 เลือกช่วงเพลง (เริ่ม - สิ้นสุด):</span>
          </div>
          <div style="display: flex; gap: 8px; align-items: center;">
            <input type="number" id="playlist-start-idx" min="1" placeholder="เริ่ม (เช่น 1)" style="flex: 1; background: #2C2C2E; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; padding: 6px; color: #FFFFFF; font-size: 11px; outline: none; box-sizing: border-box;">
            <span style="color: #AEAEB2; font-size: 11px;">ถึง</span>
            <input type="number" id="playlist-end-idx" min="1" placeholder="สิ้นสุด" style="flex: 1; background: #2C2C2E; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 6px; padding: 6px; color: #FFFFFF; font-size: 11px; outline: none; box-sizing: border-box;">
          </div>
          <div style="font-size: 9px; color: #8E8E93; line-height: 1.2;">💡 ทยอยโหลดทีละ 100-200 เพลงได้ เพื่อป้องกัน YouTube บล็อก (เช่น 101 ถึง 200)</div>
        </div>
        <label class="radio-label" id="mix-queue-option-wrapper" style="margin-top: 4px; display: none;">
          <input type="radio" name="download-target" value="playlist_queue">
          <span>📋 ดาวน์โหลดตามคิว (ดึงจากขวา)</span>
        </label>
        <label class="radio-label" id="only-this-video-wrapper" style="margin-top: 4px;">
          <input type="radio" name="download-target" value="single">
          <span>🎬 ดาวน์โหลดเฉพาะคลิปนี้</span>
        </label>
      </div>

      <!-- Format Selection -->
      <div class="form-group">
        <label class="form-label">เลือกรูปแบบไฟล์</label>
        <select id="format-select">
          <option value="mp3_320">Audio (MP3 320kbps - ดีที่สุด)</option>
          <option value="mp3_128">Audio (MP3 128kbps - มาตรฐาน)</option>
          <option value="m4a">Audio (M4A)</option>
          <option value="mp4_1080">Video (MP4 - Full HD 1080p)</option>
          <option value="mp4_720">Video (MP4 - HD 720p)</option>
        </select>
      </div>

      <!-- Folder Selection -->
      <div class="form-group">
        <label class="form-label">📂 โฟลเดอร์เซฟไฟล์</label>
        <div style="display: flex; gap: 8px; align-items: center; width: 100%;">
          <input type="text" id="save-folder-path" spellcheck="false" style="flex: 1; background: #2C2C2E; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 8px; padding: 10px; color: #FFFFFF; font-size: 11px; outline: none; box-sizing: border-box; min-width: 0; cursor: text;" value="C:\\Users\\keenz\\Downloads\\YT_Smart_Downloads" placeholder="พิมพ์หรือวางที่อยู่โฟลเดอร์...">
          <button class="btn-secondary" id="change-folder-btn" title="เลือกโฟลเดอร์" style="padding: 10px 14px; font-size: 13px; font-weight: 600; white-space: nowrap; height: 38px; box-sizing: border-box; margin: 0;">📁</button>
        </div>
        <div id="folder-hint" style="font-size: 10px; color: #8E8E93; margin-top: 2px;">💡 พิมพ์ path ตรงๆ ได้เลย เช่น C:\Downloads\Music</div>
      </div>

      <!-- Download Trigger Button -->
      <button class="btn-primary" id="start-download-btn">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
        <span>เริ่มดาวน์โหลด</span>
      </button>

      <!-- Progress Section -->
      <div class="progress-section" id="progress-section">
        <div class="status-text" id="status-text">
          <span>กำลังดาวน์โหลด...</span>
          <span id="percent-text">0%</span>
        </div>
        <div class="progress-bar-container">
          <div class="progress-bar" id="progress-bar"></div>
        </div>
        <div class="stats-row">
          <span id="speed-text">ความเร็ว: -- MB/s</span>
          <span id="eta-text">เวลา: --</span>
        </div>
        <button class="btn-secondary" id="cancel-download-btn" style="border-color: rgba(255, 51, 51, 0.4); color: #FF453A; margin-top: 4px; padding: 6px 10px; font-size: 12px; background: rgba(255, 69, 58, 0.1); width: 100%; display: flex; justify-content: center; align-items: center; gap: 6px; box-sizing: border-box; margin-left: 0; margin-right: 0;">
          🛑 ยกเลิกดาวน์โหลด
        </button>
      </div>

      <!-- Open Folder Button -->
      <button class="btn-secondary" id="open-folder-btn">
        <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>
        เปิดโฟลเดอร์เซฟไฟล์
      </button>
    </div>

    <!-- Collapsed Trigger Badge -->
    <div class="trigger-btn" id="trigger-badge">
      <svg viewBox="0 0 24 24"><path d="M19.35 10.04C18.67 6.59 15.64 4 12 4 9.11 4 6.6 5.64 5.35 8.04 2.34 8.36 0 10.91 0 14c0 3.31 2.69 6 6 6h13c2.76 0 5-2.24 5-5 0-2.64-2.05-4.78-4.65-4.96zM17 13l-5 5-5-5h3V9h4v4h3z"/></svg>
    </div>
  `;

  shadowRoot.appendChild(container);
  loadSaveFolder();
  setupEvents();
}

// Bind UI actions and listener events
function setupEvents() {
  const badge = shadowRoot.getElementById("trigger-badge");
  const card = shadowRoot.getElementById("downloader-card");
  const minimizeBtn = shadowRoot.getElementById("minimize-card-btn");
  const closeBtn = shadowRoot.getElementById("close-card-btn");
  const downloadBtn = shadowRoot.getElementById("start-download-btn");
  const openFolderBtn = shadowRoot.getElementById("open-folder-btn");
  const changeFolderBtn = shadowRoot.getElementById("change-folder-btn");
  const cancelDownloadBtn = shadowRoot.getElementById("cancel-download-btn");



  // Minimize panel click (collapses to badge)
  minimizeBtn.addEventListener("click", () => {
    card.style.display = "none";
    badge.style.display = "flex";
  });

  // Close panel click (hides card and badge completely)
  closeBtn.addEventListener("click", () => {
    card.style.display = "none";
    badge.style.display = "none";
  });

  // Trigger download command
  downloadBtn.addEventListener("click", () => {
    startDownloadProcess();
  });

  // Target radios toggle playlist range selector
  const targetRadios = shadowRoot.querySelectorAll('input[name="download-target"]');
  targetRadios.forEach(radio => {
    radio.addEventListener("change", () => {
      const rangeZone = shadowRoot.getElementById("playlist-range-zone");
      if (rangeZone) {
        if (radio.value === "playlist" || radio.value === "playlist_queue") {
          rangeZone.style.display = "flex";
        } else {
          rangeZone.style.display = "none";
        }
      }
    });
  });

  // Open folder path in OS explorer
  openFolderBtn.addEventListener("click", () => {
    chrome.runtime.sendMessage({ action: "open_folder", saveFolder: currentSaveFolder }, (res) => {
      if (chrome.runtime.lastError || (res && res.status === "error")) {
        const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : (res ? res.message : "ไม่สามารถเชื่อมต่อระบบหลังบ้านได้");
        alert(`ไม่สามารถเปิดโฟลเดอร์ได้: ${errMsg}`);
      }
    });
  });

  // Save folder path when user types in the input box
  const folderInput = shadowRoot.getElementById("save-folder-path");
  const folderHint = shadowRoot.getElementById("folder-hint");
  
  folderInput.addEventListener("input", () => {
    const val = folderInput.value.trim();
    if (val) {
      currentSaveFolder = val;
      if (isCtxValid()) {
        try { chrome.storage.local.set({ saveFolder: val }); } catch(e) {}
      }
      folderInput.style.borderColor = "rgba(48, 209, 88, 0.5)";
    } else {
      folderInput.style.borderColor = "rgba(255, 255, 255, 0.15)";
    }
  });
  
  folderInput.addEventListener("blur", () => {
    folderInput.style.borderColor = "rgba(255, 255, 255, 0.15)";
  });

  // Open folder picker dialog (uses browser's native API - no native messaging needed)
  changeFolderBtn.addEventListener("click", async () => {
    if (window.showDirectoryPicker) {
      try {
        const hint = folderHint;
        hint.textContent = "⏳ กำลังเปิดหน้าต่างเลือกโฟลเดอร์...";
        hint.style.color = "#FFD60A";
        
        const dirHandle = await window.showDirectoryPicker({ mode: "readwrite" });
        const folderName = dirHandle.name;
        hint.innerHTML = `✅ เลือก: <strong style="color:#fff">${folderName}</strong> — กรุณาพิมพ์ full path ด้านบน`;
        hint.style.color = "#30D158";
        folderInput.focus();
        folderInput.select();
      } catch (err) {
        if (err.name !== "AbortError") {
          folderHint.textContent = "❌ ยกเลิกหรือเกิดข้อผิดพลาด";
          folderHint.style.color = "#FF453A";
        } else {
          folderHint.textContent = "💡 พิมพ์ path ตรงๆ ได้เลย เช่น C:\\Downloads\\Music";
          folderHint.style.color = "#8E8E93";
        }
      }
    } else {
      if (isCtxValid()) {
        try {
          chrome.runtime.sendMessage({ action: "open_folder", saveFolder: currentSaveFolder });
        } catch(e) {}
      }
      folderHint.textContent = "📋 Explorer เปิดแล้ว — copy path จาก address bar แล้ววางลงในช่องด้านบน";
      folderHint.style.color = "#0A84FF";
    }
  });

  // Open folder path in OS explorer
  openFolderBtn.addEventListener("click", () => {
    if (!isCtxValid()) return;
    try {
      chrome.runtime.sendMessage({ action: "open_folder", saveFolder: currentSaveFolder }, (res) => {
        if (chrome.runtime.lastError || (res && res.status === "error")) {
          const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : (res ? res.message : "ไม่สามารถเชื่อมต่อระบบหลังบ้านได้");
          alert(`ไม่สามารถเปิดโฟลเดอร์ได้: ${errMsg}`);
        }
      });
    } catch(e) { console.warn("[YTDl] open_folder skipped", e); }
  });

  // Cancel download process
  cancelDownloadBtn.addEventListener("click", () => {
    if (!isCtxValid()) return;
    try {
      chrome.runtime.sendMessage({ action: "cancel_download" }, (res) => {
        if (chrome.runtime.lastError) return;
        stopKeepAlive();
        const statusText = shadowRoot.getElementById("status-text").firstElementChild;
        statusText.innerText = "🛑 ยกเลิกแล้ว";
        statusText.style.color = "#FF453A";
        cancelDownloadBtn.disabled = true;
        setTimeout(() => {
          shadowRoot.getElementById("progress-section").style.display = "none";
          downloadBtn.disabled = false;
          cancelDownloadBtn.disabled = false;
          updateUIState();
        }, 2000);
      });
    } catch(e) { console.warn("[YTDl] cancel_download skipped", e); }
  });

  // --- Make the panel and badge draggable ---
  const host = document.getElementById("yt-smart-downloader-host");
  const dragHandle = shadowRoot.querySelector(".card-header");
  if (host && dragHandle) {
    dragHandle.style.cursor = "move";

    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    dragHandle.addEventListener("mousedown", (e) => {
      // Only drag with left click and if not clicking close/minimize/folder picker buttons
      if (e.button !== 0) return;
      if (e.target.closest("#close-card-btn") || e.target.closest("#minimize-card-btn") || e.target.closest("#change-folder-btn")) return;

      isDragging = true;
      startX = e.clientX;
      startY = e.clientY;

      const rect = host.getBoundingClientRect();
      initialLeft = rect.left;
      initialTop = rect.top;

      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isDragging) return;

      const deltaX = e.clientX - startX;
      const deltaY = e.clientY - startY;

      let newLeft = initialLeft + deltaX;
      let newTop = initialTop + deltaY;

      // Clamping inside viewport boundaries
      const rect = host.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;

      newLeft = Math.max(0, Math.min(newLeft, maxX));
      newTop = Math.max(0, Math.min(newTop, maxY));

      host.style.right = "auto";
      host.style.left = `${newLeft}px`;
      host.style.top = `${newTop}px`;
    });

    document.addEventListener("mouseup", () => {
      if (isDragging) {
        isDragging = false;
        document.body.style.userSelect = "";
      }
    });
  }

  // Make collapsed badge draggable and distinguish drag from click
  if (host && badge) {
    badge.style.cursor = "move";
    let isBadgeDragging = false;
    let badgeStartX = 0;
    let badgeStartY = 0;
    let badgeInitLeft = 0;
    let badgeInitTop = 0;
    let badgeMoved = false;

    badge.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;

      isBadgeDragging = true;
      badgeMoved = false;
      badgeStartX = e.clientX;
      badgeStartY = e.clientY;

      const rect = host.getBoundingClientRect();
      badgeInitLeft = rect.left;
      badgeInitTop = rect.top;

      document.body.style.userSelect = "none";
      e.preventDefault();
    });

    document.addEventListener("mousemove", (e) => {
      if (!isBadgeDragging) return;

      const deltaX = e.clientX - badgeStartX;
      const deltaY = e.clientY - badgeStartY;

      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        badgeMoved = true;
      }

      let newLeft = badgeInitLeft + deltaX;
      let newTop = badgeInitTop + deltaY;

      const rect = host.getBoundingClientRect();
      const maxX = window.innerWidth - rect.width;
      const maxY = window.innerHeight - rect.height;

      newLeft = Math.max(0, Math.min(newLeft, maxX));
      newTop = Math.max(0, Math.min(newTop, maxY));

      host.style.right = "auto";
      host.style.left = `${newLeft}px`;
      host.style.top = `${newTop}px`;
    });

    document.addEventListener("mouseup", (e) => {
      if (isBadgeDragging) {
        isBadgeDragging = false;
        document.body.style.userSelect = "";
        
        if (!badgeMoved) {
          // It was a click, not a drag - expand the panel
          badge.style.display = "none";
          card.style.display = "flex";
        }
      }
    });
  }
}



// Trigger background process execution
function startDownloadProcess() {
  if (!isCtxValid()) {
    alert("Extension ถูก Reload — กรุณากด F5 รีเฟรชหน้านี้ก่อนดาวน์โหลด");
    return;
  }
  const format = shadowRoot.getElementById("format-select").value;
  const targetOption = shadowRoot.querySelector('input[name="download-target"]:checked');
  const target = targetOption ? targetOption.value : "single";
  
  const downloadBtn = shadowRoot.getElementById("start-download-btn");
  const progressSection = shadowRoot.getElementById("progress-section");
  const statusText = shadowRoot.getElementById("status-text").firstElementChild;
  const percentText = shadowRoot.getElementById("percent-text");
  const progressBar = shadowRoot.getElementById("progress-bar");
  const speedText = shadowRoot.getElementById("speed-text");
  const etaText = shadowRoot.getElementById("eta-text");

  // Set UI state to active downloading
  downloadBtn.disabled = true;
  progressSection.style.display = "flex";
  statusText.innerText = "⏳ กำลังดำเนินการ...";
  statusText.style.color = "#FFD60A";
  percentText.innerText = "0%";
  progressBar.style.width = "0%";
  speedText.innerText = "ความเร็ว: Connecting...";
  etaText.innerText = "เวลา: Waiting...";

  const cancelBtn = shadowRoot.getElementById("cancel-download-btn");
  if (cancelBtn) {
    cancelBtn.style.display = "flex";
    cancelBtn.disabled = false;
  }

  const playlistStartInput = shadowRoot.getElementById("playlist-start-idx");
  const playlistEndInput = shadowRoot.getElementById("playlist-end-idx");
  const playlistStart = playlistStartInput ? playlistStartInput.value.trim() : "";
  const playlistEnd = playlistEndInput ? playlistEndInput.value.trim() : "";

  let urlsList = [];
  let playlistTitle = "Mix_Downloads";

  if (target === "playlist_queue") {
    const renderers = document.querySelectorAll('ytd-playlist-panel-video-renderer, ytd-playlist-video-renderer');
    renderers.forEach(renderer => {
      const links = renderer.querySelectorAll('a');
      links.forEach(el => {
        const href = el.getAttribute('href');
        if (href && href.includes('v=')) {
          try {
            const urlObj = new URL(href, window.location.origin);
            const v = urlObj.searchParams.get("v");
            if (v) {
              const fullUrl = `https://www.youtube.com/watch?v=${v}`;
              if (!urlsList.includes(fullUrl)) {
                urlsList.push(fullUrl);
              }
            }
          } catch (e) {}
        }
      });
    });

    const headerEl = document.querySelector('ytd-playlist-panel-renderer #title, ytd-playlist-panel-renderer .title, ytd-playlist-panel-renderer #playlist-title');
    if (headerEl && headerEl.textContent) {
      playlistTitle = headerEl.textContent.trim();
    }

    // Apply range slicing in JS
    if (playlistStart || playlistEnd) {
      const startIdx = playlistStart ? Math.max(0, parseInt(playlistStart) - 1) : 0;
      const endIdx = playlistEnd ? Math.max(startIdx, parseInt(playlistEnd)) : urlsList.length;
      urlsList = urlsList.slice(startIdx, endIdx);
    }
  }

  const payload = {
    action: "start_download",
    url: currentPageInfo.url,
    format: format,
    target: target,
    playlistId: currentPageInfo.playlistId,
    saveFolder: currentSaveFolder,
    playlistStart: playlistStart,
    playlistEnd: playlistEnd,
    urlsList: urlsList,
    playlistTitle: playlistTitle
  };

  try {
    chrome.runtime.sendMessage(payload, (res) => {
      if (chrome.runtime.lastError || (res && res.status === "error")) {
        const errMsg = chrome.runtime.lastError ? chrome.runtime.lastError.message : (res ? res.message : "Connection failed");
        statusText.innerText = "❌ เชื่อมต่อระบบล้มเหลว";
        statusText.style.color = "#FF453A";
        speedText.innerText = `โปรดตรวจสอบสคริปต์หลังบ้าน: ${errMsg}`;
        etaText.innerText = "";
        downloadBtn.disabled = false;
      } else {
        startKeepAlive();
      }
    });
  } catch(e) {
    statusText.innerText = "❌ Extension ถูก Reload";
    statusText.style.color = "#FF453A";
    speedText.innerText = "กรุณากด F5 รีเฟรชหน้านี้";
    downloadBtn.disabled = false;
  }
}

// Update UI options based on URL context (whether playlist is active, video details, etc.)
function updateUIState(resetDownloadState = false) {
  if (!shadowRoot) return;

  const card = shadowRoot.getElementById("downloader-card");
  const badge = shadowRoot.getElementById("trigger-badge");
  const infoZone = shadowRoot.getElementById("video-title");
  const playlistZone = shadowRoot.getElementById("playlist-options-zone");
  const singleOptWrapper = shadowRoot.getElementById("only-this-video-wrapper");

  if (resetDownloadState) {
    const downloadBtn = shadowRoot.getElementById("start-download-btn");
    const progressSection = shadowRoot.getElementById("progress-section");
    if (downloadBtn) downloadBtn.disabled = false;
    if (progressSection) progressSection.style.display = "none";
  }

  // If we are not on video/playlist, hide floating widgets
  if (currentPageInfo.type === "unknown") {
    card.style.display = "none";
    badge.style.display = "none";
    return;
  }

  // Show either the trigger badge or card depending on active state
  if (card.style.display !== "flex") {
    badge.style.display = "flex";
  }

  // Update title display from page header
  const title = getYouTubeVideoTitle();
  infoZone.innerText = title || "ตรวจพบรายการสื่อ YouTube";

  // Check playlist toggle display
  const pid = currentPageInfo.playlistId || "";
  const isRadioMix = pid.startsWith("RD") || pid.startsWith("RDMM") || pid.startsWith("RDCLAK");

  const mixQueueOpt = shadowRoot.getElementById("mix-queue-option-wrapper");
  const selectedTarget = shadowRoot.querySelector('input[name="download-target"]:checked');
  if (mixQueueOpt) {
    if (isRadioMix && currentPageInfo.type !== "unknown") {
      mixQueueOpt.style.display = "flex";
    } else {
      mixQueueOpt.style.display = "none";
      if (selectedTarget && selectedTarget.value === "playlist_queue") {
        const playlistRadio = shadowRoot.querySelector('input[value="playlist"]');
        if (playlistRadio) playlistRadio.checked = true;
      }
    }
  }

  if (currentPageInfo.type === "playlist") {
    playlistZone.classList.remove("hidden");
    singleOptWrapper.style.display = "none";
    if (selectedTarget && selectedTarget.value === "single") {
      shadowRoot.querySelector('input[value="playlist"]').checked = true;
    }
  } else if (currentPageInfo.type === "video_in_playlist") {
    playlistZone.classList.remove("hidden");
    singleOptWrapper.style.display = "flex";
  } else {
    playlistZone.classList.add("hidden");
  }

  // Toggle visibility of range selection block based on the checked radio option
  const rangeZone = shadowRoot.getElementById("playlist-range-zone");
  const currentTarget = shadowRoot.querySelector('input[name="download-target"]:checked');
  if (rangeZone) {
    if (currentTarget && (currentTarget.value === "playlist" || currentTarget.value === "playlist_queue") && (currentPageInfo.type === "playlist" || currentPageInfo.type === "video_in_playlist")) {
      rangeZone.style.display = "flex";
    } else {
      rangeZone.style.display = "none";
    }
  }

  // Show/hide Radio Mix warning
  let mixWarn = shadowRoot.getElementById("radio-mix-warning");
  if (isRadioMix && currentPageInfo.type !== "unknown") {
    if (!mixWarn) {
      mixWarn = document.createElement("div");
      mixWarn.id = "radio-mix-warning";
      mixWarn.style.cssText = "font-size:10px;color:#FFD60A;background:rgba(255,214,10,0.08);border:1px solid rgba(255,214,10,0.3);border-radius:6px;padding:6px 8px;margin-top:4px;line-height:1.4;";
      mixWarn.innerHTML = "⚠️ <strong>YouTube Mix/Radio</strong> — ถ้าโหลด Playlist อาจได้เพลงสุ่มปะปน ถ้าต้องการเพลงตรงตามที่เห็นขวามือ แนะนำใช้ <strong>ดาวน์โหลดตามคิว (ดึงจากขวา)</strong>";
      // Insert after playlistZone
      const pz = shadowRoot.getElementById("playlist-options-zone");
      if (pz && pz.parentNode) pz.parentNode.insertBefore(mixWarn, pz.nextSibling);
    } else {
      mixWarn.innerHTML = "⚠️ <strong>YouTube Mix/Radio</strong> — ถ้าโหลด Playlist อาจได้เพลงสุ่มปะปน ถ้าต้องการเพลงตรงตามที่เห็นขวามือ แนะนำใช้ <strong>ดาวน์โหลดตามคิว (ดึงจากขวา)</strong>";
    }
    mixWarn.style.display = "block";
  } else if (mixWarn) {
    mixWarn.style.display = "none";
  }
}

// Attempt to read the video title from the page elements or document title
function getYouTubeVideoTitle() {
  let title = document.title;
  
  if (title) {
    // Strip trailing " - YouTube" or " - Microsoft Edge" or similar if present
    if (title.toLowerCase().endsWith(" - youtube")) {
      title = title.substring(0, title.length - 10);
    }
    // Strip leading playing indicator like "▶ "
    title = title.replace(/^[▶\s\u25b6]+/, "");
    // Strip leading notifications indicator like "(3) " or "(10+) "
    title = title.replace(/^\(\d+\+?\)\s+/, "");
    
    title = title.trim();
    if (title) return title;
  }

  // Fallback to active DOM element if document.title is empty
  const ytTitleEl = document.querySelector("ytd-watch-flexy[active] ytd-watch-metadata h1 yt-formatted-string") || 
                     document.querySelector("ytd-watch-flexy[active] h1.ytd-video-primary-info-renderer") ||
                     document.querySelector("ytd-watch-metadata h1 yt-formatted-string") || 
                     document.querySelector("h1.ytd-video-primary-info-renderer") ||
                     document.querySelector(".ytd-playlist-header-renderer .yt-dynamic-sizing-formatted-string");
  if (ytTitleEl) return ytTitleEl.textContent.trim();
  
  return "ตรวจพบรายการสื่อ YouTube";
}

// Receive progress updates from Background Script
try {
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "download_progress") {
      if (!shadowRoot) return;

      const data = message.data;
      const downloadBtn = shadowRoot.getElementById("start-download-btn");
      const statusText = shadowRoot.getElementById("status-text").firstElementChild;
      const percentText = shadowRoot.getElementById("percent-text");
      const progressBar = shadowRoot.getElementById("progress-bar");
      const speedText = shadowRoot.getElementById("speed-text");
      const etaText = shadowRoot.getElementById("eta-text");
      const infoZone = shadowRoot.getElementById("video-title");

      if (data.status === "downloading") {
        statusText.innerText = "📥 กำลังดาวน์โหลด...";
        statusText.style.color = "#0A84FF";
        const percentVal = data.progress || 0;
        percentText.innerText = `${percentVal}%`;
        progressBar.style.width = `${percentVal}%`;
        let speedStr = data.speed || "-- KiB/s";
        let etaStr = data.eta || "--";
        if (data.item_total && data.item_total > 1) {
          speedText.innerText = `คลิปที่: ${data.item_index}/${data.item_total} | ${speedStr}`;
        } else {
          speedText.innerText = `ความเร็ว: ${speedStr}`;
        }
        etaText.innerText = `เหลือเวลา: ${etaStr}`;
        if (data.title) infoZone.innerText = data.title;
      } else if (data.status === "converting") {
        statusText.innerText = "⚙️ กำลังแปลงไฟล์เป็น MP3...";
        statusText.style.color = "#FF9F0A";
        percentText.innerText = "100%";
        progressBar.style.width = "100%";
        speedText.innerText = "อาจใช้เวลา 10-30 วินาที...";
        etaText.innerText = "";
        if (data.title) infoZone.innerText = data.title;
      } else if (data.status === "success") {
        stopKeepAlive();
        statusText.innerText = "✅ เสร็จเรียบร้อย!";
        statusText.style.color = "#30D158";
        percentText.innerText = "100%";
        progressBar.style.width = "100%";
        speedText.innerText = "บันทึกในโฟลเดอร์แล้ว";
        etaText.innerText = "";
        downloadBtn.disabled = false;
        
        const cancelBtn = shadowRoot.getElementById("cancel-download-btn");
        if (cancelBtn) cancelBtn.style.display = "none";
        
        setTimeout(() => {
          if (statusText.innerText === "✅ เสร็จเรียบร้อย!") {
            shadowRoot.getElementById("progress-section").style.display = "none";
            updateUIState();
          }
        }, 5000);
      } else if (data.status === "failed" || data.status === "error") {
        stopKeepAlive();
        const err = data.error || data.message || "ดาวน์โหลดล้มเหลว";
        statusText.innerText = "❌ ดาวน์โหลดล้มเหลว";
        statusText.style.color = "#FF453A";
        speedText.innerText = `ข้อผิดพลาด: ${err}`;
        etaText.innerText = "";
        downloadBtn.disabled = false;
        
        const cancelBtn = shadowRoot.getElementById("cancel-download-btn");
        if (cancelBtn) cancelBtn.style.display = "none";
      }
    }
  });
} catch(e) {
  console.warn("[YTDl] Could not register onMessage listener — context may be invalid");
}

// Run check on navigation finish and intervals
document.addEventListener("yt-navigate-finish", () => {
  if (!isCtxValid()) {
    // Extension was reloaded — stop the poll interval and clean up
    if (pollInterval) { clearInterval(pollInterval); pollInterval = null; }
    return;
  }
  injectUI();
  checkYouTubeUrl();
});

// Initial load check
injectUI();
checkYouTubeUrl();

// Periodically check URL — clears itself automatically if context is lost
pollInterval = setInterval(() => {
  if (!isCtxValid()) {
    clearInterval(pollInterval);
    pollInterval = null;
    console.log("[YTDl] Stopped polling — extension context invalidated");
    return;
  }
  checkYouTubeUrl();
}, 1000);