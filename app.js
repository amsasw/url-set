const $=s=>document.querySelector(s);
let connected=false,seq=0;
const pending=new Map();
const pad=(n,w=2)=>String(n).padStart(w,'0');

function fmt(ms){
  const d=new Date(ms);
  return d.getFullYear()+'-'+pad(d.getMonth()+1)+'-'+pad(d.getDate())+' '+pad(d.getHours())+':'+pad(d.getMinutes())+':'+pad(d.getSeconds())+'.'+pad(d.getMilliseconds(),3);
}

function req(payload,timeout=3000){
  return new Promise((resolve,reject)=>{
    if(!connected)return reject(new Error('未连接扩展'));
    const id='r'+(++seq);
    const timer=setTimeout(()=>{pending.delete(id);reject(new Error('扩展响应超时'));},timeout);
    pending.set(id,v=>{clearTimeout(timer);resolve(v);});
    window.postMessage({source:'url-path-recorder-page',type:'URL_PATH_RECORDER_REQUEST',id,payload},location.origin);
  });
}

window.addEventListener('message',e=>{
  if(e.source!==window||e.origin!==location.origin)return;
  const d=e.data;
  if(!d||d.source!=='url-path-recorder-extension')return;

  if(d.type==='URL_PATH_RECORDER_READY'){
    connected=true;
    updateConnection();
    refresh();
    return;
  }

  if(d.type==='URL_PATH_RECORDER_RESPONSE'){
    const done=pending.get(d.id);
    if(done){pending.delete(d.id);done(d.payload);}
    return;
  }

  if(d.type==='URL_PATH_RECORDER_STATE'&&d.payload?.ok){
    render(d.payload.state);
  }
});

function updateConnection(){
  const b=$('#connection');
  b.textContent=connected?'扩展已连接':'未连接扩展';
  b.className='badge '+(connected?'online':'offline');
  $('#start').disabled=!connected;
  $('#stop').disabled=!connected;
  $('#clear').disabled=!connected;
}

function initIds(){
  const s=$('#monitorId');
  s.textContent='';
  for(let i=1;i<=100;i++){
    const id=String(i).padStart(3,'0');
    const o=document.createElement('option');
    o.value=id;o.textContent=id;s.appendChild(o);
  }
}

function recordRow(r){
  const row=document.createElement('div');row.className='record-row';
  const t=document.createElement('div');t.className='record-time';t.textContent=fmt(r.time);
  const u=document.createElement('div');u.className='record-url';u.textContent=r.url;
  row.append(t,u);return row;
}

function monitorCard(m){
  const box=document.createElement('section');box.className='monitor-card';
  const head=document.createElement('div');head.className='monitor-head';
  const title=document.createElement('div');title.className='monitor-title';
  const id=document.createElement('strong');id.className='monitor-id';id.textContent=m.id;
  const status=document.createElement('span');status.className='monitor-status '+(m.running?'running':'stopped');status.textContent=m.running?'● 监控中':'● 已停止';
  title.append(id,status);
  const count=document.createElement('span');count.className='monitor-count';count.textContent=(m.records||[]).length+' 条记录';
  head.append(title,count);

  const start=document.createElement('div');start.className='monitor-start-url';start.textContent=m.startUrl||'';

  const records=document.createElement('div');records.className='records';
  if(!(m.records||[]).length){
    const empty=document.createElement('div');empty.className='records-empty';empty.textContent='等待 URL 变化…';records.appendChild(empty);
  }else{
    for(const r of [...m.records].reverse())records.appendChild(recordRow(r));
  }
  box.append(head,start,records);return box;
}

function render(state){
  const ms=state?.monitors||[];
  const total=ms.reduce((a,m)=>a+(m.records?.length||0),0);
  const active=ms.filter(m=>m.running).length;
  $('#count').textContent=total+' 条记录';
  $('#dot').classList.toggle('on',active>0);
  $('#state').textContent=active?active+' 个监控正在运行':'等待开始';

  const list=$('#list');list.textContent='';
  if(!ms.length){
    const e=document.createElement('div');e.className='empty';e.textContent='暂无监控';list.appendChild(e);return;
  }
  for(const m of [...ms].sort((a,b)=>String(a.id).localeCompare(String(b.id))))list.appendChild(monitorCard(m));
}

async function refresh(){
  if(!connected)return;
  try{
    const r=await req({type:'getState'});
    if(r?.ok)render(r.state);
  }catch(e){console.warn('refresh failed',e);}
}

$('#start').onclick=async()=>{
  try{
    const r=await req({type:'start',id:$('#monitorId').value,url:$('#startUrl').value},5000);
    if(!r?.ok)throw new Error(r?.error||'启动失败');
    await refresh();
  }catch(e){alert(e.message||String(e));}
};

$('#stop').onclick=async()=>{
  try{
    const r=await req({type:'stop'});
    if(!r?.ok)throw new Error(r?.error||'停止失败');
    await refresh();
  }catch(e){alert(e.message||String(e));}
};

$('#clear').onclick=async()=>{
  try{
    const r=await req({type:'clear'});
    if(!r?.ok)throw new Error(r?.error||'清空失败');
    await refresh();
  }catch(e){alert(e.message||String(e));}
};

initIds();
updateConnection();
setInterval(refresh,1000);