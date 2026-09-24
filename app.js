const $=s=>document.querySelector(s);
let connected=false,seq=0;
const pending=new Map();
const pad=(n,w=2)=>String(n).padStart(w,'0');
function fmt(ms){const d=new Date(ms);return `${d.getHours()}:${pad(d.getMinutes())}:${pad(d.getSeconds())}.${pad(d.getMilliseconds(),3)}`}
function req(payload){return new Promise((resolve,reject)=>{if(!connected)return reject('未连接扩展');const id='r'+(++seq);pending.set(id,resolve);window.postMessage({source:'url-path-recorder-page',type:'URL_PATH_RECORDER_REQUEST',id,payload},location.origin);setTimeout(()=>{pending.delete(id);reject('超时')},3000)})}
window.addEventListener('message',e=>{const d=e.data;if(!d||d.source!=='url-path-recorder-extension')return;if(d.type==='URL_PATH_RECORDER_READY'){connected=true;update();refresh()}if(d.type==='URL_PATH_RECORDER_RESPONSE'){pending.get(d.id)?.(d.payload);pending.delete(d.id)}});
function update(){const b=$('#connection');b.textContent=connected?'扩展已连接':'未连接扩展';b.className='badge '+(connected?'online':'offline')}
function initIds(){const s=$('#monitorId');for(let i=1;i<=100;i++){let o=document.createElement('option');o.value=String(i).padStart(3,'0');o.textContent=String(i).padStart(3,'0');s.appendChild(o)}}
function render(state){const ms=state.monitors||[];$('#count').textContent=ms.reduce((a,b)=>a+b.records.length,0)+' 条记录';$('#list').innerHTML=ms.length?ms.map(m=>`<div class="item"><b>${m.id}</b> ${m.running?'🟢':'⚪'} ${m.startUrl}<br>${m.records.length} 条记录</div>`).join(''):'<div class="empty">暂无监控</div>';}
async function refresh(){if(!connected)return;let r=await req({type:'getState'});if(r.ok)render(r.state)}
$('#start').onclick=async()=>{await req({type:'start',id:$('#monitorId').value,url:$('#startUrl').value});refresh()};
$('#stop').onclick=async()=>{await req({type:'stop'});refresh()};
$('#clear').onclick=async()=>{await req({type:'clear'});refresh()};
initIds();