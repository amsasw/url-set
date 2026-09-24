const MAX_RECORDS = 5000;
const APP_URL = "https://amsasw.github.io/url-set/";
let queue = Promise.resolve();

function serial(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

async function getState() {
  return await chrome.storage.local.get({
    running: false,
    lockedTabId: null,
    startUrl: "",
    records: []
  });
}

async function add(url, tabId) {
  if (!/^https?:\/\//i.test(url || "")) return;

  return serial(async () => {
    const s = await getState();
    if (!s.running || tabId !== s.lockedTabId) return;

    const now = Date.now();
    const records = s.records || [];
    const last = records[records.length - 1];

    // 极短时间内由多个浏览器事件产生的同 URL 视为一次。
    if (last && last.url === url && now - last.time < 300) return;

    records.push({ time: now, url });
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }

    await chrome.storage.local.set({ records });
  });
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: APP_URL });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "getState") {
    getState()
      .then(state => sendResponse({ ok: true, state }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (msg?.type === "start") {
    (async () => {
      let url = (msg.url || "").trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;

      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("只支持 http / https 地址");
      }

      const tab = await chrome.tabs.create({ url: "about:blank", active: true });

      await chrome.storage.local.set({
        running: true,
        lockedTabId: tab.id,
        startUrl: parsed.href,
        records: []
      });

      await chrome.tabs.update(tab.id, { url: parsed.href });
      sendResponse({ ok: true, tabId: tab.id });
    })().catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (msg?.type === "stop") {
    chrome.storage.local
      .set({ running: false })
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (msg?.type === "clear") {
    chrome.storage.local
      .set({ records: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  details => {
    if (details.tabId >= 0) add(details.url, details.tabId);
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webRequest.onBeforeRedirect.addListener(
  details => {
    if (details.tabId >= 0 && details.redirectUrl) {
      add(details.redirectUrl, details.tabId);
    }
  },
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0 && details.tabId >= 0) {
    add(details.url, details.tabId);
  }
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0 && details.tabId >= 0) {
    add(details.url, details.tabId);
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const s = await getState();
  if (s.lockedTabId === tabId) {
    await chrome.storage.local.set({
      running: false,
      lockedTabId: null
    });
  }
});