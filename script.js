
  $("#remaining").textContent = size;



  // 顯示新對戰後，安排一輪尺寸計算，確保卡片不超頁

  if (typeof scheduleFitCards === "function") scheduleFitCards([0], 2);

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

  const isMobile = window.matchMedia('(max-width: 960px)').matches;



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

bindTournamentEvents(); renderAll();

scheduleFitCards([0, 60, 250], 4);



});



/* ===== 初始化 ===== */

window.addEventListener("DOMContentLoaded", initPresetSelectIfAny);
