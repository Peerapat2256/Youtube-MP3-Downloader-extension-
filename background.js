// WebSocket server address — yt_server.py listens here
const WS_URL = "ws://localhost:9099";

// Map: tabId -> WebSocket instance (one per active download)
const activeSockets = new Map();

// ─────────────────────────────────────────────────────────────
// Message listener from content scripts
// ─────────────────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const tabId = message.tabId || (sender.tab ? sender.tab.id : null);

  // ── start_download ───────────────────────────────────────────
  if (message.action === "start_download") {
    if (!tabId) {
      sendResponse({ status: "error", message: "Cannot identify tab ID" });
      return;
    }
    if (activeSockets.has(tabId)) {
      sendResponse({ status: "error", message: "Download already running in this tab." });
      return;
    }

    let ws;
    try {
      ws = new WebSocket(WS_URL);
    } catch (e) {
      sendResponse({ status: "error", message: `Cannot connect to yt_server.py: ${e.message}` });
      return;
    }

    activeSockets.set(tabId, ws);

    ws.onopen = () => {
      console.log(`[YTDl] WebSocket connected for tab ${tabId}`);
      const payload = {
        action: "download",
        url: message.url,
        format: message.format,
        target: message.target,
        playlistId: message.playlistId,
        saveFolder: message.saveFolder,
        playlistStart: message.playlistStart,
        playlistEnd: message.playlistEnd,
        urlsList: message.urlsList,
        playlistTitle: message.playlistTitle
      };
      ws.send(JSON.stringify(payload));
      sendResponse({ status: "initiated" });
    };

    ws.onmessage = (event) => {
      let data;
      try { data = JSON.parse(event.data); } catch (e) { return; }
      console.log("[YTDl] Progress:", data);

      chrome.tabs.sendMessage(tabId, {
        action: "download_progress",
        data: data
      }).catch(() => {});

      if (data.status === "success" || data.status === "failed" || data.status === "error") {
        cleanupSocket(tabId);
      }
    };

    ws.onerror = (event) => {
      console.error("[YTDl] WebSocket error");
      chrome.tabs.sendMessage(tabId, {
        action: "download_progress",
        data: {
          status: "error",
          message: "ไม่สามารถเชื่อมต่อกับ yt_server.py ได้ — กรุณาเปิด run_server.bat ก่อน"
        }
      }).catch(() => {});
      cleanupSocket(tabId);
    };

    ws.onclose = (event) => {
      console.log(`[YTDl] WebSocket closed for tab ${tabId} (code=${event.code})`);
      // If closed unexpectedly during download, report error
      if (activeSockets.has(tabId)) {
        chrome.tabs.sendMessage(tabId, {
          action: "download_progress",
          data: { status: "error", message: "การเชื่อมต่อกับ server ถูกตัดขาด" }
        }).catch(() => {});
        cleanupSocket(tabId);
      }
    };

    return true; // keep sendResponse channel open
  }

  // ── cancel_download ──────────────────────────────────────────
  if (message.action === "cancel_download") {
    if (tabId && activeSockets.has(tabId)) {
      const ws = activeSockets.get(tabId);
      if (ws && ws.readyState === WebSocket.OPEN) {
        try {
          ws.send(JSON.stringify({ action: "cancel" }));
        } catch(e) {}
      }
      // Delete from activeSockets map so ws.onclose callback won't trigger connection lost warnings
      activeSockets.delete(tabId);
      sendResponse({ status: "cancelled" });
    } else {
      sendResponse({ status: "error", message: "No active download to cancel" });
    }
    return;
  }

  // ── keep_alive ────────────────────────────────────────────────
  if (message.action === "keep_alive") {
    sendResponse({ status: "alive" });
    return;
  }

  // ── open_folder ──────────────────────────────────────────────
  if (message.action === "open_folder") {
    let ws2;
    try {
      ws2 = new WebSocket(WS_URL);
    } catch (e) {
      sendResponse({ status: "error", message: e.message });
      return;
    }

    ws2.onopen = () => {
      ws2.send(JSON.stringify({ action: "open_folder", saveFolder: message.saveFolder }));
    };
    ws2.onmessage = (event) => {
      sendResponse(JSON.parse(event.data));
      ws2.close();
    };
    ws2.onerror = () => {
      sendResponse({ status: "error", message: "Server not running" });
    };
    ws2.onclose = () => {};

    setTimeout(() => {
      try { ws2.close(); } catch(e) {}
      sendResponse({ status: "success" }); // assume success after timeout
    }, 1500);

    return true;
  }
});

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────
function cleanupSocket(tabId) {
  const ws = activeSockets.get(tabId);
  if (ws) {
    try { ws.close(); } catch (e) {}
    activeSockets.delete(tabId);
    console.log(`[YTDl] Cleaned up WebSocket for tab ${tabId}`);
  }
}
