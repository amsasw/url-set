(() => {
  const PAGE_ORIGIN = "https://amsasw.github.io";
  const PAGE_PATH = "/url-set/";
  const EXTENSION_VERSION = "0.7.0";
  const API_VERSION = 3;

  if (location.origin !== PAGE_ORIGIN || !location.pathname.startsWith(PAGE_PATH)) return;

  function post(type, payload = {}) {
    window.postMessage({
      source: "url-path-recorder-extension",
      type,
      payload
    }, location.origin);
  }

  function reply(id, payload) {
    window.postMessage({
      source: "url-path-recorder-extension",
      type: "URL_PATH_RECORDER_RESPONSE",
      id,
      payload
    }, location.origin);
  }

  function ready() {
    post("URL_PATH_RECORDER_READY", {
      extensionVersion: EXTENSION_VERSION,
      apiVersion: API_VERSION
    });
  }

  window.addEventListener("message", async event => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "url-path-recorder-page") return;

    if (data.type === "URL_PATH_RECORDER_PING") {
      ready();
      return;
    }

    if (data.type !== "URL_PATH_RECORDER_REQUEST") return;

    try {
      const response = await chrome.runtime.sendMessage(data.payload || {});
      reply(data.id, response);
    } catch (error) {
      reply(data.id, { ok: false, error: error?.message || String(error) });
    }
  });

  ready();

  chrome.storage.onChanged.addListener(async (changes, areaName) => {
    if (areaName !== "local" || !changes.monitors) return;

    try {
      const response = await chrome.runtime.sendMessage({ type: "getState" });
      post("URL_PATH_RECORDER_STATE", response);
    } catch {}
  });
})();
