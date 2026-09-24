const $ = s => document.querySelector(s);
let connected = false;
let seq = 0;
const pending = new Map();

const pad = (n, w = 2) => String(n).padStart(w, "0");

function fmt(ms) {
  const d = new Date(ms);
  return d.getFullYear() + "-" +
    pad(d.getMonth() + 1) + "-" +
    pad(d.getDate()) + " " +
    pad(d.getHours()) + ":" +
    pad(d.getMinutes()) + ":" +
    pad(d.getSeconds()) + "." +
    pad(d.getMilliseconds(), 3);
}

function request(payload, timeout = 2500) {
  return new Promise((resolve, reject) => {
    if (!connected) {
      reject(new Error("扩展未连接"));
      return;
    }

    const id = "req-" + Date.now() + "-" + (++seq);
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

  if (data.type === "URL_PATH_RECORDER_STATE") {
    if (data.payload && data.payload.ok) {
      render(data.payload.state);
    }
  }
});

function updateConnection() {
  const badge = $("#connection");
  badge.textContent = connected ? "扩展已连接" : "未连接扩展";
  badge.className = "badge " + (connected ? "online" : "offline");

  $("#start").disabled = !connected;
  $("#stop").disabled = !connected;
  $("#clear").disabled = !connected;
}

function asText(records) {
  return records.map(r => fmt(r.time) + "  " + r.url).join("\n");
}

function render(state) {
  const records = (state && state.records) || [];

  $("#count").textContent = records.length + " 条记录";
  $("#dot").classList.toggle("on", !!(state && state.running));
  $("#state").textContent =
    state && state.running
      ? "已锁定标签页 #" + state.lockedTabId
      : "等待开始";

  if (state && state.startUrl) {
    $("#startUrl").value = state.startUrl;
  }

  const list = $("#list");
  list.textContent = "";

  if (!records.length) {
    const empty = document.createElement("div");
    empty.className = "empty";
    empty.textContent = "暂无记录";
    list.appendChild(empty);
    return;
  }

  for (const record of [...records].reverse()) {
    const item = document.createElement("div");
    item.className = "item";

    const time = document.createElement("div");
    time.className = "time";
    time.textContent = fmt(record.time);

    const url = document.createElement("div");
    url.className = "url";
    url.textContent = record.url;

    item.append(time, url);
    list.appendChild(item);
  }
}

async function refresh() {
  if (!connected) return;
  try {
    const response = await request({ type: "getState" });
    if (response && response.ok) {
      render(response.state);
    }
  } catch {}
}

$("#start").onclick = async () => {
  try {
    const response = await request({
      type: "start",
      url: $("#startUrl").value
    }, 5000);

    if (!response || !response.ok) {
      throw new Error((response && response.error) || "启动失败");
    }

    await refresh();
  } catch (error) {
    alert(error.message);
  }
};

$("#stop").onclick = async () => {
  try {
    await request({ type: "stop" });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
};

$("#clear").onclick = async () => {
  try {
    await request({ type: "clear" });
    await refresh();
  } catch (error) {
    alert(error.message);
  }
};

$("#copy").onclick = async () => {
  try {
    const response = await request({ type: "getState" });
    await navigator.clipboard.writeText(
      asText((response && response.state && response.state.records) || [])
    );
  } catch (error) {
    alert(error.message);
  }
};

$("#export").onclick = async () => {
  try {
    const response = await request({ type: "getState" });
    const records =
      (response && response.state && response.state.records) || [];

    const blob = new Blob([asText(records)], {
      type: "text/plain;charset=utf-8"
    });

    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "url-path.txt";
    a.click();

    setTimeout(() => URL.revokeObjectURL(url), 1000);
  } catch (error) {
    alert(error.message);
  }
};

updateConnection();
setInterval(refresh, 1000);