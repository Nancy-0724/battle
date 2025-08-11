/* ===== 動態 vh（行動裝置 100vh 修正） ===== */
function updateVH() {
  document.documentElement.style.setProperty('--vh', `${window.innerHeight}px`);
}
window.addEventListener('resize', updateVH);
window.addEventListener('orientationchange', updateVH);
updateVH();

/* ===== 量測 Topbar 實際高度（避免預估不準） ===== */
function updateTopbarH() {
  const tb = document.querySelector('.topbar');
  if (tb) document.documentElement.style.setProperty('--topbar-h', `${tb.offsetHeight}px`);
}
window.addEventListener('resize', updateTopbarH);
window.addEventListener('orientationchange', updateTopbarH);
window.addEventListener('DOMContentLoaded', updateTopbarH);
updateTopbarH();

/* ===== 預設題庫（照你要的順序：男豆 → 女豆 → 旴卡） ===== */
const PRESET_BANKS = [
  {
    id: "kpop-male",
    label: "KPOP男豆BATTLE",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=262246607&single=true&output=csv"
  },
  {
    id: "kpop-female",
    label: "KPOP女豆BATTLE",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=1697531857&single=true&output=csv"
  },
  {
    id: "xuka",
    label: "旴卡BATTLE",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=0&single=true&output=csv"
  }
];

/* ===== Config 開關 ===== */
const FIXED_SEED_FOR_PLACEMENT = true;

/* ===== State ===== */
const STORAGE_KEY = "se-bracket-state-v2";
let state = {
  entries: [],
  rounds: [],
  roundIdx: 0,
  matchIdx: 0,
  nextSeeds: [],
  history: [],
  finalRanking: [],
  phaseLabel: "主賽",
  placementQueue: [],   // [{ids:[], label:""}]
  roundLosers: {}       // { roundIdx: [id,id,...] }
};

/* ===== Utils ===== */
const $ = s => document.querySelector(s);
const shuffle = a => a.map(v=>[Math.random(),v]).sort((x,y)=>x[0]-y[0]).map(x=>x[1]);
const deepClone = o => JSON.parse(JSON.stringify(o));
const medalFor = i => (i===0?'🥇':i===1?'🥈':i===2?'🥉':''); // 前三名獎牌

/* ===== Google Drive image helpers（不轉小寫、先縮圖後 uc） ===== */
function isDriveUrl(u){
  if(!u) return false;
  return /(^https?:\/\/)?(www\.)?drive\.google\.com/.test(String(u));
}
function extractDriveId(u){
  if(!u) return "";
  const s = String(u).trim(); // 不轉小寫！Drive ID 區分大小寫
  const m1 = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m1) return m1[1];
  const m2 = s.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})/);
  if (m2) return m2[1];
  return "";
}
function toThumbnailUrl(id, sz=1200){ return `https://drive.google.com/thumbnail?id=${id}&sz=w${sz}`; }
function toUcViewUrl(id){ return `https://drive.google.com/uc?export=view&id=${id}`; }

/* 設定圖片（先用縮圖，失敗再退回 uc） */
function setImage(imgEl, name, rawUrl){
  imgEl.alt = name || "";
  if (!rawUrl) { imgEl.src = ""; return; }

  if (isDriveUrl(rawUrl)) {
    const id = extractDriveId(rawUrl);
    if(!id){ imgEl.src=""; console.warn("Drive 連結缺少檔案ID：", rawUrl); return; }
    const thumb = toThumbnailUrl(id);
    const uc    = toUcViewUrl(id);
    imgEl.onerror = null;
    imgEl.src = thumb;
    imgEl.onerror = () => {
      imgEl.onerror = () => console.error("uc 也失敗：", uc);
      imgEl.src = uc;
    };
  } else {
    imgEl.onerror = () => console.warn("圖片載入失敗：", rawUrl);
    imgEl.src = rawUrl;
  }
}

/* 排名清單使用的縮圖 URL（Drive → thumbnail，其它直接回傳） */
function preferredThumbUrl(rawUrl, size=200){
  if (!rawUrl) return "";
  if (isDriveUrl(rawUrl)) {
    const id = extractDriveId(rawUrl);
    return id ? toThumbnailUrl(id, size) : rawUrl;
  }
  return rawUrl;
}

/* ===== Parse（同名且同圖才去重；可讀表頭 Name/Image） ===== */
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
function seedBracketFromIds(ids, label){
  state.nextSeeds = [];
  state.rounds = [ buildRoundFrom(ids) ];
  state.roundIdx = 0;
  state.matchIdx = 0;
  state.roundLosers = {};
  state.phaseLabel = label || state.phaseLabel;
}

function seedFirstRound(){
  const ids = shuffle(state.entries.map(e=>e.id)); // 主賽首輪保持洗牌
  state.history = [];
  state.finalRanking = [];
  state.placementQueue = [];
  state.phaseLabel = "主賽";
  seedBracketFromIds(ids, "主賽");
}

/* ===== Lightweight snapshots ===== */
function snapshotOf(s){
  return JSON.stringify({
    entries: s.entries,
    rounds: s.rounds,
    roundIdx: s.roundIdx,
    matchIdx: s.matchIdx,
    nextSeeds: s.nextSeeds,
    finalRanking: s.finalRanking,
    phaseLabel: s.phaseLabel,
    placementQueue: s.placementQueue,
    roundLosers: s.roundLosers
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
  state.phaseLabel = s.phaseLabel;
  state.placementQueue = s.placementQueue;
  state.roundLosers = s.roundLosers;
  renderAll();
}

/* ===== Helpers for Plan B（名次賽） ===== */
function enqueuePlacement(ids, label){
  if(!ids || ids.length<1) return;
  if(ids.length===1){
    state.finalRanking.push(ids[0]);
  }else{
    state.placementQueue.push({ ids: ids.slice(), label });
  }
}
function startNextPlacement(){
  const job = state.placementQueue.shift();
  if(!job){ renderAll(); return; }
  seedBracketFromIds(job.ids, job.label); // 名次賽啟動時不洗牌，沿用 ids 順序
  renderAll();
}
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

/* ===== Progress（沿用你的邏輯） ===== */
function pick(side){
  const round = state.rounds[state.roundIdx];
  const match = round[state.matchIdx];
  if(!match) return;

  const winnerId = side==="A" ? match.aId : match.bId;
  const loserId  = side==="A" ? match.bId : match.aId;

  pushSnapshot();
  match.winnerId = winnerId;

  (state.roundLosers[state.roundIdx] ||= []).push(loserId);

  state.nextSeeds.push(winnerId);
  state.matchIdx++;

  if (state.matchIdx >= round.length){
    let nextIds = state.nextSeeds.slice();
    state.nextSeeds = [];

    const isPlacement = String(state.phaseLabel || "").startsWith("名次賽");
    if (!(FIXED_SEED_FOR_PLACEMENT && isPlacement)) {
      nextIds = shuffle(nextIds);
    }

    const nextRound = buildRoundFrom(nextIds);

    if (nextRound.length === 0){
      finishCurrentBracket(winnerId);
      return;
    }
    state.rounds.push(nextRound);
    state.roundIdx++; state.matchIdx = 0;
  }
  renderAll();
}

function finishCurrentBracket(finalWinnerId){
  // 找到決賽對手（亞軍）
  const lastRound = state.rounds[state.rounds.length-1];
  const finalMatch = lastRound[lastRound.length-1];
  const runnerUpId = finalMatch ? ((finalMatch.aId===finalWinnerId)? finalMatch.bId : finalMatch.aId) : null;

  // 先把冠軍、亞軍加入總排名
  state.finalRanking.push(finalWinnerId);
  if(runnerUpId) state.finalRanking.push(runnerUpId);

  // 依倒序把各輪敗者群組成名次賽，逐一排入 queue
  let baseRankStart = state.finalRanking.length + 1;
  for(let r = state.rounds.length - 2; r>=0; r--){
    const group = (state.roundLosers[r] || []).slice(); // 保留原配位順序
    if(group.length===0) continue;
    const label = `名次賽：第 ${baseRankStart}–${baseRankStart + group.length - 1} 名`;
    enqueuePlacement(group, label);
    baseRankStart += group.length;
  }

  // 清空目前 bracket 狀態
  state.rounds = []; state.roundIdx = 0; state.matchIdx = 0;
  state.nextSeeds = []; state.roundLosers = {};

  if(state.placementQueue.length>0){
    startNextPlacement();
  }else{
    state.phaseLabel = "已結束";
    renderAll();
  }
}

/* ===== UI（最終排名＝數字 + 🥇/🥈/🥉 + 小縮圖 + 名稱） ===== */
function renderArena(){
  const p = currentPair();
  if (!p){
    $("#cardA").style.display="none"; $("#cardB").style.display="none"; $(".vs").style.display="none";
    $("#roundLabel").textContent= state.phaseLabel || "已結束";
    $("#roundProgress").textContent="—"; $("#remaining").textContent="—";

    const box=$("#championBox");
    box.hidden=false;
    const ol = $("#rankList");
    ol.innerHTML = "";

    // 確保不使用瀏覽器序號，避免和我們手動數字衝突
    ol.style.listStyle = "none";
    ol.style.paddingLeft = "0";

    state.finalRanking.forEach((id, i)=>{
      const e = state.entries.find(x=>x.id===id);
      if(!e) return;

      const li = document.createElement("li");
      li.style.display = "flex";
      li.style.alignItems = "center";
      li.style.gap = "8px";
      li.style.margin = "6px 0";

      // 手動數字
      const num = document.createElement("span");
      num.textContent = `${i+1}.`;
      num.style.width = "2.2em";
      num.style.textAlign = "right";
      num.style.fontWeight = "700";

      // 🥇/🥈/🥉（只有前三名顯示）
      const medalSpan = document.createElement("span");
      medalSpan.textContent = medalFor(i);
      medalSpan.style.width = "1.2em";
      medalSpan.style.textAlign = "center";

      // 小縮圖（40x40）
      const img = document.createElement("img");
      img.src = preferredThumbUrl(e.img, 120);
      img.alt = e.name;
      img.style.width = "40px";
      img.style.height = "40px";
      img.style.objectFit = "cover";
      img.style.objectPosition = "center";
      img.style.borderRadius = "4px";

      const nameSpan = document.createElement("span");
      nameSpan.textContent = e.name;

      li.appendChild(num);
      li.appendChild(medalSpan);
      li.appendChild(img);
      li.appendChild(nameSpan);
      ol.appendChild(li);
    });

    const sb = $(".sidebar");
    if (sb) sb.style.display = "block";
    return;
  }

  // 進行中：隱藏 sidebar
  const sb = $(".sidebar");
  if (sb) sb.style.display = "none";

  $("#cardA").style.display=""; $("#cardB").style.display=""; $(".vs").style.display="";
  setImage($("#imgA"), p.a.name, p.a.img);
  setImage($("#imgB"), p.b.name, p.b.img);
  $("#nameA").textContent=p.a.name; $("#nameB").textContent=p.b.name;

  const size = state.rounds[state.roundIdx].length*2;
  const label = `${state.phaseLabel}｜${roundNameBySize(size)}`;
  $("#roundLabel").textContent = label;
  $("#roundProgress").textContent = `${state.matchIdx+1}/${state.rounds[state.roundIdx].length}`;
  $("#remaining").textContent = size;
}
function renderAll(){ renderArena(); }

/* ===== 視窗自適應：把每張圖在 3:4 下塞進一頁，不超出 ===== */
function fitCards() {
  const arena = document.querySelector('.arena');
  if (!arena || getComputedStyle(arena).display === 'none') return;

  const arenaH = arena.getBoundingClientRect().height; // 已扣掉 topbar/padding 的可用高度
  const vs = arena.querySelector('.vs');
  const vsH = vs ? vs.getBoundingClientRect().height : 0;

  const cs = getComputedStyle(arena);
  const rowGap = parseFloat(cs.rowGap || '0') || 0;
  const isMobile = window.matchMedia('(max-width: 640px)').matches;

  const perCardTotalH = isMobile ? (arenaH - vsH - rowGap) / 2 : arenaH;

  ['cardA', 'cardB'].forEach(id => {
    const card = document.getElementById(id);
    if (!card) return;
    const img = card.querySelector('img');
    const title = card.querySelector('.card-info');

    const ccs = getComputedStyle(card);
    const cPadTop = parseFloat(ccs.paddingTop || '0');
    const cPadBot = parseFloat(ccs.paddingBottom || '0');
    const cBorderTop = parseFloat(ccs.borderTopWidth || '0');
    const cBorderBot = parseFloat(ccs.borderBottomWidth || '0');
    const paddingBorder = cPadTop + cPadBot + cBorderTop + cBorderBot;

    const titleH = title ? title.getBoundingClientRect().height : 0;

    // 卡片圖片可用的最大高度（扣掉標題/內距/間隙）
    const maxImgH = Math.max(0, perCardTotalH - paddingBorder - titleH - 8 /* card gap 近似 */);

    // 依 3:4 計算：圖片寬度不能超過卡片內部寬
    const cardInnerW = card.clientWidth - parseFloat(ccs.paddingLeft||'0') - parseFloat(ccs.paddingRight||'0');
    const heightByAspect = cardInnerW * (4/3);
    const finalImgH = Math.min(maxImgH, heightByAspect);

    img.style.height = `${finalImgH}px`;
    img.style.width  = `${finalImgH * (3/4)}px`;
    img.style.margin = '0 auto';
  });
}

/* === 穩定首屏（強化版）：多次延後＋多幀重算 fitCards === */
let fitRAF = 0, fitTimers = [];
function scheduleFitCards(bursts = [0, 60, 250], frames = 3){
  if (fitRAF) cancelAnimationFrame(fitRAF);
  fitTimers.forEach(t => clearTimeout(t));
  fitTimers = [];

  const runFrames = (n) => {
    fitCards();
    if (n > 0) fitRAF = requestAnimationFrame(() => runFrames(n - 1));
  };

  bursts.forEach(delay => {
    fitTimers.push(setTimeout(() => runFrames(frames), delay));
  });
}

// 重要生命週期：保險重算
window.addEventListener('load', () => {
  updateVH();
  updateTopbarH();
  scheduleFitCards([0, 60, 250], 4);
});
window.addEventListener('resize', () => scheduleFitCards([0], 2));
window.addEventListener('orientationchange', () => scheduleFitCards([0, 60], 3));
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible') scheduleFitCards([0, 60], 2);
});
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => scheduleFitCards([0], 3));
}
['imgA','imgB'].forEach(id=>{
  const el = document.getElementById(id);
  if (el) el.addEventListener('load', () => scheduleFitCards([0], 2), { once:false });
});

// 每次重繪後也排重算（取代原本的 monkey patch）
const __renderAll = renderAll;
renderAll = function(){
  __renderAll();
  scheduleFitCards([0, 60], 2);
};




/* ===== Bind ===== */
function bindTournamentEvents(){
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

/* =====（可選）預設題庫：如果 index.html 有下拉，就自動填入並支援預覽 ===== */
function initPresetSelectIfAny(){
  const sel = document.getElementById("presetSelect");
  if(!sel) return;

  sel.innerHTML = '<option value="">— 不使用預設（自己貼連結或輸入）—</option>';
  (PRESET_BANKS || []).forEach(b=>{
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.label || b.id;
    sel.appendChild(opt);
  });

  const previewEl = document.getElementById("previewCount");
  async function refreshPreview(){
    if(!previewEl) return;
    previewEl.textContent = "";
    const pickedId = sel.value;
    if(!pickedId) return;
    const bank = PRESET_BANKS.find(x=>x.id===pickedId);
    if(!bank) return;
    previewEl.textContent = "載入預覽中…";
    try{
      const r = await fetch(bank.url,{cache:"no-store"});
      const txt = await r.text();
      const rows = parseCsvText(txt);
      previewEl.textContent = rows.length>0 ? `預覽：${rows.length} 筆` : "預覽失敗或為 0 筆";
    }catch(_e){
      previewEl.textContent = "預覽失敗";
    }
  }

  sel.addEventListener("change", ()=>{
    const url = $("#csvUrl"), ta = $("#manualList");
    if(sel.value){ if(url) url.value=""; if(ta) ta.value=""; refreshPreview(); }
    else if(previewEl){ previewEl.textContent=""; }
  });

  const reload = document.getElementById("reloadPreviewBtn");
  if (reload && !reload._bound) {
    reload.addEventListener("click", () => sel.value && sel.dispatchEvent(new Event("change")));
    reload._bound = true;
  }
}

/* ===== Setup → start（支援：預設/CSV/手動） ===== */
document.getElementById("startBtn").addEventListener("click", async ()=>{
  let entries=[];
  const presetSel = document.getElementById("presetSelect");
  const presetId = presetSel ? (presetSel.value||"").trim() : "";
  const csvUrl=$("#csvUrl") ? $("#csvUrl").value.trim() : "";
  const manual=$("#manualList") ? $("#manualList").value.trim() : "";

  if (presetId){
    const bank = PRESET_BANKS.find(x=>x.id===presetId);
    if(!bank){ alert("預設題庫不存在"); return; }
    try{
      const r=await fetch(bank.url,{cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt=await r.text();
      entries=parseCsvText(txt);
    }catch(e){
      alert("預設題庫載入失敗。請確認連結可公開存取（CSV）。");
      return;
    }
  } else if(csvUrl){
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
    alert("請選擇預設題庫、或輸入 CSV 連結、或貼上清單文字"); return;
  }

  if(entries.length<2){ alert("至少需要 2 筆資料"); return; }

  state.entries=deepClone(entries);
  seedFirstRound();
$("#setup").classList.add("hidden");
$("#tournament").classList.remove("hidden");
bindTournamentEvents();
renderAll();

// 關鍵：等下一個動畫幀再跑 fitCards，多次保險
requestAnimationFrame(() => {
  scheduleFitCards([0, 60, 250], 3);
});

});

/* ===== 初始化 ===== */
window.addEventListener("DOMContentLoaded", initPresetSelectIfAny);
