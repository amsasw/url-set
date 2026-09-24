(() => {
  const PAGE_ORIGIN = "https://amsasw.github.io";
  if (location.origin !== PAGE_ORIGIN || !location.pathname.startsWith("/url-set/")) return;

  function reply(id, payload) {
    window.postMessage({
      source: "url-path-recorder-extension",
      type: "URL_PATH_RECORDER_RESPONSE",
      id,
      payload
    }, location.origin);
  }

  window.addEventListener("message", async (event) => {
    if (event.source !== window || event.origin !== location.origin) return;
    const data = event.data;
    if (!data || data.source !== "url-path-recorder-page" || data.type !== "URL_PATH_RECORDER_REQUEST") return;

    try {
      const response = await chrome.runtime.sendMessage(data.payload || {});
      reply(data.id, response);
    } catch (error) {
      reply(data.id, { ok: false, error: String(error) });
    }
  });

  window.postMessage({
    source: "url-path-recorder-extension",
    type: "URL_PATH_RECORDER_READY"
  }, location.origin);

  chrome.storage.onChanged.addListener(async () => {
    try {
      const response = await chrome.runtime.sendMessage({ type: "getState" });
      window.postMessage({
        source: "url-path-recorder-extension",
        type: "URL_PATH_RECORDER_STATE",
        payload: response
      }, location.origin);
    } catch {}
  });
})();