const WEB_VERSION = "0.7.0";
const REQUIRED_API_VERSION = 3;
const SENSITIVE_KEYS = new Set([
  "code", "token", "access_token", "id_token", "refresh_token", "state",
  "session_state", "assertion", "samlresponse", "samlrequest", "ticket"
]);

const $ = selector => document.querySelector(selector);
const pad = (n, width = 2) => String(n).padStart(width, "0");

let connected = false;
let compatible = false;
let extensionVersion = "未知";
let apiVersion = 0;
let seq = 0;
let lastState = { monitors: [], meta: {} };
let lastDiagnostics = null;
let lastRefreshAt = 0;
const pending = new Map();
const expanded = new Set(JSON.parse(localStorage.getItem("urlpr-expanded") || "[]"));

function fmt(ms) {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(), 3)}`;
}

function fmtDelta(ms) {
  if (!Number.isFinite(ms) || ms < 0) return "";
  if (ms < 1000) return `+${Math.round(ms)} ms`;
  if (ms < 60000) return `+${(ms / 1000).toFixed(ms < 10000 ? 2 : 1)} s`;
  return `+${(ms / 60000).toFixed(1)} min`;
}

function pingBridge() {
  window.postMessage({
    source: "url-path-recorder-page",
    type: "URL_PATH_RECORDER_PING"
  }, location.origin);
}

function request(payload, timeout = 4000) {
  return new Promise((resolve, reject) => {
    if (!connected) return reject(new Error("扩展未连接"));

    const id = `req-${Date.now()}-${++seq}`;
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error("扩展响应超时"));
    }, timeout);

    pending.set(id, value => {
      clearTimeout(timer);
      resolve(value);
    });

    window.postMessage({
      source: "url-path-recorder-page",
      type: "URL_PATH_RECORDER_REQUEST",
      id,
      payload
    }, location.origin);
  });
}

window.addEventListener("message", event => {
  if (event.source !== window || event.origin !== location.origin) return;
  const data = event.data;
  if (!data || data.source !== "url-path-recorder-extension") return;

  if (data.type === "URL_PATH_RECORDER_READY") {
    connected = true;
    extensionVersion = data.payload?.extensionVersion || extensionVersion;
    apiVersion = Number(data.payload?.apiVersion || apiVersion || 0);
    updateConnection();
    refresh();
    return;
  }

  if (data.type === "URL_PATH_RECORDER_RESPONSE") {
    const done = pending.get(data.id);
    if (done) {
      pending.delete(data.id);
      done(data.payload);
    }
    return;
  }

  if (data.type === "URL_PATH_RECORDER_STATE" && data.payload?.ok) {
    applyState(data.payload.state);
  }
});

function updateConnection() {
  const badge = $("#connection");
  const warning = $("#compatWarning");

  if (!connected) {
    badge.textContent = "未连接扩展";
    badge.className = "badge offline";
    warning.classList.add("hidden");
  } else if (!compatible && apiVersion > 0) {
    badge.textContent = "扩展需要更新";
    badge.className = "badge warn";
    warning.classList.remove("hidden");
  } else {
    badge.textContent = "扩展已连接";
    badge.className = "badge online";
    warning.classList.add("hidden");
  }

  $("#versionBadge").textContent = `Web ${WEB_VERSION} · Core ${extensionVersion}`;
  const disabled = !connected || !compatible;
  $("#start").disabled = disabled;
  $("#stopAll").disabled = disabled;
  $("#clearAll").disabled = disabled;
  $("#exportAllMasked").disabled = !connected;
}

function initIds() {
  const select = $("#monitorId");
  select.textContent = "";
  for (let i = 1; i <= 100; i++) {
    const id = String(i).padStart(3, "0");
    const option = document.createElement("option");
    option.value = id;
    option.textContent = id;
    select.appendChild(option);
  }
}

function updateIdOptions(monitors) {
  const byId = new Map(monitors.map(m => [m.id, m]));
  for (const option of $("#monitorId").options) {
    const monitor = byId.get(option.value);
    option.textContent = monitor
      ? `${option.value} · ${monitor.running ? "运行中" : "已停止"}`
      : option.value;
  }
}

function authLabel(url) {
  const text = String(url || "").toLowerCase();
  const patterns = ["oauth", "authorize", "callback", "login", "verify", "authentication", "sso"];
  return patterns.some(p => text.includes(p)) ? "认证" : "";
}

function maskUrl(raw) {
  try {
    const url = new URL(raw);
    for (const [key] of [...url.searchParams.entries()]) {
      if (SENSITIVE_KEYS.has(key.toLowerCase())) url.searchParams.set(key, "***");
    }

    if (url.hash && url.hash.includes("=")) {
      const hashParams = new URLSearchParams(url.hash.replace(/^#/, ""));
      let changed = false;
      for (const [key] of [...hashParams.entries()]) {
        if (SENSITIVE_KEYS.has(key.toLowerCase())) {
          hashParams.set(key, "***");
          changed = true;
        }
      }
      if (changed) url.hash = "#" + hashParams.toString();
    }
    return url.toString();
  } catch {
    return String(raw).replace(/([?&#](?:code|token|access_token|id_token|refresh_token|state|session_state|ticket)=)[^&#]*/gi, "$1***");
  }
}

function decorateRecords(records) {
  return (records || []).map((record, index, all) => ({
    ...record,
    delta: index === 0 ? null : record.time - all[index - 1].time
  }));
}

function foldConsecutive(records) {
  const groups = [];
  for (const record of decorateRecords(records)) {
    const previous = groups[groups.length - 1];
    if (previous && previous.url === record.url) {
      previous.items.push(record);
      previous.last = record;
    } else {
      groups.push({ url: record.url, items: [record], first: record, last: record });
    }
  }
  return groups;
}

function saveExpanded() {
  localStorage.setItem("urlpr-expanded", JSON.stringify([...expanded]));
}

function makeButton(text, className, handler) {
  const button = document.createElement("button");
  button.textContent = text;
  button.className = className || "secondary small";
  button.addEventListener("click", event => {
    event.stopPropagation();
    handler();
  });
  return button;
}

function makeRecordGroup(group) {
  const row = document.createElement("div");
  row.className = "record-row";

  const meta = document.createElement("div");
  meta.className = "record-meta";

  const time = document.createElement("span");
  time.className = "record-time";
  time.textContent = fmt(group.last.time);
  meta.appendChild(time);

  const delta = fmtDelta(group.last.delta);
  if (delta) {
    const deltaEl = document.createElement("span");
    deltaEl.className = "delta";
    deltaEl.textContent = delta;
    meta.appendChild(deltaEl);
  }

  if (group.items.length > 1) {
    const count = document.createElement("span");
    count.className = "repeat-pill";
    count.textContent = `×${group.items.length}`;
    meta.appendChild(count);
  }

  const urlWrap = document.createElement("div");
  urlWrap.className = "record-url-wrap";

  const label = authLabel(group.url);
  if (label) {
    const tag = document.createElement("span");
    tag.className = "auth-tag";
    tag.textContent = label;
    urlWrap.appendChild(tag);
  }

  const url = document.createElement("div");
  url.className = "record-url";
  url.textContent = group.url;
  urlWrap.appendChild(url);

  if (group.items.length > 1) {
    const details = document.createElement("details");
    details.className = "repeat-details";
    const summary = document.createElement("summary");
    summary.textContent = `查看 ${group.items.length} 次原始时间`;
    details.appendChild(summary);
    for (const item of [...group.items].reverse()) {
      const line = document.createElement("div");
      line.textContent = `${fmt(item.time)} ${fmtDelta(item.delta)}`.trim();
      details.appendChild(line);
    }
    urlWrap.appendChild(details);
  }

  row.append(meta, urlWrap);
  return row;
}

function recordsAsText(monitor, masked = true) {
  const title = `# ${monitor.id} ${monitor.name || ""}`.trim();
  const lines = (monitor.records || []).map(record => {
    const url = masked ? maskUrl(record.url) : record.url;
    return `${fmt(record.time)}  ${url}`;
  });
  return [title, `# ${monitor.startUrl}`, "", ...lines].join("\n");
}

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function runAction(payload, timeout) {
  const response = await request(payload, timeout);
  if (!response?.ok) throw new Error(response?.error || "操作失败");
  await refresh();
  return response;
}

function monitorCard(monitor) {
  const card = document.createElement("section");
  card.className = "monitor-card";
  card.dataset.id = monitor.id;

  const header = document.createElement("div");
  header.className = "monitor-head";

  const titleWrap = document.createElement("div");
  titleWrap.className = "monitor-title";

  const id = document.createElement("strong");
  id.className = "monitor-id";
  id.textContent = monitor.id;

  const name = document.createElement("span");
  name.className = "monitor-name";
  name.textContent = monitor.name || monitor.startUrl;

  const status = document.createElement("span");
  status.className = `monitor-status ${monitor.running ? "running" : "stopped"}`;
  status.textContent = monitor.running ? "● 监控中" : "● 已停止";

  titleWrap.append(id, name, status);

  const stats = document.createElement("span");
  stats.className = "monitor-count";
  stats.textContent = `${(monitor.records || []).length} 条 · ${(monitor.tabIds || []).length} 个标签页`;

  header.append(titleWrap, stats);

  const startUrl = document.createElement("div");
  startUrl.className = "monitor-start-url";
  startUrl.textContent = monitor.startUrl;

  const actions = document.createElement("div");
  actions.className = "monitor-actions";

  const toggle = makeButton(expanded.has(monitor.id) ? "收起" : "查看", "secondary small", () => {
    if (expanded.has(monitor.id)) expanded.delete(monitor.id);
    else expanded.add(monitor.id);
    saveExpanded();
    render(lastState);
  });
  actions.appendChild(toggle);

  if (monitor.running) {
    actions.appendChild(makeButton("停止", "secondary small", async () => {
      try { await runAction({ type: "stopMonitor", id: monitor.id }); }
      catch (error) { alert(error.message); }
    }));
  }

  actions.appendChild(makeButton("改名", "secondary small", async () => {
    const value = prompt("新的监控名称：", monitor.name || "");
    if (value === null) return;
    try { await runAction({ type: "renameMonitor", id: monitor.id, name: value }); }
    catch (error) { alert(error.message); }
  }));

  actions.appendChild(makeButton("复制脱敏", "secondary small", async () => {
    try {
      await navigator.clipboard.writeText(recordsAsText(monitor, true));
    } catch (error) {
      alert(error.message || String(error));
    }
  }));

  actions.appendChild(makeButton("导出脱敏", "secondary small", () => {
    downloadText(`url-path-${monitor.id}-masked.txt`, recordsAsText(monitor, true));
  }));

  actions.appendChild(makeButton("导出原始", "secondary small", () => {
    if (!confirm("原始 URL 可能包含 code、token、state 等敏感参数。确定导出吗？")) return;
    downloadText(`url-path-${monitor.id}-raw.txt`, recordsAsText(monitor, false));
  }));

  actions.appendChild(makeButton("清空记录", "danger small", async () => {
    if (!confirm(`清空监控 ${monitor.id} 的全部记录？`)) return;
    try { await runAction({ type: "clearMonitor", id: monitor.id }); }
    catch (error) { alert(error.message); }
  }));

  actions.appendChild(makeButton("删除", "danger small", async () => {
    if (!confirm(`删除监控 ${monitor.id}？`)) return;
    try { await runAction({ type: "deleteMonitor", id: monitor.id }); }
    catch (error) { alert(error.message); }
  }));

  card.append(header, startUrl, actions);

  if (expanded.has(monitor.id)) {
    const records = document.createElement("div");
    records.className = "records";
    const groups = foldConsecutive(monitor.records || []);

    if (!groups.length) {
      const empty = document.createElement("div");
      empty.className = "records-empty";
      empty.textContent = "等待 URL 变化…";
      records.appendChild(empty);
    } else {
      for (const group of [...groups].reverse()) records.appendChild(makeRecordGroup(group));
    }

    card.appendChild(records);
  }

  return card;
}

function renderDiagnostics() {
  const body = $("#diagnosticsBody");
  body.textContent = "";
  const rows = [
    ["连接状态", connected ? "已连接" : "未连接"],
    ["Web UI", WEB_VERSION],
    ["Extension Core", extensionVersion],
    ["API", String(apiVersion || "未知")],
    ["Service Worker", lastDiagnostics?.serviceWorker || (connected ? "待检测" : "不可用")],
    ["监控任务", String(lastDiagnostics?.monitorCount ?? lastState.monitors.length)],
    ["运行中", String(lastDiagnostics?.runningMonitorCount ?? lastState.monitors.filter(m => m.running).length)],
    ["关联标签页", String(lastDiagnostics?.associatedTabCount ?? lastState.monitors.reduce((a, m) => a + (m.tabIds || []).length, 0))],
    ["总记录", String(lastDiagnostics?.recordCount ?? lastState.monitors.reduce((a, m) => a + (m.records || []).length, 0))],
    ["最后刷新", lastRefreshAt ? fmt(lastRefreshAt) : "—"]
  ];

  for (const [key, value] of rows) {
    const k = document.createElement("span");
    k.textContent = key;
    const v = document.createElement("strong");
    v.textContent = value;
    body.append(k, v);
  }
}

function render(state) {
  lastState = state || { monitors: [], meta: {} };
  const monitors = lastState.monitors || [];
  const meta = lastState.meta || {};

  if (meta.extensionVersion) extensionVersion = meta.extensionVersion;
  if (meta.apiVersion) apiVersion = Number(meta.apiVersion);
  compatible = apiVersion >= REQUIRED_API_VERSION;
  updateConnection();
  updateIdOptions(monitors);

  const totalRecords = monitors.reduce((sum, m) => sum + (m.records?.length || 0), 0);
  const activeCount = monitors.filter(m => m.running).length;
  $("#count").textContent = `${totalRecords} 条记录`;
  $("#dot").classList.toggle("on", activeCount > 0);
  $("#state").textContent = activeCount ? `${activeCount} 个监控正在运行` : "等待开始";

  const query = $("#filter").value.trim().toLowerCase();
  const visible = monitors
    .filter(m => !query || [m.id, m.name, m.startUrl].some(v => String(v || "").toLowerCase().includes(query)))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)));

  const list = $("#list");
  list.textContent = "";

  if (!visible.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = monitors.length ? "没有匹配的监控" : "暂无监控";
    list.appendChild(empty);
  } else {
    for (const monitor of visible) list.appendChild(monitorCard(monitor));
  }

  renderDiagnostics();
}

function applyState(state) {
  lastRefreshAt = Date.now();
  render(state);
}

async function refresh() {
  if (!connected) return;
  try {
    const response = await request({ type: "getState" });
    if (response?.ok) applyState(response.state);
  } catch (error) {
    console.warn("refresh failed", error);
  }
}

async function refreshDiagnostics() {
  if (!connected || !compatible) return;
  try {
    const response = await request({ type: "getDiagnostics" });
    if (response?.ok) {
      lastDiagnostics = response.diagnostics;
      renderDiagnostics();
    }
  } catch {}
}

$("#start").addEventListener("click", async () => {
  try {
    await runAction({
      type: "start",
      id: $("#monitorId").value,
      name: $("#monitorName").value,
      url: $("#startUrl").value
    }, 6000);
  } catch (error) {
    alert(error.message || String(error));
  }
});

$("#filter").addEventListener("input", () => render(lastState));

$("#stopAll").addEventListener("click", async () => {
  if (!confirm("停止所有正在运行的监控？")) return;
  try { await runAction({ type: "stopAll" }); }
  catch (error) { alert(error.message); }
});

$("#clearAll").addEventListener("click", async () => {
  if (!confirm("删除全部监控任务和全部记录？此操作不可恢复。")) return;
  try { await runAction({ type: "clearAll" }); }
  catch (error) { alert(error.message); }
});

$("#exportAllMasked").addEventListener("click", () => {
  const monitors = lastState.monitors || [];
  const text = monitors.map(m => recordsAsText(m, true)).join("\n\n");
  downloadText("url-path-all-masked.txt", text || "暂无记录");
});

initIds();
updateConnection();
pingBridge();

setInterval(() => {
  if (!connected) pingBridge();
  else refresh();
}, 1000);

setInterval(refreshDiagnostics, 5000);
