const MAX_RECORDS = 5000;
let queue = Promise.resolve();

function serial(fn){ queue = queue.then(fn, fn); return queue; }

async function getState(){
  return await chrome.storage.local.get({
    running:false, lockedTabId:null, startUrl:"", records:[]
  });
}

async function add(url, tabId){
  if (!/^https?:\/\//i.test(url || "")) return;
  return serial(async()=>{
    const s = await getState();
    if (!s.running || tabId !== s.lockedTabId) return;

    const now = Date.now();
    const records = s.records || [];
    const last = records[records.length-1];

    // 同一 URL 在极短时间内可能同时来自 webRequest/webNavigation，去重。
    if (last && last.url === url && now - last.time < 300) return;

    records.push({time:now, url});
    if(records.length > MAX_RECORDS) records.splice(0, records.length-MAX_RECORDS);
    await chrome.storage.local.set({records});
  });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse)=>{
  if(msg?.type === "start"){
    (async()=>{
      let url = (msg.url || "").trim();
      if(!/^https?:\/\//i.test(url)) url = "https://" + url;

      const tab = await chrome.tabs.create({url:"about:blank", active:true});
      await chrome.storage.local.set({
        running:true,
        lockedTabId:tab.id,
        startUrl:url,
        records:[]
      });
      await chrome.tabs.update(tab.id, {url});
      sendResponse({ok:true, tabId:tab.id});
    })().catch(e=>sendResponse({ok:false,error:String(e)}));
    return true;
  }

  if(msg?.type === "stop"){
    chrome.storage.local.set({running:false}).then(()=>sendResponse({ok:true}));
    return true;
  }

  if(msg?.type === "clear"){
    chrome.storage.local.set({records:[]}).then(()=>sendResponse({ok:true}));
    return true;
  }
});

chrome.webRequest.onBeforeRequest.addListener(
  d=>{ if(d.tabId >= 0) add(d.url,d.tabId); },
  {urls:["<all_urls>"], types:["main_frame"]}
);

chrome.webRequest.onBeforeRedirect.addListener(
  d=>{ if(d.tabId >= 0 && d.redirectUrl) add(d.redirectUrl,d.tabId); },
  {urls:["<all_urls>"], types:["main_frame"]}
);

chrome.webNavigation.onCommitted.addListener(
  d=>{ if(d.frameId===0 && d.tabId>=0) add(d.url,d.tabId); }
);

chrome.webNavigation.onHistoryStateUpdated.addListener(
  d=>{ if(d.frameId===0 && d.tabId>=0) add(d.url,d.tabId); }
);

chrome.tabs.onRemoved.addListener(async(tabId)=>{
  const s=await getState();
  if(s.lockedTabId===tabId) await chrome.storage.local.set({running:false,lockedTabId:null});
});