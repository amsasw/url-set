const MAX_RECORDS = 5000;
const APP_URL = "https://amsasw.github.io/url-set/";
let queue = Promise.resolve();

function serial(fn){ queue = queue.then(fn, fn); return queue; }

async function getState(){
  return await chrome.storage.local.get({ monitors: [] });
}

async function saveState(monitors){
  await chrome.storage.local.set({ monitors });
}

async function add(url, tabId){
  if(!/^https?:\/\//i.test(url || "")) return;

  return serial(async()=>{
    const {monitors=[]}=await getState();
    const monitor=monitors.find(x=>x.tabId===tabId && x.running);
    if(!monitor) return;

    const now=Date.now();
    const last=monitor.records[monitor.records.length-1];
    if(last && last.url===url && now-last.time<300) return;

    monitor.records.push({time:now,url});
    if(monitor.records.length>MAX_RECORDS){
      monitor.records.splice(0,monitor.records.length-MAX_RECORDS);
    }

    await saveState(monitors);
  });
}

chrome.action.onClicked.addListener(()=>{
  chrome.tabs.create({url:APP_URL});
});

chrome.runtime.onMessage.addListener((msg,sender,sendResponse)=>{

 if(msg?.type==="getState"){
   getState().then(state=>sendResponse({ok:true,state}));
   return true;
 }

 if(msg?.type==="start"){
  (async()=>{
    let id=String(msg.id||"001").padStart(3,"0");
    let url=(msg.url||"").trim();
    if(!/^https?:\/\//i.test(url)) url="https://"+url;

    const {monitors=[]}=await getState();
    const old=monitors.find(x=>x.id===id);
    if(old && old.running) throw new Error("编号正在使用");

    const tab=await chrome.tabs.create({url:"about:blank",active:true});
    const monitor={
      id,
      tabId:tab.id,
      startUrl:url,
      running:true,
      records:[]
    };

    const list=monitors.filter(x=>x.id!==id);
    list.push(monitor);
    await saveState(list);
    await chrome.tabs.update(tab.id,{url});
    sendResponse({ok:true,id});
  })().catch(e=>sendResponse({ok:false,error:String(e)}));
  return true;
 }

 if(msg?.type==="stop"){
  getState().then(({monitors})=>{
   monitors.forEach(x=>x.running=false);
   saveState(monitors).then(()=>sendResponse({ok:true}));
  });
  return true;
 }

 if(msg?.type==="clear"){
  chrome.storage.local.set({monitors:[]}).then(()=>sendResponse({ok:true}));
  return true;
 }
});

chrome.webRequest.onBeforeRequest.addListener(d=>add(d.url,d.tabId),{urls:["<all_urls>"],types:["main_frame"]});
chrome.webRequest.onBeforeRedirect.addListener(d=>add(d.redirectUrl,d.tabId),{urls:["<all_urls>"],types:["main_frame"]});
chrome.webNavigation.onCommitted.addListener(d=>{if(d.frameId===0)add(d.url,d.tabId);});
chrome.webNavigation.onHistoryStateUpdated.addListener(d=>{if(d.frameId===0)add(d.url,d.tabId);});

chrome.tabs.onRemoved.addListener(async tabId=>{
 const {monitors=[]}=await getState();
 const m=monitors.find(x=>x.tabId===tabId);
 if(m){m.running=false; await saveState(monitors);}
});