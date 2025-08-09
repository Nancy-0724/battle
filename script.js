const STORAGE_KEY = "se-bracket-state-v1";
let state = {
  entries: [],
  rounds: [],
  roundIdx: 0,
  matchIdx: 0,
  nextSeeds: [],
  history: [],
  finalRanking: []
};

const $ = s => document.querySelector(s);
const shuffle = a => a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
const deepClone = o => JSON.parse(JSON.stringify(o));
function slug(s){ return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\u4E00-\u9FFF]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase(); }

/* ===== Drive 連結處理 ===== */
function extractDriveId(u){
  if(!u) return "";
  u=String(u).trim();
  const m1=u.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  const m2=u.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m1?m1[1]:(m2?m2[1]:"");
}
function toThumbnailUrl(id, sz=1200){ return `https://drive.google.com/thumbnail?id=${id}&sz=w${sz}`; }
function toUcViewUrl(id){ return `https://drive.google.com/uc?export=view&id=${id}`; }

/* 在 <img> 上做「thumbnail→uc」的回退 */
function setDriveImage(imgEl, name, rawUrl){
  imgEl.alt = name || "";
  const id = extractDriveId(rawUrl);
  if(!id){ imgEl.src=""; console.warn("沒有檔案ID：", rawUrl); return; }
  const thumb = toThumbnailUrl(id);
  const uc    = toUcViewUrl(id);
  imgEl.onerror = null;
  imgEl.src = thumb;
  imgEl.onerror = () => {
    console.warn("thumbnail 失敗，改試 uc：", thumb);
    imgEl.onerror = () => console.error("uc 也失敗：", uc);
    imgEl.src = uc;
  };
}

/* ===== 解析資料 ===== */
function parseCsvText(csv){
  const rows=csv.split(/\r?\n/).filter(Boolean);
  const split=r=>r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x=>x.replace(/^"|"$/g,'').trim());
  const m=rows.map(split);
  const header=m[0].map(h=>h.trim().toLowerCase());
  let nameIdx=header.findIndex(h=>/(name|名稱|title)/.test(h));
  let imgIdx =header.findIndex(h=>/(image|img|url|圖片)/.test(h));
  if(nameIdx<0) nameIdx=0;
  const seen=new Set(), out=[];
  for(let i=1;i<m.length;i++){
    const name=(m[i][nameIdx]||"").trim(); if(!name) continue;
    const key=name.toLowerCase(); if(seen.has(key)) continue; seen.add(key);
    const img=(imgIdx>=0?(m[i][imgIdx]||"").trim():"");
    out.push({id:slug(name)+"-"+i, name, img});
  }
  return out;
}
function parseManualList(text){
  const lines=text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const seen=new Set(), out=[];
  lines.forEach((line,i)=>{
    const [name,imgRaw=""]=line.split(",").map(x=>x.trim());
    if(!name) return;
    const key=name.toLowerCase(); if(seen.has(key)) return; seen.add(key);
    out.push({id:slug(name)+"-"+i, name, img:imgRaw});
  });
  return out;
}

/* ===== 建立賽程（含 bye） ===== */
function buildRoundFrom(ids){
  ids=ids.slice();
  if(ids.length%2===1) state.nextSeeds.push(ids.pop());
  const pairs=[]; for(let i=0;i<ids.length;i+=2) pairs.push({aId:ids[i], bId:ids[i+1], winnerId:null});
  return pairs;
}
function seedFirstRound(){
  const ids=shuffle(state.entries.map(e=>e.id)); // 要固定順序可移除 shuffle
  state.rounds=[buildRoundFrom(ids)];
  state.roundIdx=0; state.matchIdx=0;
  state.nextSeeds=[]; state.history=[]; state.finalRanking=[];
}

/* ===== 輕量快照：避免 OOM ===== */
function snapshotOf(s){
  // 只存必要欄位，不存 history 自己（避免體積爆炸）
  return JSON.stringify({
    entries: s.entries,                  // 參賽名單（小）
    rounds:  s.rounds,                   // 對戰進度
    roundIdx: s.roundIdx,
    matchIdx: s.matchIdx,
    nextSeeds: s.nextSeeds,
    finalRanking: s.finalRanking
  });
}
function pushSnapshot(){
  state.history.push(snapshotOf(state));
  const LIMIT = 100;                     // 上限（可調）
  if(state.history.length > LIMIT) state.history.shift();
}
function undo(){
  const snap = state.history.pop();
  if(!snap) return;
  const s = JSON.parse(snap);
  // 還原必要欄位
  state.entries = s.entries;
  state.rounds = s.rounds;
  state.roundIdx = s.roundIdx;
  state.matchIdx = s.matchIdx;
  state.nextSeeds = s.nextSeeds;
  state.finalRanking = s.finalRanking;
  renderAll();
}

/* ===== 推進 ===== */
function pick(side){
  const round=state.rounds[state.roundIdx], match=round[state.matchIdx];
  const winnerId = side==="A" ? match.aId : match.bId;
  const loserId  = side==="A" ? match.bId : match.aId;

  pushSnapshot();
  match.winnerId = winnerId;
  state.finalRanking.unshift(loserId);

  state.nextSeeds.push(winnerId);
  state.matchIdx++;

  if(state.matchIdx >= round.length){
    const nextIds=shuffle(state.nextSeeds.slice()); state.nextSeeds=[];
    const nextRound=buildRoundFrom(nextIds);
    if(nextRound.length===0){
      state.finalRanking.unshift(winnerId);
      renderAll(); return;
    }
    state.rounds.push(nextRound); state.roundIdx++; state.matchIdx=0;
  }
  renderAll();
}

/* ===== UI ===== */
function currentPair(){
  const r=state.rounds[state.roundIdx], m=r && r[state.matchIdx];
  if(!m) return null;
  const a=state.entries.find(e=>e.id===m.aId), b=state.entries.find(e=>e.id===m.bId);
  return {a,b};
}
function roundNameBySize(n){
  if(n===2)return"決賽"; if(n===4)return"四強"; if(n===8)return"八強";
  if(n===16)return"16 強"; if(n===32)return"32 強"; if(n===64)return"64 強";
  return n+" 強";
}
function renderArena(){
  const p=currentPair();
  if(!p){
    $("#cardA").style.display="none"; $("#cardB").style.display="none"; $(".vs").style.display="none";
    $("#roundLabel").textContent="已結束"; $("#roundProgress").textContent="—"; $("#remaining").textContent="—";
    const box=$("#championBox"); box.hidden=false; box.innerHTML="<h3>🏆 最終排名</h3>";
    const ol=document.createElement("ol");
    state.finalRanking.forEach(id=>{ const e=state.entries.find(x=>x.id===id); if(e){ const li=document.createElement("li"); li.textContent=e.name; ol.appendChild(li);} });
    box.appendChild(ol);
    return;
  }
  $("#cardA").style.display=""; $("#cardB").style.display=""; $(".vs").style.display="";
  setDriveImage($("#imgA"), p.a.name, p.a.img);
  setDriveImage($("#imgB"), p.b.name, p.b.img);
  $("#nameA").textContent=p.a.name; $("#nameB").textContent=p.b.name;

  const size=state.rounds[state.roundIdx].length*2;
  $("#roundLabel").textContent=roundNameBySize(size);
  $("#roundProgress").textContent=`${state.matchIdx+1}/${state.rounds[state.roundIdx].length}`;
  $("#remaining").textContent=size;
}
function renderAll(){ renderArena(); }

/* ===== 綁事件 ===== */
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
    const k=e.key.toLowerCase(); if(k==="u") undo(); if(k==="r") $("#resetBtn").click(); if(k==="s") $("#shotBtn").click();
  });
}

/* ===== Setup ===== */
document.getElementById("startBtn").addEventListener("click", async ()=>{
  let entries=[]; const csvUrl=$("#csvUrl").value.trim(); const manual=$("#manualList").value.trim();
  if(csvUrl){
    try{
      const r=await fetch(csvUrl,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt=await r.text();
      entries=parseCsvText(txt);
    }catch(e){
      alert("CSV 載入失敗。請用 .../pub?output=csv，並確認表單公開。");
      return;
    }
  }else if(manual){ entries=parseManualList(manual); }
  else{ alert("請輸入 CSV 連結或清單文字"); return; }

  if(entries.length<2){ alert("至少需要 2 筆資料"); return; }

  state.entries=deepClone(entries);
  seedFirstRound();
  $("#setup").classList.add("hidden");
  $("#tournament").classList.remove("hidden");
  bindTournamentEvents(); renderAll();
});
