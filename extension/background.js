const EXTENSION_VERSION = "0.7.0";
const API_VERSION = 3;
const MAX_RECORDS_PER_MONITOR = 5000;
const APP_URL = "https://amsasw.github.io/url-set/";

let queue = Promise.resolve();

function serial(fn) {
  queue = queue.then(fn, fn);
  return queue;
}

function normalizeId(value) {
  const n = Number.parseInt(String(value || "1"), 10);
  if (!Number.isInteger(n) || n < 1 || n > 100) {
    throw new Error("监控编号必须在 001-100 之间");
  }
  return String(n).padStart(3, "0");
}

function defaultName(url, id) {
  try {
    return new URL(url).hostname || `监控 ${id}`;
  } catch {
    return `监控 ${id}`;
  }
}

function normalizeMonitor(raw) {
  const tabIds = Array.isArray(raw?.tabIds)
    ? raw.tabIds.filter(Number.isInteger)
    : Number.isInteger(raw?.tabId)
      ? [raw.tabId]
      : [];

  const records = Array.isArray(raw?.records)
    ? raw.records
        .filter(r => r && typeof r.url === "string" && Number.isFinite(r.time))
        .map(r => ({
          time: r.time,
          url: r.url,
          tabId: Number.isInteger(r.tabId) ? r.tabId : null
        }))
    : [];

  return {
    id: String(raw?.id || "001").padStart(3, "0"),
    name: String(raw?.name || defaultName(raw?.startUrl || "", raw?.id || "001")).slice(0, 80),
    startUrl: String(raw?.startUrl || ""),
    running: Boolean(raw?.running),
    rootTabId: Number.isInteger(raw?.rootTabId)
      ? raw.rootTabId
      : Number.isInteger(raw?.tabId)
        ? raw.tabId
        : tabIds[0] ?? null,
    tabIds: [...new Set(tabIds)],
    records,
    createdAt: Number.isFinite(raw?.createdAt) ? raw.createdAt : Date.now(),
    updatedAt: Number.isFinite(raw?.updatedAt) ? raw.updatedAt : Date.now()
  };
}

async function getState() {
  const stored = await chrome.storage.local.get({ monitors: [] });
  const monitors = (stored.monitors || []).map(normalizeMonitor);
  return {
    monitors,
    meta: {
      extensionVersion: EXTENSION_VERSION,
      apiVersion: API_VERSION,
      maxRecordsPerMonitor: MAX_RECORDS_PER_MONITOR
    }
  };
}

async function saveMonitors(monitors) {
  await chrome.storage.local.set({
    monitors: monitors.map(normalizeMonitor)
  });
}

function monitorOwnsTab(monitor, tabId) {
  return Boolean(monitor?.running) && normalizeMonitor(monitor).tabIds.includes(tabId);
}

async function attachRelatedTab(sourceTabId, newTabId) {
  if (!Number.isInteger(sourceTabId) || !Number.isInteger(newTabId) || newTabId < 0) return null;

  return serial(async () => {
    const { monitors } = await getState();
    const monitor = monitors.find(m => monitorOwnsTab(m, sourceTabId));
    if (!monitor) return null;

    if (!monitor.tabIds.includes(newTabId)) {
      monitor.tabIds.push(newTabId);
      monitor.updatedAt = Date.now();
      await saveMonitors(monitors);
    }

    return monitor.id;
  });
}

async function addRecord(url, tabId, eventTime) {
  if (!/^https?:\/\//i.test(url || "")) return;
  if (!Number.isInteger(tabId) || tabId < 0) return;

  return serial(async () => {
    const { monitors } = await getState();
    const monitor = monitors.find(m => monitorOwnsTab(m, tabId));
    if (!monitor) return;

    const time = Number.isFinite(eventTime) ? eventTime : Date.now();
    monitor.records.push({ time, url, tabId });

    if (monitor.records.length > MAX_RECORDS_PER_MONITOR) {
      monitor.records.splice(0, monitor.records.length - MAX_RECORDS_PER_MONITOR);
    }

    monitor.updatedAt = Date.now();
    await saveMonitors(monitors);
  });
}

async function startMonitor(msg) {
  const id = normalizeId(msg.id);
  let url = String(msg.url || "").trim();
  if (!/^https?:\/\//i.test(url)) url = `https://${url}`;

  const parsed = new URL(url);
  if (!["http:", "https:"].includes(parsed.protocol)) {
    throw new Error("只支持 http / https 地址");
  }

  const name = String(msg.name || "").trim().slice(0, 80) || defaultName(parsed.href, id);
  const { monitors } = await getState();
  const existing = monitors.find(m => m.id === id);

  if (existing?.running) {
    throw new Error(`编号 ${id} 正在使用`);
  }

  const tab = await chrome.tabs.create({ url: "about:blank", active: true });
  const now = Date.now();

  if (existing) {
    existing.name = name;
    existing.startUrl = parsed.href;
    existing.running = true;
    existing.rootTabId = tab.id;
    existing.tabIds = [tab.id];
    existing.updatedAt = now;
  } else {
    monitors.push({
      id,
      name,
      startUrl: parsed.href,
      running: true,
      rootTabId: tab.id,
      tabIds: [tab.id],
      records: [],
      createdAt: now,
      updatedAt: now
    });
  }

  await saveMonitors(monitors);
  await chrome.tabs.update(tab.id, { url: parsed.href });

  return { id, tabId: tab.id, resumed: Boolean(existing) };
}

async function mutateMonitor(idValue, mutator) {
  const id = normalizeId(idValue);
  const { monitors } = await getState();
  const monitor = monitors.find(m => m.id === id);
  if (!monitor) throw new Error(`找不到监控 ${id}`);
  await mutator(monitor, monitors);
  monitor.updatedAt = Date.now();
  await saveMonitors(monitors);
  return monitor;
}

async function getDiagnostics() {
  const state = await getState();
  const running = state.monitors.filter(m => m.running);
  return {
    extensionVersion: EXTENSION_VERSION,
    apiVersion: API_VERSION,
    serviceWorker: "ok",
    monitorCount: state.monitors.length,
    runningMonitorCount: running.length,
    associatedTabCount: running.reduce((sum, m) => sum + m.tabIds.length, 0),
    recordCount: state.monitors.reduce((sum, m) => sum + m.records.length, 0),
    timestamp: Date.now()
  };
}

chrome.action.onClicked.addListener(() => {
  chrome.tabs.create({ url: APP_URL });
});

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    switch (msg?.type) {
      case "getState":
        return { ok: true, state: await getState() };

      case "getDiagnostics":
        return { ok: true, diagnostics: await getDiagnostics() };

      case "start":
        return { ok: true, ...(await startMonitor(msg)) };

      case "stopMonitor":
        await mutateMonitor(msg.id, monitor => {
          monitor.running = false;
        });
        return { ok: true };

      case "clearMonitor":
        await mutateMonitor(msg.id, monitor => {
          monitor.records = [];
        });
        return { ok: true };

      case "deleteMonitor": {
        const id = normalizeId(msg.id);
        const { monitors } = await getState();
        await saveMonitors(monitors.filter(m => m.id !== id));
        return { ok: true };
      }

      case "renameMonitor":
        await mutateMonitor(msg.id, monitor => {
          const name = String(msg.name || "").trim().slice(0, 80);
          if (!name) throw new Error("名称不能为空");
          monitor.name = name;
        });
        return { ok: true };

      case "stopAll": {
        const { monitors } = await getState();
        for (const monitor of monitors) monitor.running = false;
        await saveMonitors(monitors);
        return { ok: true };
      }

      case "clearAll":
        await chrome.storage.local.set({ monitors: [] });
        return { ok: true };

      default:
        return { ok: false, error: "未知请求" };
    }
  })()
    .then(sendResponse)
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));

  return true;
});

chrome.webRequest.onBeforeRequest.addListener(
  details => addRecord(details.url, details.tabId, details.timeStamp),
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webRequest.onBeforeRedirect.addListener(
  details => addRecord(details.redirectUrl, details.tabId, details.timeStamp),
  { urls: ["<all_urls>"], types: ["main_frame"] }
);

chrome.webNavigation.onCommitted.addListener(details => {
  if (details.frameId === 0) addRecord(details.url, details.tabId, details.timeStamp);
});

chrome.webNavigation.onHistoryStateUpdated.addListener(details => {
  if (details.frameId === 0) addRecord(details.url, details.tabId, details.timeStamp);
});

chrome.webNavigation.onReferenceFragmentUpdated.addListener(details => {
  if (details.frameId === 0) addRecord(details.url, details.tabId, details.timeStamp);
});

chrome.webNavigation.onCreatedNavigationTarget.addListener(details => {
  attachRelatedTab(details.sourceTabId, details.tabId).then(monitorId => {
    if (monitorId && details.url) {
      addRecord(details.url, details.tabId, details.timeStamp);
    }
  });
});

chrome.tabs.onCreated.addListener(tab => {
  if (!Number.isInteger(tab.openerTabId)) return;

  attachRelatedTab(tab.openerTabId, tab.id).then(monitorId => {
    if (!monitorId) return;
    const firstUrl = tab.pendingUrl || tab.url;
    if (firstUrl) addRecord(firstUrl, tab.id, Date.now());
  });
});

chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.url) addRecord(changeInfo.url, tabId, Date.now());
});

chrome.tabs.onRemoved.addListener(tabId => {
  serial(async () => {
    const { monitors } = await getState();
    let changed = false;

    for (const monitor of monitors) {
      if (!monitor.tabIds.includes(tabId)) continue;
      monitor.tabIds = monitor.tabIds.filter(id => id !== tabId);
      monitor.updatedAt = Date.now();
      if (monitor.tabIds.length === 0) monitor.running = false;
      changed = true;
    }

    if (changed) await saveMonitors(monitors);
  });
});
