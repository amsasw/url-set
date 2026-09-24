const MAX_RECORDS = 5000;
const APP_URL = "https://amsasw.github.io/url-set/";
let queue = Promise.resolve();

function serial(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

function normalizeMonitor(m) {
  const tabIds = Array.isArray(m.tabIds)
    ? m.tabIds.filter(Number.isInteger)
    : (Number.isInteger(m.tabId) ? [m.tabId] : []);

  return {
    ...m,
    tabIds: [...new Set(tabIds)],
    records: Array.isArray(m.records) ? m.records : []
  };
}

async function getState() {
  const { monitors = [] } = await chrome.storage.local.get({ monitors: [] });
  return { monitors: monitors.map(normalizeMonitor) };
}

async function saveState(monitors) {
  await chrome.storage.local.set({
    monitors: monitors.map(normalizeMonitor)
  });
}

function monitorOwnsTab(monitor, tabId) {
  return monitor.running && normalizeMonitor(monitor).tabIds.includes(tabId);
}

async function attachRelatedTab(sourceTabId, newTabId) {
  if (!Number.isInteger(sourceTabId) || !Number.isInteger(newTabId) || newTabId < 0) return;

  return serial(async () => {
    const { monitors = [] } = await getState();
    const monitor = monitors.find(m => monitorOwnsTab(m, sourceTabId));
    if (!monitor) return;

    monitor.tabIds = normalizeMonitor(monitor).tabIds;
    if (!monitor.tabIds.includes(newTabId)) {
      monitor.tabIds.push(newTabId);
      await saveState(monitors);
    }
  });
}

async function add(url, tabId) {
  if (!/^https?:\/\//i.test(url || "") || !Number.isInteger(tabId) || tabId < 0) return;

  return serial(async () => {
    const { monitors = [] } = await getState();
    const monitor = monitors.find(m => monitorOwnsTab(m, tabId));
    if (!monitor) return;

    const now = Date.now();
    const records = monitor.records || [];
    const last = records[records.length - 1];

    // 多个浏览器事件可能在极短时间内报告同一地址。
    if (last && last.url === url && now - last.time < 300) return;

    records.push({ time: now, url });
    if (records.length > MAX_RECORDS) {
      records.splice(0, records.length - MAX_RECORDS);
    }

    monitor.records = records;
    await saveState(monitors);
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
      const id = String(msg.id || "001").padStart(3, "0");
      let url = (msg.url || "").trim();
      if (!/^https?:\/\//i.test(url)) url = "https://" + url;

      const parsed = new URL(url);
      if (!["http:", "https:"].includes(parsed.protocol)) {
        throw new Error("只支持 http / https 地址");
      }

      const { monitors = [] } = await getState();
      const old = monitors.find(x => x.id === id);
      if (old && old.running) throw new Error("编号正在使用");

      const tab = await chrome.tabs.create({ url: "about:blank", active: true });

      const monitor = {
        id,
        tabId: tab.id,
        tabIds: [tab.id],
        startUrl: parsed.href,
        running: true,
        records: []
      };

      const list = monitors.filter(x => x.id !== id);
      list.push(monitor);

      await saveState(list);
      await chrome.tabs.update(tab.id, { url: parsed.href });

      sendResponse({ ok: true, id, tabId: tab.id });
    })().catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (msg?.type === "stop") {
    getState()
      .then(async ({ monitors }) => {
        monitors.forEach(m => { m.running = false; });
        await saveState(monitors);
        sendResponse({ ok: true });
      })
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }

  if (msg?.type === "clear") {
    chrome.storage.local
      .set({ monitors: [] })
      .then(() => sendResponse({ ok: true }))
      .catch(error => sendResponse({ ok: false, error: String(error) }));
    return true;
  }
});

// HTTP 请求/重定向。
chrome.webRequest.onBeforeRequest.addListener(
  d => add(d.url, d.tabId),
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webRequest.onBeforeRedirect.addListener(
  d => add(d.redirectUrl, d.tabId),
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

// 同一标签页里的常规导航和 History API 导航。
chrome.webNavigation.onCommitted.addListener(d => {
  if (d.frameId === 0) add(d.url, d.tabId);
});

chrome.webNavigation.onHistoryStateUpdated.addListener(d => {
  if (d.frameId === 0) add(d.url, d.tabId);
});

// 关键：OAuth / 登录 / 验证流程如果创建新标签页或窗口，
// 自动把新 tabId 归到来源监控编号下。
chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  attachRelatedTab(details.sourceTabId, details.tabId).then(() => {
    // 目标标签页的第一个 OAuth/验证 URL 可能在关联建立前就开始加载，
    // 因此关联完成后立即补记事件自带的 URL。
    if (details.url) add(details.url, details.tabId);
  });
});

// 额外覆盖 window.open / target=_blank 等带 openerTabId 的情况。
chrome.tabs.onCreated.addListener(tab => {
  if (Number.isInteger(tab.openerTabId)) {
    attachRelatedTab(tab.openerTabId, tab.id).then(() => {
      const firstUrl = tab.pendingUrl || tab.url;
      if (firstUrl) add(firstUrl, tab.id);
    });
  }
});

chrome.tabs.onRemoved.addListener(async tabId => {
  const { monitors = [] } = await getState();
  let changed = false;

  for (const monitor of monitors) {
    const ids = normalizeMonitor(monitor).tabIds;
    if (!ids.includes(tabId)) continue;

    monitor.tabIds = ids.filter(id => id !== tabId);
    changed = true;

    // 只有该监控关联的所有标签页都关闭后，才停止监控。
    if (monitor.tabIds.length === 0) {
      monitor.running = false;
    }
  }

  if (changed) await saveState(monitors);
});