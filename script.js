/* ===== State ===== */
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

/* ===== Utils ===== */
const $ = s => document.querySelector(s);
const shuffle = a => a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
const deepClone = o => JSON.parse(JSON.stringify(o));
function slug(s){ return s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').replace(/[^\w\u4E00-\u9FFF]+/g,'-').replace(/^-+|-+$/g,'').toLowerCase(); }
const medalFor = i => (i===0?'🥇':i===1?'🥈':i===2?'🥉':''); // ← 前三名獎牌

/* ===== Google Drive image helpers ===== */
function extractDriveId(u){
  if(!u) return "";
  u=String(u).trim();
  const m1=u.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  const m2=u.match(/\/d\/([A-Za-z0-9_-]{10,})/);
  return m1?m1[1]:(m2?m2[1]:"");
}
function toThumbnailUrl(id, sz=1200){ return `https://drive.google.com/thumbnail?id=${id}&sz=w${sz}`; }
function toUcViewUrl(id){ return `https://drive.google.com/uc?export=view&id=${id}`; }

/* 圖片設定：thumbnail → 失敗則 uc */
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

/* 提供一個「首選縮圖 URL」給排名清單使用 */
function preferredThumbUrl(rawUrl, size=200){
  const id = extractDriveId(rawUrl);
  return id ? toThumbnailUrl(id, size) : rawUrl || "";
}

/* ===== Parse（同名且同圖才去重） ===== */
function parseCsvText(csv){
  const rows = csv.split(/\r?\n/).filter(Boolean);
  const split = r => r.split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/).map(x=>x.replace(/^"|"$/g,'').trim());
  const m = rows.map(split);
  const header = m[0].map(h=>h.trim().toLowerCase());

  const idIdx  = header.findIndex(h => /^id$/.test(h));
  let nameIdx  = header.findIndex(h => /(name|名稱|title)/.test(h));
  let imgIdx   = header.findIndex(h => /(image|img|url|圖片)/.test(h));
  if (nameIdx < 0) nameIdx = 0;

  const seen = new Set();
  const out = [];
  for (let i=1;i<m.length;i++){
    const cols = m[i];
    const name = (cols[nameIdx] || "").trim();
    if (!name) continue;
    const imgRaw = imgIdx>=0 ? (cols[imgIdx] || "").trim() : "";
    const key = `${name}||${imgRaw}`.toLowerCase();
    if (seen.has(key)) continue;     // 同名且同圖才去重
    seen.add(key);
    const id = (idIdx>=0 && cols[idIdx]) ? String(cols[idIdx]).trim() : `row-${i}`;
    out.push({ id, name, img: imgRaw });
  }
  return out;
}

function parseManualList(text){
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const seen = new Set(), out = [];
  lines.forEach((line,i)=>{
    const [name, imgRaw=""] = line.split(",").map(x=>x.trim());
    if (!name) return;
    const key = `${name}||${imgRaw}`.toLowerCase();
    if (seen.has(key)) return;       // 同名且同圖才去重
    seen.add(key);
    out.push({ id:`m-${i}`, name, img: imgRaw });
  });
  return out;
}

/* ===== Bracket building (with bye) ===== */
function buildRoundFrom(ids){
  ids = ids.slice();
  if (ids.length % 2 === 1) state.nextSeeds.push(ids.pop());
  const pairs = [];
  for (let i=0;i<ids.length;i+=2) pairs.push({ aId:ids[i], bId:ids[i+1], winnerId:null });
  return pairs;
}
function seedFirstRound(){
  const ids = shuffle(state.entries.map(e=>e.id)); // 移除 shuffle 可固定首輪對手
  state.rounds = [ buildRoundFrom(ids) ];
  state.roundIdx = 0; state.matchIdx = 0;
  state.nextSeeds = []; state.history = []; state.finalRanking = [];
}

/* ===== Lightweight snapshots (fix OOM) ===== */
function snapshotOf(s){
  return JSON.stringify({
    entries: s.entries,
    rounds: s.rounds,
    roundIdx: s.roundIdx,
    matchIdx: s.matchIdx,
    nextSeeds: s.nextSeeds,
    finalRanking: s.finalRanking
  });
}
function pushSnapshot(){
  state.history.push(snapshotOf(state));
  const LIMIT = 100;
  if (state.history.length > LIMIT) state.history.shift();
}
function undo(){
  const snap = state.history.pop();
  if (!snap) return;
  const s = JSON.parse(snap);
  state.entries = s.entries;
  state.rounds = s.rounds;
  state.roundIdx = s.roundIdx;
  state.matchIdx = s.matchIdx;
  state.nextSeeds = s.nextSeeds;
  state.finalRanking = s.finalRanking;
  renderAll();
}

/* ===== Progress ===== */
function pick(side){
  const round = state.rounds[state.roundIdx];
  const match = round[state.matchIdx];
  const winnerId = side==="A" ? match.aId : match.bId;
  const loserId  = side==="A" ? match.bId : match.aId;

  pushSnapshot();
  match.winnerId = winnerId;
  state.finalRanking.unshift(loserId);

  state.nextSeeds.push(winnerId);
  state.matchIdx++;

  if (state.matchIdx >= round.length){
    const nextIds = shuffle(state.nextSeeds.slice()); state.nextSeeds = [];
    const nextRound = buildRoundFrom(nextIds);
    if (nextRound.length === 0){
      state.finalRanking.unshift(winnerId);
      renderAll(); return;
    }
    state.rounds.push(nextRound);
    state.roundIdx++; state.matchIdx = 0;
  }
  renderAll();
}

/* ===== UI ===== */
function currentPair(){
  const r = state.rounds[state.roundIdx];
  const m = r && r[state.matchIdx];
  if (!m) return null;
  const a = state.entries.find(e=>e.id===m.aId);
  const b = state.entries.find(e=>e.id===m.bId);
  return { a,b };
}
function roundNameBySize(n){
  if(n===2)return"決賽"; if(n===4)return"四強"; if(n===8)return"八強";
  if(n===16)return"16 強"; if(n===32)return"32 強"; if(n===64)return"64 強";
  return n+" 強";
}

function renderArena(){
  const p = currentPair();
  if (!p){
    // 結束
    $("#cardA").style.display="none"; $("#cardB").style.display="none"; $(".vs").style.display="none";
    $("#roundLabel").textContent="已結束"; $("#roundProgress").textContent="—"; $("#remaining").textContent="—";

    // 顯示 sidebar（最終排名）
    const box=$("#championBox");
    box.hidden=false;
    const ol = $("#rankList");
    ol.innerHTML = ""; // 清空

    // 依現有 finalRanking（winner 已 unshift 到最前）
    state.finalRanking.forEach((id, i)=>{
      const e = state.entries.find(x=>x.id===id);
      if(!e) return;
      const li = document.createElement("li");

      // 名次數字 + 獎牌
      const rankLabel = document.createElement("span");
      rankLabel.textContent = `${i+1}. `;
      rankLabel.style.fontWeight = "700";
      rankLabel.style.minWidth = "2.5em";

      const medal = document.createElement("span");
      medal.textContent = medalFor(i);
      medal.style.marginRight = medal.textContent ? "6px" : "0";

      // 縮圖
      const img = document.createElement("img");
      img.className = "thumb";
      img.src = preferredThumbUrl(e.img, 200);
      img.alt = e.name;

      const nameSpan = document.createElement("span");
      nameSpan.textContent = e.name;

      li.appendChild(rankLabel);
      li.appendChild(medal);
      li.appendChild(img);
      li.appendChild(nameSpan);
      ol.appendChild(li);
    });

    // 回來顯示 sidebar
    const sb = $(".sidebar");
    if (sb) sb.style.display = "block";
    return;
  }

  // 進行中：隱藏 sidebar
  const sb = $(".sidebar");
  if (sb) sb.style.display = "none";

  $("#cardA").style.display=""; $("#cardB").style.display=""; $(".vs").style.display="";
  setDriveImage($("#imgA"), p.a.name, p.a.img);
  setDriveImage($("#imgB"), p.b.name, p.b.img);
  $("#nameA").textContent=p.a.name; $("#nameB").textContent=p.b.name;

  const size = state.rounds[state.roundIdx].length*2;
  $("#roundLabel").textContent = roundNameBySize(size);
  $("#roundProgress").textContent = `${state.matchIdx+1}/${state.rounds[state.roundIdx].length}`;
  $("#remaining").textContent = size;
}
function renderAll(){ renderArena(); }

/* ===== Bind ===== */
function bindTournamentEvents(){
  // 直接點整張卡片就選擇（不再需要按鈕）
  $("#cardA").addEventListener("click", ()=>pick("A"));
  $("#cardB").addEventListener("click", ()=>pick("B"));

  $("#undoBtn").addEventListener("click",undo);
  $("#resetBtn").addEventListener("click",()=>{ if(confirm("確定重置？")){ localStorage.removeItem(STORAGE_KEY); location.reload(); } });

  window.addEventListener("keydown",e=>{
    if(e.key==="ArrowLeft") pick("A");
    if(e.key==="ArrowRight") pick("B");
    const k=e.key.toLowerCase();
    if(k==="u") undo();
    if(k==="r") $("#resetBtn").click();
  });
}

/* ===== Setup → start ===== */
document.getElementById("startBtn").addEventListener("click", async ()=>{
  let entries=[];
  const csvUrl=$("#csvUrl").value.trim();
  const manual=$("#manualList").value.trim();

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
  }else if(manual){
    entries=parseManualList(manual);
  }else{
    alert("請輸入 CSV 連結或清單文字"); return;
  }

  if(entries.length<2){ alert("至少需要 2 筆資料"); return; }

  state.entries=deepClone(entries);
  seedFirstRound();
  $("#setup").classList.add("hidden");
  $("#tournament").classList.remove("hidden");
  bindTournamentEvents(); renderAll();
});
