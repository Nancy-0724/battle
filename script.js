/* ===== 動態 vh（行動裝置 / 非全螢幕修正） ===== */
function updateVH() {
  const vv = window.visualViewport;
  let h = vv ? vv.height : window.innerHeight;
  h = Math.max(0, Math.floor(h - 1));
  document.documentElement.style.setProperty("--vh", `${h}px`);
}
function onViewportChange() {
  updateVH();
  if (typeof scheduleFitCards === "function") scheduleFitCards([0, 60], 2);
}
window.addEventListener("resize", onViewportChange);
window.addEventListener("orientationchange", onViewportChange);
if (window.visualViewport) {
  window.visualViewport.addEventListener("resize", onViewportChange);
  window.visualViewport.addEventListener("scroll", onViewportChange);
}
updateVH();

/* ===== 量測 Topbar 實際高度（避免預估不準） ===== */
function updateTopbarH() {
  const tb = document.querySelector(".topbar");
  if (tb)
    document.documentElement.style.setProperty(
      "--topbar-h",
      `${tb.offsetHeight}px`
    );
}
window.addEventListener("resize", updateTopbarH);
window.addEventListener("orientationchange", updateTopbarH);
window.addEventListener("DOMContentLoaded", updateTopbarH);
updateTopbarH();

/* ===== 預設題庫（可保留/修改） ===== */
const PRESET_BANKS = [
  {
    id: "kpop-male",
    label: "KPOP男豆BATTLE",
    url:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=262246607&single=true&output=csv"
  },
  {
    id: "kpop-female",
    label: "KPOP女豆BATTLE",
    url:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=1697531857&single=true&output=csv"
  },
  {
    id: "kpop-boygroup",
    label: "KPOP男團BATTLE(部分)",
    url:
      "https://docs.google.com/spreadsheets/d/e/2PACX-1vSx4T46KlhDjb5LpnkTDjbF2_jQ_3aRK0SGXjfW2szL8oBoCmW2a-YMHpl8uSxHNqW_KMa09Y8KAqmi/pub?gid=544567236&single=true&output=csv"
  }
];

/* ===== State ===== */
const STORAGE_KEY = "se-ranking-state-v8";
let state = {
  entries: [], // {id,name,img}[]
  finalRanking: [], // 完成後的 id[]
  history: [], // undo snapshots
  phaseLabel: "偏好排序",
  mode: "rank", // 'quick' | 'rank'
  battleTitle: "最愛 BATTLE"
};

/* ===== Utils ===== */
const $ = (s) => document.querySelector(s);
const deepClone = (o) => JSON.parse(JSON.stringify(o));
const medalFor = (i) => (i === 0 ? "🥇" : i === 1 ? "🥈" : i === 2 ? "🥉" : "");
const shuffleInPlace = (arr, rng = Math.random) => {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
};

/* ===== Google Drive image helpers ===== */
function isDriveUrl(u) {
  if (!u) return false;
  return /(^https?:\/\/)?(www\.)?drive\.google\.com/.test(String(u));
}
function extractDriveId(u) {
  if (!u) return "";
  const s = String(u).trim();
  const m1 = s.match(/[?&]id=([A-Za-z0-9_-]{10,})/);
  if (m1) return m1[1];
  const m2 = s.match(/\/(?:file\/)?d\/([A-Za-z0-9_-]{10,})/);
  if (m2) return m2[1];
  return "";
}
function toThumbnailUrl(id, sz = 1200) {
  return `https://drive.google.com/thumbnail?id=${id}&sz=w${sz}`;
}
function toUcViewUrl(id) {
  return `https://drive.google.com/uc?export=view&id=${id}`;
}

function setImage(imgEl, name, rawUrl) {
  imgEl.alt = name || "";
  if (!rawUrl) {
    imgEl.src = "";
    return;
  }

  if (isDriveUrl(rawUrl)) {
    const id = extractDriveId(rawUrl);
    if (!id) {
      imgEl.src = "";
      console.warn("Drive 連結缺少檔案ID：", rawUrl);
      return;
    }
    const thumb = toThumbnailUrl(id);
    const uc = toUcViewUrl(id);
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

function preferredThumbUrl(rawUrl, size = 200) {
  if (!rawUrl) return "";
  if (isDriveUrl(rawUrl)) {
    const id = extractDriveId(rawUrl);
    return id ? toThumbnailUrl(id, size) : rawUrl;
  }
  return rawUrl;
}

/* ===== UI helpers / 本機進度保存 ===== */
let choiceBusy = false;
let toastTimer = 0;

function showToast(message) {
  const el = document.getElementById("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove("show"), 1800);
}

function progressPercent() {
  const total = state.entries.length || 0;
  if (!total) return 0;
  if (activeDone()) return 100;
  if (state.mode === "rank") {
    return Math.max(0, Math.min(99, Math.round((Ranker.insertedCount() / total) * 100)));
  }
  if (QuickBattle.phase === "main") {
    const alive = Math.max(1, QuickBattle.competitorsThisRound());
    return Math.max(4, Math.min(82, Math.round((1 - alive / total) * 78) + 4));
  }
  if (QuickBattle.phase === "placement") {
    const n = QuickBattle.placementRounds.length || 1;
    return Math.max(84, Math.min(98, 84 + Math.round((QuickBattle.placementIdx / n) * 14)));
  }
  return 0;
}

function updateProgressUI() {
  const bar = document.getElementById("progressBar");
  const textEl = document.getElementById("progressText");
  const titleEl = document.getElementById("battleTitle");
  if (bar) bar.style.width = `${progressPercent()}%`;
  if (titleEl) titleEl.textContent = state.battleTitle || "最愛 BATTLE";
  if (!textEl) return;

  if (activeDone()) {
    textEl.textContent = "完成";
  } else if (state.mode === "rank") {
    const remain = Ranker.remainingCount();
    textEl.textContent = remain > 0 ? `待排序 ${remain} 位` : "最後整理中";
  } else if (QuickBattle.phase === "main") {
    textEl.textContent = `第 ${QuickBattle.round} 輪`;
  } else {
    textEl.textContent = "排名決定戰";
  }
}

function saveProgress() {
  try {
    if (!state.entries.length || activeDone()) {
      localStorage.removeItem(STORAGE_KEY);
      return;
    }
    const payload = {
      version: 1,
      savedAt: Date.now(),
      snapshot: snapshotOf(),
      history: state.history.slice(-12)
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(payload));
  } catch (e) {
    console.warn("進度保存失敗：", e);
  }
}

function loadSavedPayload() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const payload = JSON.parse(raw);
    if (!payload || !payload.snapshot) return null;
    return payload;
  } catch (e) {
    console.warn("進度讀取失敗：", e);
    return null;
  }
}

/* ===== Parse（同名且同圖才去重；header 寬鬆） ===== */
function parseCsvText(csv) {
  const rows = csv.split(/\r?\n/).filter(Boolean);
  const split = (r) =>
    r
      .split(/,(?=(?:[^"]*"[^"]*")*[^"]*$)/)
      .map((x) => x.replace(/^"|"$/g, "").trim());
  const m = rows.map(split);
  const header = m[0].map((h) => h.trim().toLowerCase());

  const idIdx = header.findIndex((h) => /^id$/.test(h));
  let nameIdx = header.findIndex((h) => /(name|名稱|title)/.test(h));
  let imgIdx = header.findIndex((h) => /(image|img|url|圖片)/.test(h));
  if (nameIdx < 0) nameIdx = 0;

  const seen = new Set();
  const out = [];
  for (let i = 1; i < m.length; i++) {
    const cols = m[i];
    const name = (cols[nameIdx] || "").trim();
    if (!name) continue;
    const imgRaw = imgIdx >= 0 ? (cols[imgIdx] || "").trim() : "";
    const key = `${name}||${imgRaw}`.toLowerCase();
    if (seen.has(key)) continue; // 同名且同圖才去重
    seen.add(key);
    const id =
      idIdx >= 0 && cols[idIdx] ? String(cols[idIdx]).trim() : `row-${i}`;
    out.push({ id, name, img: imgRaw });
  }
  return out;
}

function parseManualList(text) {
  const lines = text
    .split(/\r?\n/)
    .map((s) => s.trim())
    .filter(Boolean);
  const seen = new Set(),
    out = [];
  lines.forEach((line, i) => {
    const [name, imgRaw = ""] = line.split(",").map((x) => x.trim());
    if (!name) return;
    const key = `${name}||${imgRaw}`.toLowerCase();
    if (seen.has(key)) return; // 同名且同圖才去重
    seen.add(key);
    out.push({ id: `m-${i}`, name, img: imgRaw });
  });
  return out;
}

/* =========================================================================
   嚴謹排序版：互動式二分插入排序（任兩個最多比一次；無平手/覆核）
   ========================================================================= */
const Ranker = {
  sorted: [], // 高→低
  rest: [], // 未插入候選
  cur: null, // 當前待插入 id
  lo: 0,
  hi: 0,
  mid: 0,
  pair: null, // [cur, sorted[mid]]
  done: false,
  rng: Math.random,
  total: 0,
  comparisons: 0,

  start(ids, rng = Math.random) {
    this.sorted = [];
    this.rest = ids.slice();
    this.rng = rng;
    shuffleInPlace(this.rest, this.rng); // 洗牌避免初始順序偏誤
    this.done = false;
    this.total = ids.length;
    this.comparisons = 0;
    this._nextCandidate();
  },

  _nextCandidate() {
    if (this.rest.length === 0) {
      this.cur = null;
      this.pair = null;
      this.done = true;
      state.finalRanking = this.sorted.slice();
      return;
    }
    this.cur = this.rest.shift();
    if (this.sorted.length === 0) {
      this.sorted.push(this.cur);
      this._nextCandidate();
      return;
    }
    this.lo = 0;
    this.hi = this.sorted.length; // 插入點區間 [0,len]
    this._step();
  },

  _step() {
    if (this.lo >= this.hi) {
      this.sorted.splice(this.lo, 0, this.cur);
      this.cur = null;
      this.pair = null;
      this._nextCandidate();
      return;
    }
    this.mid = (this.lo + this.hi) >> 1;
    this.pair = [this.cur, this.sorted[this.mid]];
  },

  choose(winnerId) {
    if (!this.pair) return;
    pushSnapshot(); // 先存 Undo
    const [a, b] = this.pair;
    this.comparisons++;

    if (winnerId === a) {
      this.hi = this.mid; // a 更好 → 往左半區
    } else {
      this.lo = this.mid + 1; // b 更好 → 往右半區
    }
    this._step();
    renderAll();
  },

  currentPair() {
    if (!this.pair) return null;
    const [idA, idB] = this.pair;
    const a = state.entries.find((e) => e.id === idA);
    const b = state.entries.find((e) => e.id === idB);
    if (!a || !b) return null;
    return { a, b };
  },

  insertedCount() {
    return this.sorted.length;
  },
  remainingCount() {
    return this.rest.length + (this.cur ? 1 : 0);
  }
};

/* =========================================================================
   快速 Battle（對齊當前版）：
   - 主賽：每輪重洗，BYE 取末位（pop）
   - 排位賽：按同輪淘汰分桶；不洗牌、BYE=末位；遞迴式排位（勝者組 → BYE → 敗者組）
   ========================================================================= */
const QuickBattle = {
  rng: Math.random,

  // 主賽
  phase: "main", // 'main' | 'placement' | 'done'
  seeds: [], // 當前輪種子
  round: 1,
  pairs: [], // 當前輪配對 [[a,b],...]
  pairIdx: 0,
  byes: [], // 當前輪 BYE
  winners: [], // 當前輪的勝者（下一輪種子的一部分）
  elim: [], // elim[r] = 在第 r 輪被淘汰的 id[]
  championId: null,
  comparisons: 0,

  // 排位賽（遞迴）
  placementRounds: [], // [最後輪次, ..., 1]
  placementIdx: 0, // 目前打到第幾個 bucket（按輪次）
  placementStack: [], // 遞迴任務堆疊（深度優先）
  pResults: {}, // round -> 完整排序結果（遞迴後）

  start(ids, rng = Math.random) {
    this.rng = rng;
    this.seeds = ids.slice();
    shuffleInPlace(this.seeds, this.rng);
    this.round = 1;
    this.elim = [];
    this.phase = "main";
    this.comparisons = 0;
    this.championId = null;

    this._buildMainRound();
  },

  /* ---------- 主賽：建構一輪（每輪重洗、BYE=末位） ---------- */
  _buildMainRound() {
    this.pairs = [];
    this.pairIdx = 0;
    this.byes = [];
    this.winners = [];

    const pool = this.seeds.slice();
    shuffleInPlace(pool, this.rng); // 每輪重洗
    if (pool.length === 1) {
      // 主賽結束 → 設定冠軍、轉入排位賽
      this._startPlacement(pool[0]);
      return;
    }
    if (pool.length % 2 === 1) {
      // BYE 取末位（對齊你當前版）
      this.byes.push(pool.pop());
    }
    while (pool.length >= 2) {
      const a = pool.shift();
      const b = pool.shift();
      this.pairs.push([a, b]);
    }
    if (this.pairs.length === 0) {
      const last = this.byes[0] ?? this.seeds[0];
      this._startPlacement(last);
    }
  },

  /* ---------- 主賽：選勝 ---------- */
  _chooseMain(winnerId) {
    const pair = this.pairs[this.pairIdx];
    if (!pair) return;
    pushSnapshot();
    const [aId, bId] = pair;
    const loserId = winnerId === aId ? bId : aId;
    this.comparisons++;

    if (!this.elim[this.round]) this.elim[this.round] = [];
    this.elim[this.round].push(loserId);
    this.winners.push(winnerId);

    this.pairIdx++;
    if (this.pairIdx < this.pairs.length) {
      renderAll();
      return;
    }

    // 一輪結束 → 下一輪或進入排位
    this.seeds = this.winners.concat(this.byes);
    this.round++;

    if (this.seeds.length === 1) {
      this._startPlacement(this.seeds[0]);
    } else {
      this._buildMainRound();
      renderAll();
    }
  },

  /* ---------- 排位賽：初始化（不洗牌、遞迴式） ---------- */
  _startPlacement(championId) {
    this.championId = championId;

    // 蒐集有資料的淘汰輪次，從深到淺（越晚淘汰越前排）
    const rounds = Object.keys(this.elim)
      .map((n) => parseInt(n, 10))
      .filter(
        (n) => n > 0 && Array.isArray(this.elim[n]) && this.elim[n].length > 0
      )
      .sort((a, b) => b - a);

    this.placementRounds = rounds;
    this.placementIdx = 0;
    this.pResults = {};
    this.placementStack = [];
    this.phase = "placement";

    // 沒有任何淘汰者 → 直接完成
    if (this.placementRounds.length === 0) {
      this._finalizeRanking();
    } else {
      // 以該輪 losers 的「現有順序」建立根任務（不洗牌，BYE=末位）
      const list = (
        this.elim[this.placementRounds[this.placementIdx]] || []
      ).slice();
      this.placementStack.push(this._buildPlacementTask(list, null, "root"));
      this._ensurePlacementActiveTask();
      renderAll();
    }
  },

  /* ---------- 建立一個排位賽任務（bucket） ---------- */
  _buildPlacementTask(list, parent, branch) {
    // 依「當前順序」配對；若為奇數，BYE 取末位
    const pairs = [];
    const byes = [];
    const L = list.length;
    let end = L;

    if (L % 2 === 1) {
      byes.push(list[L - 1]); // 末位 BYE
      end = L - 1;
    }
    for (let i = 0; i < end; i += 2) {
      pairs.push([list[i], list[i + 1]]);
    }

    return {
      list,
      parent,
      branch,
      stage: "round", // 'round' | 'children'
      pairs,
      pairIdx: 0,
      byes,
      winners: [],
      losers: [],
      winnersResult: null,
      losersResult: null,
      result: null
    };
  },

  /* ---------- 排位賽：選勝 ---------- */
  _choosePlacement(winnerId) {
    const task = this.placementStack[this.placementStack.length - 1];
    if (!task || task.stage !== "round") return;

    const [aId, bId] = task.pairs[task.pairIdx];
    const loserId = winnerId === aId ? bId : aId;

    pushSnapshot();
    this.comparisons++;

    task.winners.push(winnerId);
    task.losers.push(loserId);
    task.pairIdx++;

    if (task.pairIdx >= task.pairs.length) {
      task.stage = "children";
    }

    this._ensurePlacementActiveTask();
    renderAll();
  },

  /* ---------- 驅動遞迴：找到下一個需要比較的任務 ---------- */
  _ensurePlacementActiveTask() {
    // 深度優先：先排「勝者組」→ 接上 BYE → 再排「敗者組」
    while (this.phase === "placement") {
      const task = this.placementStack[this.placementStack.length - 1];

      // 當前輪已結束（沒有任務了）
      if (!task) {
        // 完成當前輪的 bucket，移動到下一輪；或全部完成
        this.placementIdx++;
        if (this.placementIdx >= this.placementRounds.length) {
          this._finalizeRanking();
          return;
        }
        const list = (
          this.elim[this.placementRounds[this.placementIdx]] || []
        ).slice();
        this.placementStack.push(this._buildPlacementTask(list, null, "root"));
        continue;
      }

      // 1) 還在 round 階段，且仍有對局要打 → 停下來等待 UI 取 pair
      if (task.stage === "round") {
        // 長度 0 或 1 的 bucket：不需比較，直接完成
        if (task.list.length <= 1) {
          task.result = task.list.slice();
          this._popPlacementTaskAndPropagate();
          continue;
        }
        if (task.pairIdx < task.pairs.length) return; // 等待使用者選擇
        // 該輪全部打完，進入 children 階段
        task.stage = "children";
        continue;
      }

      // 2) children 階段：先處理 winners 分支
      if (task.winnersResult == null) {
        if (task.winners.length <= 1) {
          task.winnersResult = task.winners.slice();
          continue; // 回圈再檢查 losers 分支
        } else {
          // 建立 winners 子任務（不洗牌、BYE 末位）
          this.placementStack.push(
            this._buildPlacementTask(task.winners, task, "winners")
          );
          continue;
        }
      }

      // 3) 接著處理 losers 分支
      if (task.losersResult == null) {
        if (task.losers.length <= 1) {
          task.losersResult = task.losers.slice();
          continue;
        } else {
          this.placementStack.push(
            this._buildPlacementTask(task.losers, task, "losers")
          );
          continue;
        }
      }

      // 4) winners/losers 都已得到結果 → 組合自己的結果：勝者組 → BYE → 敗者組
      task.result = (task.winnersResult || []).concat(
        task.byes || [],
        task.losersResult || []
      );
      this._popPlacementTaskAndPropagate();
    }
  },

  /* ---------- 子任務完成後回填至父任務；或若為根任務，記錄該輪結果 ---------- */
  _popPlacementTaskAndPropagate() {
    const done = this.placementStack.pop();
    const parent = done.parent;

    if (!parent) {
      // 根任務：把結果存入該輪次，再等待下一輪或結束
      const r = this.placementRounds[this.placementIdx];
      this.pResults[r] = done.result.slice();
      return;
    }

    if (done.branch === "winners") parent.winnersResult = done.result.slice();
    else if (done.branch === "losers")
      parent.losersResult = done.result.slice();
  },

  /* ---------- 產生最終名次（冠軍 + 各輪遞迴排序結果） ---------- */
  _finalizeRanking() {
    const out = [];
    if (this.championId) out.push(this.championId);
    for (const r of this.placementRounds) {
      const arr = this.pResults[r] || [];
      out.push(...arr);
    }
    this.phase = "done";
    state.finalRanking = out;
    renderAll();
  },

  /* ---------- 復原時重建 parent 參照（給 Undo 用） ---------- */
  _linkRestoredParents() {
    const st = this.placementStack;
    for (let i = 0; i < st.length; i++) {
      const t = st[i];
      if (!t) continue;
      if (t.branch === "root") {
        t.parent = null;
        continue;
      }
      // 向前找一個還在 children 階段、對應分支尚未填結果的父任務
      for (let j = i - 1; j >= 0; j--) {
        const p = st[j];
        if (!p || p.stage !== "children") continue;
        if (t.branch === "winners" && p.winnersResult == null) {
          t.parent = p;
          break;
        }
        if (t.branch === "losers" && p.losersResult == null) {
          t.parent = p;
          break;
        }
      }
      // 若找不到就留 null（極少見；主要是避免壞狀態）
      if (!t.parent) t.parent = null;
    }
  },

  /* ---------- 對外介面 ---------- */
  currentPair() {
    if (this.phase === "done") return null;

    if (this.phase === "main") {
      if (this.pairIdx < this.pairs.length) {
        const [aId, bId] = this.pairs[this.pairIdx];
        const a = state.entries.find((e) => e.id === aId);
        const b = state.entries.find((e) => e.id === bId);
        if (!a || !b) return null;
        return { a, b };
      }
      return null;
    }

    // placement：取堆疊最上層、仍在 round 階段且尚未打完的對局
    const task = this.placementStack[this.placementStack.length - 1];
    if (!task) return null;
    if (task.stage !== "round") return null;
    if (task.pairIdx >= task.pairs.length) return null;

    const [aId, bId] = task.pairs[task.pairIdx];
    const a = state.entries.find((e) => e.id === aId);
    const b = state.entries.find((e) => e.id === bId);
    if (!a || !b) return null;
    return { a, b };
  },

  choose(winnerId) {
    if (this.phase === "main") return this._chooseMain(winnerId);
    if (this.phase === "placement") return this._choosePlacement(winnerId);
  },

  roundProgress() {
    if (this.phase === "main") {
      if (this.pairs.length === 0) return "—";
      return `${Math.min(this.pairIdx + 1, this.pairs.length)}/${
        this.pairs.length
      }`;
    } else if (this.phase === "placement") {
      const task = this.placementStack[this.placementStack.length - 1];
      if (!task || task.stage !== "round" || task.pairs.length === 0)
        return "—";
      return `${Math.min(task.pairIdx + 1, task.pairs.length)}/${
        task.pairs.length
      }`;
    }
    return "—";
  },

  remainingMatchesThisRound() {
    if (this.phase === "main")
      return Math.max(0, this.pairs.length - this.pairIdx - 1);
    if (this.phase === "placement") {
      const task = this.placementStack[this.placementStack.length - 1];
      if (!task || task.stage !== "round") return 0;
      return Math.max(0, task.pairs.length - task.pairIdx - 1);
    }
    return 0;
  },

  competitorsThisRound() {
    if (this.phase === "main") return this.pairs.length * 2 + this.byes.length;
    if (this.phase === "placement") {
      const task = this.placementStack[this.placementStack.length - 1];
      if (!task || task.stage !== "round") return 0;
      return task.pairs.length * 2 + (task.byes?.length || 0);
    }
    return 0;
  }
};

/* ===== Snapshots / Undo（Ranker + QuickBattle 都納入） ===== */
function snapshotOf() {
  return JSON.stringify({
    entries: state.entries,
    phaseLabel: state.phaseLabel,
    finalRanking: state.finalRanking,
    mode: state.mode,
    battleTitle: state.battleTitle,
    ranker: {
      sorted: Ranker.sorted,
      rest: Ranker.rest,
      cur: Ranker.cur,
      lo: Ranker.lo,
      hi: Ranker.hi,
      mid: Ranker.mid,
      pair: Ranker.pair,
      done: Ranker.done,
      total: Ranker.total,
      comparisons: Ranker.comparisons
    },
    quick: {
      phase: QuickBattle.phase,
      seeds: QuickBattle.seeds,
      round: QuickBattle.round,
      pairs: QuickBattle.pairs,
      pairIdx: QuickBattle.pairIdx,
      byes: QuickBattle.byes,
      winners: QuickBattle.winners,
      elim: QuickBattle.elim,
      championId: QuickBattle.championId,
      comparisons: QuickBattle.comparisons,
      placementRounds: QuickBattle.placementRounds,
      placementIdx: QuickBattle.placementIdx,
      placementStack: QuickBattle.placementStack.map((t) => ({
        // 序列化必要欄位（函式不序列化）
        list: t.list,
        stage: t.stage,
        pairs: t.pairs,
        pairIdx: t.pairIdx,
        byes: t.byes,
        winners: t.winners,
        losers: t.losers,
        winnersResult: t.winnersResult,
        losersResult: t.losersResult,
        result: t.result,
        branch: t.branch
      })),
      pResults: QuickBattle.pResults
    }
  });
}
function pushSnapshot() {
  state.history.push(snapshotOf());
  const LIMIT = 200;
  if (state.history.length > LIMIT) state.history.shift();
}
function applySnapshot(s) {
  state.entries = s.entries || [];
  state.phaseLabel = s.phaseLabel || "偏好排序";
  state.finalRanking = s.finalRanking || [];
  state.mode = s.mode || "rank";
  state.battleTitle = s.battleTitle || "最愛 BATTLE";

  const r = s.ranker || {};
  Ranker.sorted = r.sorted || [];
  Ranker.rest = r.rest || [];
  Ranker.cur = r.cur || null;
  Ranker.lo = r.lo || 0;
  Ranker.hi = r.hi || 0;
  Ranker.mid = r.mid || 0;
  Ranker.pair = r.pair || null;
  Ranker.done = !!r.done;
  Ranker.total = r.total || state.entries?.length || 0;
  Ranker.comparisons = r.comparisons || 0;

  const q = s.quick || {};
  QuickBattle.phase = q.phase || "main";
  QuickBattle.seeds = q.seeds || [];
  QuickBattle.round = q.round || 1;
  QuickBattle.pairs = q.pairs || [];
  QuickBattle.pairIdx = q.pairIdx || 0;
  QuickBattle.byes = q.byes || [];
  QuickBattle.winners = q.winners || [];
  QuickBattle.elim = q.elim || [];
  QuickBattle.championId = q.championId || null;
  QuickBattle.comparisons = q.comparisons || 0;
  QuickBattle.placementRounds = q.placementRounds || [];
  QuickBattle.placementIdx = q.placementIdx || 0;
  QuickBattle.placementStack = (q.placementStack || []).map((t) => ({
    list: t.list,
    parent: null,
    branch: t.branch || "root",
    stage: t.stage || "round",
    pairs: t.pairs || [],
    pairIdx: t.pairIdx || 0,
    byes: t.byes || [],
    winners: t.winners || [],
    losers: t.losers || [],
    winnersResult: t.winnersResult || null,
    losersResult: t.losersResult || null,
    result: t.result || null
  }));
  QuickBattle._linkRestoredParents();
  QuickBattle.pResults = q.pResults || {};
}

function undo() {
  if (choiceBusy) return;
  const snap = state.history.pop();
  if (!snap) {
    showToast("目前沒有可復原的步驟");
    return;
  }
  applySnapshot(JSON.parse(snap));
  renderAll();
  saveProgress();
}


/* ===== UI Rendering（兩模式共用） ===== */
function getActivePair() {
  return state.mode === "quick"
    ? QuickBattle.currentPair()
    : Ranker.currentPair();
}
function activeDone() {
  if (state.mode === "quick") return QuickBattle.phase === "done";
  return Ranker.done;
}
function chooseWinner(id) {
  if (choiceBusy || activeDone()) return;
  const pair = getActivePair();
  if (!pair || (id !== pair.a.id && id !== pair.b.id)) return;

  choiceBusy = true;
  const aCard = document.getElementById("cardA");
  const bCard = document.getElementById("cardB");
  const winnerCard = id === pair.a.id ? aCard : bCard;
  const loserCard = id === pair.a.id ? bCard : aCard;
  [aCard, bCard].forEach((el) => el && el.classList.add("is-busy"));
  if (winnerCard) winnerCard.classList.add("is-winner");
  if (loserCard) loserCard.classList.add("is-loser");

  setTimeout(() => {
    [aCard, bCard].forEach((el) => {
      if (!el) return;
      el.classList.remove("is-busy", "is-winner", "is-loser");
    });
    if (state.mode === "quick") QuickBattle.choose(id);
    else Ranker.choose(id);
    choiceBusy = false;
    saveProgress();
  }, 180);
}

function renderResults() {
  const podium = document.getElementById("podium");
  const list = document.getElementById("rankList");
  const meta = document.getElementById("resultMeta");
  if (!podium || !list) return;

  const entries = state.finalRanking
    .map((id) => state.entries.find((e) => e.id === id))
    .filter(Boolean);

  const now = new Date();
  const dateOnly = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
  if (meta) meta.textContent = `${state.battleTitle || "最愛 BATTLE"} · ${dateOnly} · ${entries.length} 位`;

  podium.innerHTML = "";
  const classes = ["first", "second", "third"];
  entries.slice(0, 3).forEach((e, i) => {
    const item = document.createElement("div");
    item.className = `podium-item ${classes[i] || ""}`;

    const rank = document.createElement("span");
    rank.className = "podium-rank";
    rank.textContent = i === 0 ? "👑" : `#${i + 1}`;

    const img = document.createElement("img");
    setImage(img, e.name, e.img);

    const name = document.createElement("span");
    name.className = "podium-name";
    name.textContent = e.name;

    item.append(rank, img, name);
    podium.appendChild(item);
  });

  list.innerHTML = "";
  entries.forEach((e, i) => {
    const li = document.createElement("li");
    li.className = "rank-item";

    const num = document.createElement("span");
    num.className = "rank-number";
    num.textContent = i < 3 ? medalFor(i) || `#${i + 1}` : `#${i + 1}`;

    const img = document.createElement("img");
    img.className = "rank-avatar";
    setImage(img, e.name, e.img);

    const name = document.createElement("span");
    name.className = "rank-name";
    name.textContent = e.name;

    li.append(num, img, name);
    list.appendChild(li);
  });
}

function copyResult() {
  const rows = state.finalRanking
    .map((id, i) => {
      const e = state.entries.find((x) => x.id === id);
      return e ? `${i + 1}. ${e.name}` : null;
    })
    .filter(Boolean);
  if (!rows.length) return;
  const text = `${state.battleTitle || "最愛 BATTLE"}\n\n${rows.join("\n")}`;

  const fallback = () => {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.style.position = "fixed";
    ta.style.opacity = "0";
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand("copy"); } catch {}
    ta.remove();
    showToast("排名已複製");
  };

  if (navigator.clipboard?.writeText) {
    navigator.clipboard.writeText(text).then(() => showToast("排名已複製")).catch(fallback);
  } else {
    fallback();
  }
}

function restartSameBattle() {
  if (!state.entries.length) return;
  state.finalRanking = [];
  state.history = [];
  const ids = state.entries.map((e) => e.id);
  if (state.mode === "quick") QuickBattle.start(ids, Math.random);
  else Ranker.start(ids, Math.random);

  const t = document.getElementById("tournament");
  if (t) t.classList.remove("finished");
  const box = document.getElementById("championBox");
  if (box) box.hidden = true;
  renderAll();
  saveProgress();
}

function renderArena() {
  const p = getActivePair();

  if (!p && !activeDone()) {
    if (state.mode === "rank") {
      Ranker.done = true;
      state.finalRanking = Ranker.sorted.slice();
    }
  }

  if (activeDone()) {
    const t = $("#tournament");
    if (t) t.classList.add("finished");
    $("#cardA").style.display = "none";
    $("#cardB").style.display = "none";
    const vs = $(".vs");
    if (vs) vs.style.display = "none";

    $("#roundLabel").textContent = "完成排行";
    $("#roundProgress").textContent = "100%";
    $("#remaining").textContent = "0";

    const box = $("#championBox");
    box.hidden = false;
    renderResults();

    const sb = $(".sidebar");
    if (sb) sb.style.display = "block";
    updateProgressUI();
    return;
  }

  // 進行中
  const t = $("#tournament");
  if (t) t.classList.remove("finished");
  const sb = $(".sidebar");
  if (sb) sb.style.display = "none";

  $("#cardA").style.display = "";
  $("#cardB").style.display = "";
  const vs = $(".vs");
  if (vs) vs.style.display = "";

  setImage($("#imgA"), p.a.name, p.a.img);
  setImage($("#imgB"), p.b.name, p.b.img);
  $("#nameA").textContent = p.a.name;
  $("#nameB").textContent = p.b.name;

  if (state.mode === "rank") {
    const inserted = Ranker.insertedCount();
    const total = Ranker.total || state.entries.length || 0;
    const remain = Ranker.remainingCount();

    $("#roundLabel").textContent = `完整排行`;
    $("#roundProgress").textContent = `${inserted}/${total}`;
    $("#remaining").textContent = String(remain);
  } else {
    if (QuickBattle.phase === "main") {
      $("#roundLabel").textContent = `快速 Battle｜第 ${QuickBattle.round} 輪`;
      $("#roundProgress").textContent = QuickBattle.roundProgress();
      $("#remaining").textContent = String(
        QuickBattle.remainingMatchesThisRound()
      );
    } else if (QuickBattle.phase === "placement") {
      const totalBuckets = QuickBattle.placementRounds.length;
      const curBucketNo = Math.min(QuickBattle.placementIdx + 1, totalBuckets);
      $(
        "#roundLabel"
      ).textContent = `排名決定戰｜${curBucketNo}/${totalBuckets}`;
      $("#roundProgress").textContent = QuickBattle.roundProgress();
      $("#remaining").textContent = String(
        QuickBattle.remainingMatchesThisRound()
      );
    }
  }

  updateProgressUI();
  if (typeof scheduleFitCards === "function") scheduleFitCards([0], 2);
}

function renderAll() {
  renderArena();
}

/* ===== 讓卡片依容器自適應 ===== */
function fitCards() {
  const arena = document.querySelector(".arena");
  if (!arena || getComputedStyle(arena).display === "none") return;

  const arenaBoxH = arena.getBoundingClientRect().height;
  const aCS = getComputedStyle(arena);
  const aPadTop = parseFloat(aCS.paddingTop || "0") || 0;
  const aPadBot = parseFloat(aCS.paddingBottom || "0") || 0;
  const aBdTop = parseFloat(aCS.borderTopWidth || "0") || 0;
  const aBdBot = parseFloat(aCS.borderBottomWidth || "0") || 0;
  const arenaH = Math.max(0, arenaBoxH - aPadTop - aPadBot - aBdTop - aBdBot);

  const vs = arena.querySelector(".vs");
  const vsH = vs ? vs.getBoundingClientRect().height : 0;
  const rowGap = parseFloat(aCS.rowGap || aCS.gap || "0") || 0;
  const isMobile = window.matchMedia("(max-width: 760px)").matches;

  const perCardTotalH = isMobile ? (arenaH - vsH - rowGap) / 2 : arenaH;

  ["cardA", "cardB"].forEach((id) => {
    const card = document.getElementById(id);
    if (!card) return;
    const img = card.querySelector("img");
    const title = card.querySelector(".card-info");

    const ccs = getComputedStyle(card);
    const mTop = parseFloat(ccs.marginTop || "0") || 0;
    const mBot = parseFloat(ccs.marginBottom || "0") || 0;

    const cPadTop = parseFloat(ccs.paddingTop || "0") || 0;
    const cPadBot = parseFloat(ccs.paddingBottom || "0") || 0;
    const cBorderTop = parseFloat(ccs.borderTopWidth || "0") || 0;
    const cBorderBot = parseFloat(ccs.borderBottomWidth || "0") || 0;
    const paddingBorder = cPadTop + cPadBot + cBorderTop + cBorderBot;

    const titleH = title ? title.getBoundingClientRect().height : 0;
    const tcs = title ? getComputedStyle(title) : null;
    const titleMargin = tcs
      ? parseFloat(tcs.marginTop || "0") + parseFloat(tcs.marginBottom || "0")
      : 0;

    const cardGap = parseFloat(ccs.gap || ccs.rowGap || "0") || 0;
    const maxImgH = Math.max(
      0,
      perCardTotalH - paddingBorder - titleH - titleMargin - cardGap - 4
    );

    const cardInnerW =
      card.clientWidth -
      parseFloat(ccs.paddingLeft || "0") -
      parseFloat(ccs.paddingRight || "0");
    const heightByAspect = cardInnerW * (4 / 3);
    const finalImgH = Math.min(maxImgH, heightByAspect);

    img.style.height = `${finalImgH}px`;
    img.style.width = `${finalImgH * (3 / 4)}px`;
    img.style.margin = "0 auto";
  });
}

/* === 穩定首屏：多次延後＋多幀重算 fitCards === */
let fitRAF = 0,
  fitTimers = [];
function scheduleFitCards(bursts = [0, 60, 250], frames = 3) {
  if (fitRAF) cancelAnimationFrame(fitRAF);
  fitTimers.forEach((t) => clearTimeout(t));
  fitTimers = [];

  const runFrames = (n) => {
    fitCards();
    if (n > 0) fitRAF = requestAnimationFrame(() => runFrames(n - 1));
  };

  bursts.forEach((delay) => {
    fitTimers.push(setTimeout(() => runFrames(frames), delay));
  });
}

window.addEventListener("load", () => {
  updateVH();
  updateTopbarH();
  scheduleFitCards([0, 60, 250], 4);
});
window.addEventListener("resize", () => scheduleFitCards([0], 2));
window.addEventListener("orientationchange", () =>
  scheduleFitCards([0, 60], 3)
);
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible") scheduleFitCards([0, 60], 2);
});
if (document.fonts && document.fonts.ready) {
  document.fonts.ready.then(() => scheduleFitCards([0], 3));
}
["imgA", "imgB"].forEach((id) => {
  const el = document.getElementById(id);
  if (el)
    el.addEventListener("load", () => scheduleFitCards([0], 2), {
      once: false
    });
});

/* ===== Reset：完整清空狀態與 UI，不再依賴 reload ===== */
function resetAll() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {}

  // 清主狀態
  state.entries = [];
  state.finalRanking = [];
  state.history = [];
  state.phaseLabel = "偏好排序";
  state.mode = "rank";
  state.battleTitle = "最愛 BATTLE";

  // 清 Ranker
  Ranker.sorted = [];
  Ranker.rest = [];
  Ranker.cur = null;
  Ranker.lo = 0;
  Ranker.hi = 0;
  Ranker.mid = 0;
  Ranker.pair = null;
  Ranker.done = false;
  Ranker.total = 0;
  Ranker.comparisons = 0;

  // 清 QuickBattle
  QuickBattle.phase = "main";
  QuickBattle.seeds = [];
  QuickBattle.round = 1;
  QuickBattle.pairs = [];
  QuickBattle.pairIdx = 0;
  QuickBattle.byes = [];
  QuickBattle.winners = [];
  QuickBattle.elim = [];
  QuickBattle.championId = null;
  QuickBattle.comparisons = 0;
  QuickBattle.placementRounds = [];
  QuickBattle.placementIdx = 0;
  QuickBattle.placementStack = [];
  QuickBattle.pResults = {};

  // 還原 UI
  const setup = document.getElementById("setup");
  const tour = document.getElementById("tournament");
  if (setup) setup.classList.remove("hidden");
  if (tour) tour.classList.add("hidden");
  if (tour) tour.classList.remove("finished");

  const sb = document.querySelector(".sidebar");
  if (sb) sb.style.display = "none";
  const champ = document.getElementById("championBox");
  if (champ) champ.hidden = true;
  const ol = document.getElementById("rankList");
  if (ol) ol.innerHTML = "";

  // 清對戰區顯示
  const imgA = document.getElementById("imgA");
  const imgB = document.getElementById("imgB");
  if (imgA) {
    imgA.src = "";
    imgA.alt = "";
  }
  if (imgB) {
    imgB.src = "";
    imgB.alt = "";
  }
  const nameA = document.getElementById("nameA");
  const nameB = document.getElementById("nameB");
  if (nameA) nameA.textContent = "";
  if (nameB) nameB.textContent = "";

  // 重置標籤/計數
  const rl = document.getElementById("roundLabel");
  const rp = document.getElementById("roundProgress");
  const rm = document.getElementById("remaining");
  if (rl) rl.textContent = "—";
  if (rp) rp.textContent = "0/0";
  if (rm) rm.textContent = "0";

  // 清輸入（可依需求改成保留）
  const preset = document.getElementById("presetSelect");
  const url = document.getElementById("csvUrl");
  const manual = document.getElementById("manualList");
  const preview = document.getElementById("previewCount");
  if (preset) preset.value = "";
  if (url) url.value = "";
  if (manual) manual.value = "";
  if (preview) preview.textContent = "";
  document.querySelectorAll(".preset-card.active").forEach((el) => el.classList.remove("active"));
  const resumePanel = document.getElementById("resumePanel");
  if (resumePanel) resumePanel.classList.add("hidden");

  // 回到頂端
  window.scrollTo({ top: 0, behavior: "instant" });
}

/* ===== 綁定事件（依模式分派；重置改呼叫 resetAll） ===== */
function bindTournamentEvents() {
  if (bindTournamentEvents._bound) return;
  bindTournamentEvents._bound = true;

  const cardA = $("#cardA");
  const cardB = $("#cardB");
  cardA.addEventListener("click", () => {
    const p = getActivePair();
    if (p) chooseWinner(p.a.id);
  });
  cardB.addEventListener("click", () => {
    const p = getActivePair();
    if (p) chooseWinner(p.b.id);
  });

  const activateCard = (side) => (e) => {
    if (e.key !== "Enter" && e.key !== " ") return;
    e.preventDefault();
    const p = getActivePair();
    if (p) chooseWinner(side === "a" ? p.a.id : p.b.id);
  };
  cardA.addEventListener("keydown", activateCard("a"));
  cardB.addEventListener("keydown", activateCard("b"));

  $("#undoBtn").addEventListener("click", undo);
  $("#resetBtn").addEventListener("click", () => {
    if (confirm("要結束目前 Battle 並回到首頁嗎？目前進度會被清除。")) resetAll();
  });

  const copyBtn = document.getElementById("copyResultBtn");
  if (copyBtn) copyBtn.addEventListener("click", copyResult);
  const againBtn = document.getElementById("playAgainBtn");
  if (againBtn) againBtn.addEventListener("click", restartSameBattle);

  window.addEventListener("keydown", (e) => {
    const tag = document.activeElement?.tagName?.toLowerCase();
    if (["input", "textarea", "select"].includes(tag)) return;
    if (e.key === "ArrowLeft") {
      const p = getActivePair();
      if (p) chooseWinner(p.a.id);
    }
    if (e.key === "ArrowRight") {
      const p = getActivePair();
      if (p) chooseWinner(p.b.id);
    }
    const k = e.key.toLowerCase();
    if (k === "u") undo();
    if (k === "r") $("#resetBtn").click();
  });
}


/* ===== 預設題庫下拉（若有） ===== */
function initPresetSelectIfAny() {
  const sel = document.getElementById("presetSelect");
  const grid = document.getElementById("presetChips");
  const previewEl = document.getElementById("previewCount");
  if (!sel) return;

  sel.innerHTML = '<option value="">自訂題庫</option>';
  if (grid) grid.innerHTML = "";

  (PRESET_BANKS || []).forEach((b, index) => {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.label || b.id;
    sel.appendChild(opt);

    if (grid) {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "preset-card";
      btn.dataset.presetId = b.id;
      btn.innerHTML = `<span class="preset-tag">PRESET ${String(index + 1).padStart(2, "0")}</span><strong>${b.label || b.id}</strong><small>點一下選擇題庫</small>`;
      btn.addEventListener("click", () => {
        sel.value = b.id;
        const url = $("#csvUrl"), ta = $("#manualList");
        if (url) url.value = "";
        if (ta) ta.value = "";
        sel.dispatchEvent(new Event("change"));
      });
      grid.appendChild(btn);
    }
  });

  async function refreshPreview() {
    if (!previewEl) return;
    const pickedId = sel.value;
    document.querySelectorAll(".preset-card").forEach((btn) => {
      btn.classList.toggle("active", btn.dataset.presetId === pickedId);
    });
    if (!pickedId) {
      const manual = $("#manualList")?.value?.trim() || "";
      const rows = manual ? parseManualList(manual) : [];
      previewEl.textContent = rows.length ? `${rows.length} 位` : "";
      return;
    }
    const bank = PRESET_BANKS.find((x) => x.id === pickedId);
    if (!bank) return;
    previewEl.textContent = "讀取中…";
    try {
      const r = await fetch(bank.url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const rows = parseCsvText(await r.text());
      previewEl.textContent = rows.length > 0 ? `${rows.length} 位` : "題庫為空";
      const active = document.querySelector(`.preset-card[data-preset-id="${pickedId}"] small`);
      if (active) active.textContent = rows.length > 0 ? `${rows.length} 位參賽者` : "目前沒有資料";
    } catch (_e) {
      previewEl.textContent = "讀取失敗";
    }
  }

  sel.addEventListener("change", refreshPreview);

  const manual = document.getElementById("manualList");
  if (manual) manual.addEventListener("input", () => {
    if (manual.value.trim()) {
      sel.value = "";
      document.querySelectorAll(".preset-card.active").forEach((el) => el.classList.remove("active"));
    }
    const count = parseManualList(manual.value).length;
    if (previewEl) previewEl.textContent = count ? `${count} 位` : "";
  });

  const csv = document.getElementById("csvUrl");
  if (csv) csv.addEventListener("input", () => {
    if (csv.value.trim()) {
      sel.value = "";
      document.querySelectorAll(".preset-card.active").forEach((el) => el.classList.remove("active"));
      if (previewEl) previewEl.textContent = "";
    }
  });

  const reload = document.getElementById("reloadPreviewBtn");
  if (reload && !reload._bound) {
    reload.addEventListener("click", async () => {
      if (sel.value) return refreshPreview();
      const url = csv?.value?.trim();
      if (!url) return showToast("請先選題庫或輸入 CSV 連結");
      if (previewEl) previewEl.textContent = "讀取中…";
      try {
        const r = await fetch(url, { cache: "no-store" });
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const rows = parseCsvText(await r.text());
        if (previewEl) previewEl.textContent = rows.length ? `${rows.length} 位` : "題庫為空";
      } catch {
        if (previewEl) previewEl.textContent = "讀取失敗";
      }
    });
    reload._bound = true;
  }
}

function initResumeIfAny() {
  const payload = loadSavedPayload();
  const panel = document.getElementById("resumePanel");
  const textEl = document.getElementById("resumeText");
  const resumeBtn = document.getElementById("resumeBtn");
  const discardBtn = document.getElementById("discardResumeBtn");
  if (!panel || !payload) return;

  try {
    const snap = JSON.parse(payload.snapshot);
    const count = snap.entries?.length || 0;
    if (count < 2) return;
    const modeText = snap.mode === "quick" ? "快速 Battle" : "完整排行";
    if (textEl) textEl.textContent = `${snap.battleTitle || "最愛 BATTLE"} · ${modeText} · ${count} 位`;
    panel.classList.remove("hidden");

    resumeBtn?.addEventListener("click", () => {
      applySnapshot(snap);
      state.history = Array.isArray(payload.history) ? payload.history : [];
      $("#setup").classList.add("hidden");
      $("#tournament").classList.remove("hidden");
      bindTournamentEvents();
      renderAll();
      scheduleFitCards([0, 60, 250], 4);
    }, { once: true });

    discardBtn?.addEventListener("click", () => {
      try { localStorage.removeItem(STORAGE_KEY); } catch {}
      panel.classList.add("hidden");
      showToast("已捨棄舊進度");
    });
  } catch (e) {
    console.warn("續玩資料損壞：", e);
    try { localStorage.removeItem(STORAGE_KEY); } catch {}
  }
}


/* ===== Setup → Start（含模式選擇） ===== */
document.getElementById("startBtn").addEventListener("click", async () => {
  let entries = [];
  const presetSel = document.getElementById("presetSelect");
  const presetId = presetSel ? (presetSel.value || "").trim() : "";
  const csvUrl = $("#csvUrl") ? $("#csvUrl").value.trim() : "";
  const manual = $("#manualList") ? $("#manualList").value.trim() : "";

  // 讀取名單（不改你的匯入與去重）
  if (presetId) {
    const bank = PRESET_BANKS.find((x) => x.id === presetId);
    if (!bank) {
      alert("預設題庫不存在");
      return;
    }
    try {
      const r = await fetch(bank.url, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      entries = parseCsvText(txt);
    } catch (e) {
      alert("預設題庫載入失敗。請確認連結可公開存取（CSV）。");
      return;
    }
  } else if (csvUrl) {
    try {
      const r = await fetch(csvUrl, { cache: "no-store" });
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      const txt = await r.text();
      entries = parseCsvText(txt);
    } catch (e) {
      alert("CSV 載入失敗。請用 .../pub?output=csv，並確認表單公開。");
      return;
    }
  } else if (manual) {
    entries = parseManualList(manual);
  } else {
    alert("請選擇預設題庫、或輸入 CSV 連結、或貼上清單文字");
    return;
  }

  if (entries.length < 2) {
    alert("至少需要 2 筆資料");
    return;
  }

  // 讀取模式
  const modeInput = document.querySelector('input[name="mode"]:checked');
  state.mode = modeInput ? modeInput.value : "rank";
  const selectedBank = presetId ? PRESET_BANKS.find((x) => x.id === presetId) : null;
  state.battleTitle = selectedBank?.label || "自訂 Battle";

  // 初始化狀態
  state.entries = deepClone(entries);
  state.finalRanking = [];
  state.history = [];

  // 可重現 RNG（需要時再開）
  // const rng = (function makePRNG(seed=12345){let t=seed>>>0;return function(){t+=0x6D2B79F5;let r=Math.imul(t^t>>>15,1|t);r^=r+Math.imul(r^r>>>7,61|r);return ((r^r>>>14)>>>0)/4294967296;};})();
  const rng = Math.random;

  if (state.mode === "quick") {
    state.phaseLabel = "快速 Battle";
    QuickBattle.start(
      state.entries.map((e) => e.id),
      rng
    );
  } else {
    state.phaseLabel = "偏好排序";
    Ranker.start(
      state.entries.map((e) => e.id),
      rng
    );
  }

  $("#setup").classList.add("hidden");
  $("#tournament").classList.remove("hidden");
  bindTournamentEvents();
  renderAll();
  saveProgress();
  scheduleFitCards([0, 60, 250], 4);
});

/* ===== 初始化 ===== */
window.addEventListener("DOMContentLoaded", () => {
  initPresetSelectIfAny();
  initResumeIfAny();
  bindTournamentEvents();
});

// 每次重繪後也排重算
const __renderAll = renderAll;
renderAll = function () {
  __renderAll();
  updateProgressUI();
  scheduleFitCards([0, 60], 2);
};
