/* ===== 預設題庫（把你的 CSV 連結放這裡） ===== */
const PRESET_BANKS = [
  {
    id: "xuka",
    label: "旴卡BATTLE",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=0&single=true&output=csv"
  },
  {
    id: "kpop-male",
    label: "KPOP男豆BATTLE",
    url: "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=262246607&single=true&output=csv"
  }
];

/* ===== 快捷 ===== */
const $ = sel => document.querySelector(sel);

/* ===== 狀態 ===== */
let state = {
  entries: [],             // [{id,name,img}]
  rounds: [],              // [[{aId,bId,winnerId}]]
  roundIdx: 0,
  matchIdx: 0,
  nextSeeds: [],           // 下一輪的選手 id
  losersByRound: {},       // r: [id,id,...]
  finalRanking: [],        // 總結排名（依淘汰輪回推）
  history: []              // 用於 undo 的快照
};

/* ===== 工具 ===== */
function deepClone(o){ return JSON.parse(JSON.stringify(o)); }
function shuffle(a){
  for(let i=a.length-1;i>0;i--){
    const j = Math.floor(Math.random()*(i+1));
    [a[i],a[j]]=[a[j],a[i]];
  }
  return a;
}

/* ===== 圖片連結正規化（含 Google Drive / Dropbox） ===== */
function normalizeImageUrl(url){
  if(!url) return "";
  url = url.trim();

  // gdrive: /file/d/{id}/view
  let m = url.match(/^https?:\/\/drive\.google\.com\/file\/d\/([^/]+)/i);
  if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;

  // gdrive: /open?id={id}
  m = url.match(/^https?:\/\/drive\.google\.com\/open\?[^#]*\bid=([^&]+)/i);
  if (m) return `https://drive.google.com/uc?export=view&id=${m[1]}`;

  // gdrive: /uc?id={id}[&...]
  m = url.match(/^https?:\/\/drive\.google\.com\/uc\?([^#]+)/i);
  if (m) {
    const params = new URLSearchParams(m[1]);
    const id = params.get("id");
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }

  // docs: /uc?id={id}
  m = url.match(/^https?:\/\/docs\.google\.com\/uc\?([^#]+)/i);
  if (m) {
    const params = new URLSearchParams(m[1]);
    const id = params.get("id");
    if (id) return `https://drive.google.com/uc?export=view&id=${id}`;
  }

  // dropbox 分享：改 dl=1
  if (/^https?:\/\/www\.dropbox\.com\//i.test(url)) {
    if (url.includes("dl=0")) return url.replace("dl=0","dl=1");
    if (!/[?&]dl=1\b/.test(url)) return url + (url.includes("?") ? "&dl=1" : "?dl=1");
  }

  return url;
}

/* ===== CSV / 手動清單 解析 ===== */
// 期待欄位：name,img（可多欄，但只取前兩欄）；支援簡易引號
function parseCsvText(text){
  const lines = text.replace(/\r/g,'').split('\n').filter(x=>x.trim()!=="");
  const rows = [];
  for(const line of lines){
    const cols = [];
    let cur = "", inQ = false;
    for(let i=0;i<line.length;i++){
      const c = line[i];
      if(c === '"' ){
        if(inQ && line[i+1] === '"'){ cur+='"'; i++; }
        else inQ = !inQ;
      }else if(c === ',' && !inQ){
        cols.push(cur.trim()); cur="";
      }else{
        cur+=c;
      }
    }
    cols.push(cur.trim());
    const name = (cols[0]||"").trim();
    const img  = (cols[1]||"").trim();
    if(!name) continue;
    rows.push({ id: `c-${rows.length}`, name, img });
  }
  // 去重（同名且同圖才算重複）
  const seen = new Set();
  return rows.filter(x=>{
    const key = (x.name+"||"+(x.img||"")).toLowerCase();
    if(seen.has(key)) return false;
    seen.add(key); return true;
  });
}

function parseManualList(text){
  const lines = text.split(/\r?\n/).map(s=>s.trim()).filter(Boolean);
  const seen = new Set(), out = [];
  lines.forEach((line,i)=>{
    const [name, imgRaw=""] = line.split(",").map(x=>x.trim());
    if (!name) return;
    const key = `${name}||${imgRaw}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    out.push({ id:`m-${i}`, name, img: imgRaw });
  });
  return out;
}

/* ===== 預覽輔助 ===== */
async function tryPreviewAndCount(src){
  try{
    if(src.type==="csv"){
      const r = await fetch(src.url,{cache:"no-store"});
      if(!r.ok) throw new Error("HTTP "+r.status);
      const txt = await r.text();
      const rows = parseCsvText(txt);
      return rows.length;
    }else if(src.type==="text"){
      const rows = parseManualList(src.text || "");
      return rows.length;
    }
  }catch(_e){}
  return 0;
}

/* ===== Setup 下拉：安全初始化與預覽 ===== */
function safeInitPreset() {
  const sel = document.getElementById("presetSelect");
  if (!sel) { console.warn("[init] 找不到 #presetSelect"); return; }

  sel.innerHTML = '<option value="">— 不使用預設（自己貼連結或輸入）—</option>';

  if (!Array.isArray(PRESET_BANKS) || PRESET_BANKS.length === 0) {
    const hint = document.getElementById("previewCount");
    if (hint) hint.textContent = "（沒有載到預設題庫，請確認 script.js 是否最新）";
    return;
  }

  for (const b of PRESET_BANKS) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.label || b.id;
    sel.appendChild(opt);
  }

  async function refreshPreview(){
    const previewEl = $("#previewCount");
    previewEl.textContent = "";
    const pickedId = sel.value;
    if(!pickedId) return;
    const bank = PRESET_BANKS.find(x=>x.id===pickedId);
    if(!bank) return;
    previewEl.textContent = "載入預覽中…";
    const n = await tryPreviewAndCount({type:"csv", url: bank.url});
    previewEl.textContent = n>0 ? `預覽：${n} 筆` : "預覽失敗或為 0 筆";
  }

  sel.addEventListener("change", ()=>{
    if(sel.value){
      $("#csvUrl").value = "";
      $("#manualList").value = "";
      refreshPreview();
    }else{
      $("#previewCount").textContent = "";
    }
  });

  const reloadBtn = document.getElementById("reloadPreviewBtn");
  if (reloadBtn && !reloadBtn._bound) {
    reloadBtn.addEventListener("click", () => sel.value && sel.dispatchEvent(new Event("change")));
    reloadBtn._bound = true;
  }

  // 若想預設選某個題庫，解除註解：
  // sel.value = "xuka"; sel.dispatchEvent(new Event("change"));
}

/* ===== 對戰配表 ===== */
function buildRoundFrom(ids){
  const idsCopy = ids.slice();
  const pairs = [];
  if(idsCopy.length % 2 === 1){
    // 單數：最後一位 bye
    state.nextSeeds.push(idsCopy.pop());
  }
  for(let i=0;i<idsCopy.length;i+=2){
    pairs.push({ aId: idsCopy[i], bId: idsCopy[i+1], winnerId: null });
  }
  return pairs;
}

function seedFirstRound(){
  const ids = state.entries.map((_,i)=>i);
  shuffle(ids);
  state.rounds = [ buildRoundFrom(ids) ];
  state.roundIdx = 0;
  state.matchIdx = 0;
  state.losersByRound = {};
  state.finalRanking = [];
  state.history = [];
  state.nextSeeds = state.nextSeeds || [];
}

function advanceAfterPick(){
  const r = state.rounds[state.roundIdx];
  if(state.matchIdx < r.length-1){
    state.matchIdx++;
    renderAll(); return;
  }
  const next = state.nextSeeds.slice();
  state.nextSeeds = [];
  if(next.length <= 1){
    const championId = next[0] ?? r[r.length-1].winnerId;
    finishTournament(championId);
  }else{
    state.rounds.push(buildRoundFrom(next));
    state.roundIdx++;
    state.matchIdx = 0;
    renderAll();
  }
}

function finishTournament(championId){
  const lastRound = state.rounds[state.rounds.length-1] || [];
  const finalMatch = lastRound[lastRound.length-1] || null;
  const runnerUpId = finalMatch
    ? ((finalMatch.aId===championId) ? finalMatch.bId : finalMatch.aId)
    : null;

  const ranking = [];
  if(championId!=null) ranking.push(championId);
  if(runnerUpId!=null) ranking.push(runnerUpId);

  for(let r = state.rounds.length-1; r>=0; r--){
    const losers = (state.losersByRound[r] || []).filter(id=>id!==runnerUpId);
    for(const id of losers) if(!ranking.includes(id)) ranking.push(id);
  }
  for(let i=0;i<state.entries.length;i++){
    if(!ranking.includes(i)) ranking.push(i);
  }

  state.finalRanking = ranking;
  renderFinal();
}

/* ===== Render ===== */
function setImage(imgEl, title, url){
  imgEl.alt = title || "";
  imgEl.referrerPolicy = "no-referrer";           // 某些主機擋引用時更穩
  imgEl.onerror = () => { imgEl.removeAttribute("src"); }; // 裂圖時用文字卡片
  if(url){
    imgEl.src = normalizeImageUrl(url);
  }else{
    imgEl.removeAttribute("src");
  }
}

function roundNameBySize(size){
  if(size===2) return "決賽";
  if(size===4) return "四強";
  if(size===8) return "八強";
  if(size===16) return "十六強";
  if(size===32) return "三十二強";
  return `剩 ${size} 人`;
}

function renderArena(){
  const r = state.rounds[state.roundIdx] || [];
  const m = r[state.matchIdx] || null;

  const resultShown = state.finalRanking && state.finalRanking.length>0;
  $("#championBox").hidden = !resultShown;

  if(!m){
    $("#cardA").style.display="none";
    $("#cardB").style.display="none";
    $(".vs").style.display="none";
    $("#roundLabel").textContent = resultShown ? "賽事結束" : "—";
    $("#roundProgress").textContent = "0/0";
    $("#remaining").textContent = "0";
    return;
  }

  const a = state.entries[m.aId];
  const b = state.entries[m.bId];

  $("#cardA").style.display="";
  $("#cardB").style.display="";
  $(".vs").style.display="";
  setImage($("#imgA"), a.name, a.img);
  setImage($("#imgB"), b.name, b.img);
  $("#nameA").textContent = a.name;
  $("#nameB").textContent = b.name;

  const size = (state.rounds[state.roundIdx]?.length || 0)*2 + (state.nextSeeds?.length || 0);
  const label = `${roundNameBySize(size)}`;
  $("#roundLabel").textContent = label;
  $("#roundProgress").textContent = `${state.matchIdx+1}/${r.length}`;
  $("#remaining").textContent = String(size);
}

function renderFinal(){
  const box = $("#championBox");
  const ol = $("#rankList");
  ol.innerHTML = "";
  state.finalRanking.forEach((id, idx)=>{
    const li = document.createElement("li");
    li.textContent = `${idx+1}. ${state.entries[id]?.name || "(?)"}`;
    ol.appendChild(li);
  });
  box.hidden = false;

  $("#cardA").style.display="none";
  $("#cardB").style.display="none";
  $(".vs").style.display="none";
  $("#roundLabel").textContent = "賽事結束";
  $("#roundProgress").textContent = "—";
  $("#remaining").textContent = "0";
}

function renderAll(){ renderArena(); }

/* ===== 事件綁定 ===== */
function bindTournamentEvents(){
  $("#cardA").addEventListener("click", ()=> pickWinner("A"));
  $("#cardB").addEventListener("click", ()=> pickWinner("B"));

  document.addEventListener("keydown", (e)=>{
    if(e.key==="ArrowLeft" || e.key.toLowerCase()==="a"){ pickWinner("A"); }
    if(e.key==="ArrowRight"|| e.key.toLowerCase()==="b"){ pickWinner("B"); }
    if(e.key.toLowerCase()==="u"){ doUndo(); }
    if(e.key.toLowerCase()==="r"){ doReset(); }
  });

  $("#undoBtn").addEventListener("click", doUndo);
  $("#resetBtn").addEventListener("click", doReset);
}

function snapshot(){
  return {
    rounds: deepClone(state.rounds),
    roundIdx: state.roundIdx,
    matchIdx: state.matchIdx,
    nextSeeds: deepClone(state.nextSeeds),
    losersByRound: deepClone(state.losersByRound),
    finalRanking: deepClone(state.finalRanking)
  };
}

function restore(snap){
  state.rounds = deepClone(snap.rounds);
  state.roundIdx = snap.roundIdx;
  state.matchIdx = snap.matchIdx;
  state.nextSeeds = deepClone(snap.nextSeeds);
  state.losersByRound = deepClone(snap.losersByRound);
  state.finalRanking = deepClone(snap.finalRanking);
  renderAll();
}

function pickWinner(side){
  if(state.finalRanking.length>0) return;
  const r = state.rounds[state.roundIdx];
  const m = r[state.matchIdx];
  if(!m) return;

  state.history.push(snapshot());

  const winnerId = side==="A" ? m.aId : m.bId;
  const loserId  = side==="A" ? m.bId : m.aId;
  m.winnerId = winnerId;
  state.nextSeeds.push(winnerId);

  if(!state.losersByRound[state.roundIdx]) state.losersByRound[state.roundIdx]=[];
  state.losersByRound[state.roundIdx].push(loserId);

  advanceAfterPick();
}

function doUndo(){
  const last = state.history.pop();
  if(!last) return;
  restore(last);
}

function doReset(){
  state = {
    entries: [], rounds: [], roundIdx:0, matchIdx:0,
    nextSeeds: [], losersByRound:{}, finalRanking:[], history:[]
  };
  $("#tournament").classList.add("hidden");
  $("#setup").classList.remove("hidden");
}

/* ===== 開始按鈕：優先讀預設題庫 → CSV 欄位 → 手動清單 ===== */
document.getElementById("startBtn").addEventListener("click", async ()=>{
  let entries = [];

  const presetId = ($("#presetSelect").value || "").trim();
  const csvUrl   = $("#csvUrl").value.trim();
  const manual   = $("#manualList").value.trim();

  if (presetId){
    const bank = PRESET_BANKS.find(x=>x.id===presetId);
    if(!bank){ alert("預設題庫不存在"); return; }
    try{
      const r = await fetch(bank.url, {cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      entries = parseCsvText(txt);
    }catch(e){
      console.error(e);
      alert("預設題庫載入失敗。請確認連結可公開存取（CSV）。");
      return;
    }
  } else if (csvUrl){
    try{
      const r = await fetch(csvUrl, {cache:"no-store"});
      if(!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      entries = parseCsvText(txt);
    }catch(e){
      alert("CSV 載入失敗。請用 .../pub?output=csv，並確認表單公開。");
      return;
    }
  } else if (manual){
    entries = parseManualList(manual);
  } else {
    alert("請選擇一個預設題庫、或輸入 CSV 連結、或貼上清單文字");
    return;
  }

  if(entries.length < 2){
    alert("至少需要 2 筆資料"); return;
  }

  state.entries = deepClone(entries);
  seedFirstRound();

  $("#setup").classList.add("hidden");
  $("#tournament").classList.remove("hidden");
  bindTournamentEvents();
  renderAll();
});

/* ===== 初始化（確保 DOM 準備好才填選單） ===== */
window.addEventListener("DOMContentLoaded", safeInitPreset);
