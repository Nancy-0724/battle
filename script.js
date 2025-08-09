const STORAGE_KEY = "se-bracket-state-v1";
let state = { entries: [], rounds: [], roundIdx: 0, matchIdx: 0, nextSeeds: [], history: [], finalRanking: [] };

/* ==== 工具 ==== */
const $ = s => document.querySelector(s);
const shuffle = arr => arr.map(v=>[Math.random(),v]).sort((a,b)=>a[0]-b[0]).map(x=>x[1]);
function save(){ localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); }
function load(){ try{ state = JSON.parse(localStorage.getItem(STORAGE_KEY)); return !!state; }catch{ return false; } }
const deepClone = o => JSON.parse(JSON.stringify(o));
function slug(s){ return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\u4E00-\u9FFF]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase(); }

/* ==== 資料解析 ==== */
function parseCsvText(csvText){
  const rows = csvText.split(/\r?\n/).filter(Boolean);
  const splitRow = r => r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x=>x.replace(/^"|"$/g,'').trim());
  const matrix = rows.map(splitRow);
  const header = matrix[0].map(h=>h.trim().toLowerCase());
  let nameIdx = header.findIndex(h => /(name|名稱|title)/.test(h));
  let imgIdx = header.findIndex(h => /(image|img|url|圖片)/.test(h));
  if(nameIdx<0) nameIdx=0;
  const seen=new Set(), out=[];
  for(let i=1;i<matrix.length;i++){
    const name=(matrix[i][nameIdx]||"").trim(); if(!name) continue;
    if(seen.has(name.toLowerCase())) continue; seen.add(name.toLowerCase());
    let img = imgIdx>=0 ? (matrix[i][imgIdx]||"").trim() : "";
    if(!img) img=`https://picsum.photos/seed/${encodeURIComponent(name)}/800/500`;
    out.push({ id:slug(name)+"-"+i, name, img });
  }
  return out;
}
function parseManualList(text){
  const lines = text.split(/\r?\n/).map(l=>l.trim()).filter(Boolean);
  const seen=new Set(), out=[];
  lines.forEach((line,i)=>{
    const [name,imgRaw] = line.split(",").map(x=>x.trim());
    if(!name) return;
    if(seen.has(name.toLowerCase())) return; seen.add(name.toLowerCase());
    let img = imgRaw || `https://picsum.photos/seed/${encodeURIComponent(name)}/800/500`;
    out.push({ id:slug(name)+"-"+i, name, img });
  });
  return out;
}

/* ==== 賽程建立 ==== */
function buildRoundFrom(listIds){
  const ids = listIds.slice();
  if(ids.length%2===1) state.nextSeeds.push(ids.pop());
  const pairs=[]; for(let i=0;i<ids.length;i+=2) pairs.push({ aId:ids[i], bId:ids[i+1], winnerId:null });
  return pairs;
}
function seedFirstRound(){
  const ids = shuffle(state.entries.map(e=>e.id));
  state.rounds=[buildRoundFrom(ids)];
  state.roundIdx=0; state.matchIdx=0; state.nextSeeds=[]; state.history=[]; state.finalRanking=[];
}

/* ==== 推進 ==== */
function pushSnapshot(){ state.history.push(JSON.stringify(state)); }
function pick(side){
  const round=state.rounds[state.roundIdx], match=round[state.matchIdx];
  const winnerId = side==="A"?match.aId:match.bId;
  const loserId  = side==="A"?match.bId:match.aId;
  pushSnapshot();
  match.winnerId=winnerId;
  state.finalRanking.unshift(loserId);
  state.nextSeeds.push(winnerId);
  state.matchIdx++;
  if(state.matchIdx>=round.length){
    const nextIds=shuffle(state.nextSeeds.slice()); state.nextSeeds=[];
    const nextRound=buildRoundFrom(nextIds);
    if(nextRound.length===0){ state.finalRanking.unshift(winnerId); save(); renderAll(); return; }
    state.rounds.push(nextRound); state.roundIdx++; state.matchIdx=0;
  }
  save(); renderAll();
}
function undo(){ const snap=state.history.pop(); if(!snap) return; state=JSON.parse(snap); save(); renderAll(); }

/* ==== 畫面 ==== */
function currentPair(){
  const r=state.rounds[state.roundIdx], m=r&&r[state.matchIdx];
  if(!m) return null;
  const a=state.entries.find(e=>e.id===m.aId), b=state.entries.find(e=>e.id===m.bId);
  return {a,b};
}
function roundNameBySize(size){
  if(size===2) return "決賽"; if(size===4) return "四強"; if(size===8) return "八強";
  if(size===16) return "16 強"; if(size===32) return "32 強"; if(size===64) return "64 強";
  return size+" 強";
}
function renderArena(){
  const pair=currentPair();
  if(!pair){
    $("#cardA").style.display="none"; $("#cardB").style.display="none"; $(".vs").style.display="none";
    $("#roundLabel").textContent="已結束"; $("#roundProgress").textContent="—"; $("#remaining").textContent="—";
    const box=$("#championBox"); box.hidden=false; $("#championName").textContent="最終排名";
    const list=document.createElement("ol");
    state.finalRanking.forEach(id=>{
      const e=state.entries.find(x=>x.id===id);
      if(!e) return; const li=document.createElement("li"); li.textContent=e.name; list.appendChild(li);
    });
    box.innerHTML="<h3>🏆 最終排名</h3>"; box.appendChild(list);
    return;
  }
  $("#cardA").style.display=""; $("#cardB").style.display=""; $(".vs").style.display="";
  $("#imgA").src=pair.a.img; $("#imgB").src=pair.b.img;
  $("#nameA").textContent=pair.a.name; $("#nameB").textContent=pair.b.name;
  const sizeThisRound=state.rounds[state.roundIdx].length*2;
  $("#roundLabel").textContent=roundNameBySize(sizeThisRound);
  $("#roundProgress").textContent=`${state.matchIdx+1}/${state.rounds[state.roundIdx].length}`;
  $("#remaining").textContent=sizeThisRound;
}
function renderAll(){ renderArena(); }

/* ==== 綁事件 ==== */
function bindTournamentEvents(){
  $("#cardA").addEventListener("click",e=>{ if(!e.target.closest(".pick-btn")) pick("A"); });
  $("#cardB").addEventListener("click",e=>{ if(!e.target.closest(".pick-btn")) pick("B"); });
  document.querySelectorAll(".pick-btn").forEach(btn=>btn.addEventListener("click",e=>{ e.stopPropagation(); pick(btn.dataset.side); }));
  $("#undoBtn").addEventListener("click",undo);
  $("#resetBtn").addEventListener("click",()=>{ if(confirm("確定重置？")){ localStorage.removeItem(STORAGE_KEY); location.reload(); } });
  $("#shotBtn").addEventListener("click",()=>document.body.classList.toggle("screenshot"));
  window.addEventListener("keydown",e=>{
    if(e.key==="ArrowLeft") pick("A");
    if(e.key==="ArrowRight") pick("B");
    const k=e.key.toLowerCase();
    if(k==="u") undo();
    if(k==="r") $("#resetBtn").click();
    if(k==="s") $("#shotBtn").click();
  });
}

/* ==== Setup 邏輯 ==== */
$("#startBtn").addEventListener("click", async ()=>{
  let entries=[];
  const csvUrl=$("#csvUrl").value.trim();
  const manual=$("#manualList").value.trim();
  if(csvUrl){
    try{
      const res=await fetch(csvUrl); const text=await res.text();
      entries=parseCsvText(text);
    }catch(err){ alert("CSV 載入失敗："+err); return; }
  }else if(manual){
    entries=parseManualList(manual);
  }else{
    alert("請輸入 CSV 連結或清單文字"); return;
  }
  if(entries.length<2){ alert("至少需要 2 筆資料"); return; }
  state.entries=deepClone(entries);
  seedFirstRound(); save();
  $("#setup").classList.add("hidden");
  $("#tournament").classList.remove("hidden");
  bindTournamentEvents(); renderAll();
});