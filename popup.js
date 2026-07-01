document.addEventListener("DOMContentLoaded", async () => {
  // Check active tab
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (!tab || !tab.url || !tab.url.includes("youtube.com")) {
    document.getElementById("not-yt").classList.remove("hidden");
    return;
  }

  document.getElementById("download-zone").classList.remove("hidden");
  const ytInfo = parseYouTubeUrl(tab.url);
  
  if (ytInfo.type === "playlist") {
    document.getElementById("playlist-option").classList.remove("hidden");
    document.getElementById("option-single-video").style.display = "none";
  } else if (ytInfo.type === "video_in_playlist") {
    document.getElementById("playlist-option").classList.remove("hidden");
    document.getElementById("option-single-video").style.display = "block";
  }

  const btn = document.getElementById("download-btn");
  const statusZone = document.getElementById("status-zone");

  btn.addEventListener("click", () => {
    const format = document.getElementById("format-select").value;
    let target = "single";
    
    if (!document.getElementById("playlist-option").classList.contains("hidden")) {
      target = document.querySelector('input[name="target"]:checked').value;
    }

    btn.disabled = true;
    statusZone.style.display = "block";
    statusZone.className = "status-loading";
    statusZone.innerText = "⏳ กำลังเชื่อมต่อระบบดาวน์โหลด...";

    // Send action to background.js instead of calling native host directly
    chrome.runtime.sendMessage({
      action: "start_download",
      url: tab.url,
      tabId: tab.id,
      format: format,
      target: target,
      playlistId: ytInfo.playlistId
    }, (res) => {
      if (chrome.runtime.lastError || (res && res.status === "error")) {
        btn.disabled = false;
        statusZone.className = "status-error";
        statusZone.innerText = "❌ การเชื่อมต่อหลังบ้านล้มเหลว";
        console.error(chrome.runtime.lastError ? chrome.runtime.lastError.message : (res ? res.message : "Error"));
      }
    });
  });

  // Listen for progress updates forwarded from background.js
  chrome.runtime.onMessage.addListener((message) => {
    if (message.action === "download_progress") {
      const data = message.data;
      
      if (data.status === "downloading") {
        statusZone.className = "status-loading";
        let progressText = `📥 โหลดแล้ว: ${data.progress || 0}%`;
        if (data.speed) {
          progressText += ` (${data.speed})`;
        }
        statusZone.innerText = progressText;
      } 
      else if (data.status === "converting") {
        statusZone.className = "status-loading";
        statusZone.innerText = "⚙️ กำลังแปลงไฟล์เป็น MP3...";
      } 
      else if (data.status === "success") {
        btn.disabled = false;
        statusZone.className = "status-success";
        statusZone.innerText = "✅ ดาวน์โหลดเรียบร้อย!";
      } 
      else if (data.status === "failed" || data.status === "error") {
        btn.disabled = false;
        statusZone.className = "status-error";
        statusZone.innerText = `❌ ล้มเหลว: ${data.error || data.message || "เกิดข้อผิดพลาด"}`;
      }
    }
  });
});

function parseYouTubeUrl(url) {
  let type = "unknown"; let playlistId = null;
  try {
    const urlObj = new URL(url);
    if (urlObj.pathname.includes("watch")) {
      type = "video";
      if (urlObj.searchParams.has("list")) { type = "video_in_playlist"; playlistId = urlObj.searchParams.get("list"); }
    } else if (urlObj.pathname.includes("playlist")) {
      type = "playlist"; playlistId = urlObj.searchParams.get("list");
    }
  } catch (e) {}
  return { type, playlistId };
}