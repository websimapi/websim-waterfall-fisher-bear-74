
```javascript
const LS_KEY = 'sb_leaderboard_v1';
let room = null;
let currentUser = null;
let myRecord = null;

// paging state
const PAGE_SIZE = 6;
let localPage = 0;
let globalPage = 0;

function getLocalScores() {
  try { return JSON.parse(localStorage.getItem(LS_KEY)) || []; } catch { return []; }
}

function saveLocalScores(arr) { localStorage.setItem(LS_KEY, JSON.stringify(arr)); }

export function addLocalScore(score, clipUrl = null) {
  const arr = getLocalScores();
  arr.push({ score, at: Date.now(), clipUrl });
  arr.sort((a,b)=>b.score-a.score);
  saveLocalScores(arr.slice(0, 50));
  renderLocal();
}

function renderLocal() {
  const list = document.getElementById('local-scores'); if (!list) return;
  const all = getLocalScores();
  const pages = Math.max(1, Math.ceil(all.length / PAGE_SIZE));
  localPage = Math.min(localPage, pages - 1);
  const arr = all.slice(localPage * PAGE_SIZE, localPage * PAGE_SIZE + PAGE_SIZE);
  list.innerHTML = '';
  arr.forEach((e)=>{
    const li = document.createElement('li');
    const d = new Date(e.at);
    li.textContent = `${e.score} — ${d.toLocaleDateString()} ${d.toLocaleTimeString()} `;
    if (e.clipUrl) { 
      const a = document.createElement('a');
      a.className = 'lb-replay'; a.href = e.clipUrl; a.target = '_blank'; a.setAttribute('aria-label','Watch replay');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
      li.appendChild(a); 
    }
    list.appendChild(li);
  });
  updatePageIndicator();
}

function renderGlobalFromRecords(records) {
  const list = document.getElementById('global-scores'); if (!list) return;
  const items = [];
  for (const r of records) {
    try {
      const data = JSON.parse(r.data || '{}');
      if (typeof data.highScore === 'number') {
        items.push({ user: r.username, score: data.highScore, clip: data.lastReplayUrl || null });
      }
    } catch {}
  }
  items.sort((a,b)=>b.score-a.score);
  // paging for global list
  const pages = Math.max(1, Math.ceil(items.length / PAGE_SIZE));
  globalPage = Math.min(globalPage, pages - 1);
  list.innerHTML = '';
  items.slice(globalPage * PAGE_SIZE, globalPage * PAGE_SIZE + PAGE_SIZE).forEach((e)=>{
    const li = document.createElement('li');
    li.textContent = ''; // clear to build rich row
    const img = document.createElement('img'); img.className='lb-avatar'; img.alt=`${e.user} avatar`; img.src=`https://images.websim.com/avatar/${e.user}`;
    const name = document.createElement('span'); name.textContent = `${e.user}: ${e.score} `;
    li.appendChild(img); li.appendChild(name);
    if (e.clip) { 
      const a = document.createElement('a');
      a.className = 'lb-replay'; a.href = e.clip; a.target = '_blank'; a.setAttribute('aria-label','Watch replay');
      a.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
      li.appendChild(a); 
    }
    list.appendChild(li);
  });
  updatePageIndicator();
}

async function ensureRoom() {
  if (!room) room = new WebsimSocket();
  if (!currentUser) currentUser = await window.websim.getCurrentUser();
}

async function ensureMyRecord() {
  await ensureRoom();
  const coll = room.collection('player_v1');
  // try a few times to avoid creating during initial empty getList
  for (let attempt = 0; attempt < 3 && !myRecord; attempt++) {
    const byId = coll.filter({ user_id: currentUser.id }).getList();
    if (byId.length) { myRecord = byId[0]; break; }
    const byName = coll.filter({ username: currentUser.username }).getList();
    if (byName.length) {
      byName.sort((a,b)=> new Date(b.created_at) - new Date(a.created_at));
      myRecord = byName[0];
      try { await coll.update(myRecord.id, { user_id: currentUser.id }); } catch {}
      break;
    }
    await new Promise(r=>setTimeout(r, 250));
  }
  if (!myRecord) {
    myRecord = await coll.create({ user_id: currentUser.id, data: JSON.stringify({ highScore: 0, recent: [] }) });
  }
}

export async function submitScoreToDB(score, replayUrl) {
  try {
    await ensureMyRecord();
    if (window.__replayUploadPromise) { try { await window.__replayUploadPromise; } catch {} }
    const coll = room.collection('player_v1');
    let data = {};
    try { data = JSON.parse(myRecord.data || '{}'); } catch { data = {}; }
    const recent = Array.isArray(data.recent) ? data.recent : [];
    const clip = replayUrl || window.__lastReplayUrl || null;
    recent.unshift({ score, at: Date.now(), clipUrl: clip });
    const highScore = Math.max(Number(data.highScore||0), score);
    const newData = { highScore, recent: recent.slice(0, 50), lastReplayUrl: clip };
    await coll.update(myRecord.id, { data: JSON.stringify(newData) });
    // refresh myRecord
    const updated = coll.filter({ username: currentUser.username }).getList();
    myRecord = updated[0] || myRecord;
  } catch (e) {
    console.warn('Submit failed:', e);
  }
}

async function subscribeGlobal() {
  await ensureRoom();
  const coll = room.collection('player_v1');
  coll.subscribe(renderGlobalFromRecords);
  renderGlobalFromRecords(coll.getList());
}

function bindModal() {
  const btn = document.getElementById('leaderboard-button');
  const modal = document.getElementById('leaderboard-modal');
  const close = document.getElementById('lb-close');
  if (btn && modal && close) {
    btn.addEventListener('click', ()=>{ renderLocal(); setActiveTab('local'); modal.classList.remove('hidden'); });
    close.addEventListener('click', ()=> { 
      modal.classList.add('hidden'); 
      window.dispatchEvent(new CustomEvent('leaderboard:closed'));
    });
  }
  // pager controls
  document.getElementById('lb-prev')?.addEventListener('click', ()=>{
    const localActive = document.getElementById('lb-tab-local')?.classList.contains('is-active');
    if (localActive) { localPage = Math.max(0, localPage - 1); renderLocal(); }
    else { globalPage = Math.max(0, globalPage - 1); subscribeGlobal(); } // refresh
  });
  document.getElementById('lb-next')?.addEventListener('click', ()=>{
    const localActive = document.getElementById('lb-tab-local')?.classList.contains('is-active');
    if (localActive) { localPage = localPage + 1; renderLocal(); }
    else { globalPage = globalPage + 1; subscribeGlobal(); }
  });
}

function setActiveTab(which='local') {
  const localBtn = document.getElementById('lb-tab-local');
  const globalBtn = document.getElementById('lb-tab-global');
  const localList = document.getElementById('local-scores');
  const globalList = document.getElementById('global-scores');
  if (!localBtn || !globalBtn || !localList || !globalList) return;
  localBtn.classList.toggle('is-active', which==='local');
  globalBtn.classList.toggle('is-active', which==='global');
  localList.classList.toggle('hidden', which!=='local');
  globalList.classList.toggle('hidden', which!=='global');
}

function bindSubmit() {
  const submit = document.getElementById('submit-score-btn');
  submit?.addEventListener('click', async ()=>{
    submit.disabled = true;
    document.getElementById('skip-submit-btn')?.setAttribute('disabled','true');
    document.getElementById('submit-loading')?.classList.remove('hidden');
    const scoreText = document.getElementById('final-score')?.textContent || '0';
    const score = parseInt(scoreText, 10) || 0;
    await submitScoreToDB(score);
    document.getElementById('submit-loading')?.classList.add('hidden');
    document.getElementById('skip-submit-btn')?.removeAttribute('disabled');
    // open modal to show updated global
    document.getElementById('leaderboard-modal')?.classList.remove('hidden');
  });
}

function bindTabs() {
  document.getElementById('lb-tab-local')?.addEventListener('click', ()=>{ renderLocal(); setActiveTab('local'); });
  document.getElementById('lb-tab-global')?.addEventListener('click', async ()=>{ await subscribeGlobal(); setActiveTab('global'); });
}

function updatePageIndicator() {
  const indicator = document.getElementById('lb-page-indicator');
  if (!indicator) return;
  const localActive = document.getElementById('lb-tab-local')?.classList.contains('is-active');
  if (localActive) {
    const total = Math.max(1, Math.ceil(getLocalScores().length / PAGE_SIZE));
    indicator.textContent = `${localPage + 1} / ${total}`;
  } else {
    // approximate total for global: use currently rendered list length from DOM
    const all = document.getElementById('global-scores')?.children.length || 0;
    // when global is active, we don't always know total records; show current page / ? as fallback
    const total = '?';
    indicator.textContent = `${globalPage + 1} / ${total}`;
  }
}

window.addEventListener('DOMContentLoaded', () => {
  bindModal();
  bindSubmit();
  bindTabs();
  renderLocal();
  subscribeGlobal();
});