const $=s=>document.querySelector(s);
const pad=(n,w=2)=>String(n).padStart(w,"0");
function fmt(ms){
  const d=new Date(ms);
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`;
}
async function state(){return await chrome.storage.local.get({running:false,lockedTabId:null,startUrl:"",records:[]})}
function asText(rs){return rs.map(r=>`${fmt(r.time)}  ${r.url}`).join("\n")}
async function render(){
  const s=await state(), rs=s.records||[];
  $("#count").textContent=`${rs.length} 条记录`;
  $("#badge").textContent=s.running?"记录中":"未运行";
  $("#badge").classList.toggle("on",s.running);
  $("#dot").classList.toggle("on",s.running);
  $("#state").textContent=s.running?`已锁定标签页 #${s.lockedTabId}`:"等待开始";
  if(s.startUrl) $("#startUrl").value=s.startUrl;
  $("#list").innerHTML=rs.length?rs.slice().reverse().map(r=>`<div class="item"><div class="time">${fmt(r.time)}</div><div class="url"></div></div>`).join(""):'<div class="empty">暂无记录</div>';
  if(rs.length){
    [...document.querySelectorAll(".url")].forEach((el,i)=>el.textContent=rs[rs.length-1-i].url);
  }
}
$("#start").onclick=async()=>{
  const res=await chrome.runtime.sendMessage({type:"start",url:$("#startUrl").value});
  if(!res?.ok) alert(res?.error||"启动失败");
  render();
};
$("#stop").onclick=async()=>{await chrome.runtime.sendMessage({type:"stop"});render()};
$("#clear").onclick=async()=>{await chrome.runtime.sendMessage({type:"clear"});render()};
$("#copy").onclick=async()=>{const s=await state();await navigator.clipboard.writeText(asText(s.records||[]))};
$("#export").onclick=async()=>{
  const s=await state(); const blob=new Blob([asText(s.records||[])],{type:"text/plain;charset=utf-8"});
  const u=URL.createObjectURL(blob), a=document.createElement("a"); a.href=u; a.download="url-path.txt"; a.click(); setTimeout(()=>URL.revokeObjectURL(u),1000);
};
chrome.storage.onChanged.addListener(()=>render());
render();