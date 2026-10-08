/* LOOM studio: share link, walkthrough recorder (screen + camera + voice + transcript), feedback, collaborators,
   live sync with presence and conflict handling, and a history that says what changed. */
(() => {
'use strict';
const L = window.LoomApp, A = L.A, GN = L.GN;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const { esc } = L;
const fmtT = s => { s = Math.max(0, Math.floor(s)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
const dlg = $('#shareDlg'), body = $('#shrBody');
const TABS = [['link', 'Share link'], ['walk', 'Walkthrough'], ['feedback', 'Feedback'], ['team', 'Collaborate'], ['summary', 'Song summary']];
let tab = 'link', info = { exists: false }, pending = null, detach = false, team = null, busy = false;

/* ============================================================ dialog shell */
async function open(t = 'link') {
  tab = t; try { info = await api(`/projects/${L.project.id}/share`); } catch (e) { info = { exists: false }; }
  render(); if (!dlg.open) dlg.showModal();
}
function render() {
  $('#shrTabs').innerHTML = TABS.map(([k, n]) => `<button type="button" data-tab="${k}" class="${k === tab ? 'on' : ''}">${n}${k === 'feedback' && info.exists ? ` (${info.comments.length})` : ''}</button>`).join('');
  ({ link: viewLink, walk: viewWalk, feedback: viewFeedback, team: viewTeam, summary: viewSummary })[tab]();
}
$('#shrTabs').addEventListener('click', async e => { const b = e.target.closest('[data-tab]'); if (!b) return; tab = b.dataset.tab; if (tab === 'feedback') { try { info = await api(`/projects/${L.project.id}/share`); } catch (err) {} } render(); });
$('#shareBtn').onclick = () => open('link');
const tmpl = html => { body.innerHTML = html; };
const url = () => location.origin + info.url;

/* ============================================================ share link */
function walkStatus() {
  if (pending) return `Walkthrough ready (${fmtT(pending.duration)}${pending.transcript.length ? ', ' + pending.transcript.length + ' transcript lines' : ''}) — it is uploaded and attached when you publish.`;
  if (info.exists && info.walkthrough_asset_id && !detach) return 'A walkthrough video is attached to the link. <button type="button" id="shDetach">remove it</button>';
  return 'No walkthrough yet — record one in the Walkthrough tab (optional).';
}
function viewLink() {
  tmpl(`<p class="note">Anyone with the link can watch, listen, comment and react — <b>no account or install needed</b>. The page shows a snapshot of the song from the moment you press publish; publish again to update it (the link stays the same).</p>
  <label class="note" for="shTitleIn">title</label><input id="shTitleIn" type="text" maxlength="120" value="${esc(info.exists ? info.title : (L.project.name || 'Untitled'))}">
  <label class="chk"><input id="shComments" type="checkbox" ${!info.exists || info.allow_comments ? 'checked' : ''}> let viewers comment and react</label>
  <p class="note">${walkStatus()}</p>
  <div class="btns"><button type="button" id="shPublish" class="primary">${info.exists ? 'Update the link with the current song' : 'Publish link'}</button>${info.exists ? '<button type="button" id="shCopy">Copy link</button><button type="button" id="shOff" class="danger">Turn off link</button>' : ''}</div>
  ${info.exists ? `<input id="shUrl" readonly value="${esc(url())}"><p class="note"><a href="${esc(info.url)}" target="_blank" rel="noopener">Open the public page ↗</a> · published ${new Date(info.updated_at).toLocaleString()} · ${info.comments.length} comment${info.comments.length === 1 ? '' : 's'}</p>` : ''}`);
}
async function publish() {
  if (busy) return; busy = true; const btn = $('#shPublish'); if (btn) btn.disabled = true;
  try {
    if (L.isDirty() && !(await L.save())) { L.toast('Resolve the save conflict first, then publish.'); return; }
    let wid = info.exists ? info.walkthrough_asset_id : null, transcript = info.exists ? info.transcript || [] : [];
    if (detach) { wid = null; transcript = []; }
    if (pending) { L.toast('Uploading the walkthrough…'); wid = (await L.uploadAsset(pending.blob, 'walkthrough.webm', true)).id; transcript = pending.transcript; }
    const title = ($('#shTitleIn') && $('#shTitleIn').value.trim()) || L.project.name || 'Untitled', allow = $('#shComments') ? $('#shComments').checked : true;
    info = await api(`/projects/${L.project.id}/share`, { method: 'PUT', body: JSON.stringify({ title, allow_comments: allow, walkthrough_asset_id: wid, transcript, state: L.S }) });
    if (pending) { URL.revokeObjectURL(pending.url); pending = null; } detach = false;
    try { await navigator.clipboard.writeText(url()); L.toast('Link published and copied to the clipboard'); } catch (e) { L.toast('Link published'); }
    render();
  } catch (e) { L.toast('Could not publish: ' + e.message); } finally { busy = false; }
}
body.addEventListener('click', async e => {
  const id = e.target.id;
  if (id === 'shPublish') publish();
  else if (id === 'shCopy') { try { await navigator.clipboard.writeText(url()); L.toast('Link copied'); } catch (err) { $('#shUrl').select(); } }
  else if (id === 'shUrl') e.target.select();
  else if (id === 'shOff') { if (!confirm('Turn off the link? The public page, its comments and reactions are deleted. You can publish a new link later.')) return; await api(`/projects/${L.project.id}/share`, { method: 'DELETE' }); info = { exists: false }; render(); L.toast('Link turned off'); }
  else if (id === 'shDetach') { detach = true; render(); }
  else if (id === 'wkStart') startRecording();
  else if (id === 'wkDiscard') { URL.revokeObjectURL(pending.url); pending = null; render(); }
  else if (id === 'wkPublish') { publish(); }
  else if (id === 'tmInvite') invite();
  else if (e.target.dataset.rm) removePerson(+e.target.dataset.rm);
  else if (e.target.dataset.cdel) { await api(`/projects/${L.project.id}/share/comments/${e.target.dataset.cdel}`, { method: 'DELETE' }); info = await api(`/projects/${L.project.id}/share`); render(); }
  else if (id === 'fbRefresh') { info = await api(`/projects/${L.project.id}/share`); render(); }
  else if (id === 'smCopy') { try { await navigator.clipboard.writeText(summaryText()); L.toast('Summary copied'); } catch (err) {} }
});

/* ============================================================ walkthrough recorder */
function viewWalk() {
  const canRec = !!(navigator.mediaDevices && navigator.mediaDevices.getDisplayMedia && window.MediaRecorder), hasSR = !!(window.SpeechRecognition || window.webkitSpeechRecognition);
  tmpl(`<p class="note">Record yourself walking through the song — your screen, your voice and (optionally) a camera bubble. Viewers watch it on the share page, and can comment on any second. Up to 4 minutes.</p>
  ${canRec ? `<label class="chk"><input type="checkbox" id="wkMic" checked> narrate with my microphone</label>
  <label class="chk"><input type="checkbox" id="wkCam"> show my camera in a bubble</label>
  <label class="chk"><input type="checkbox" id="wkTab" checked> include the song's sound (choose “this tab” when your browser asks, and tick “share tab audio”)</label>
  <label class="chk"><input type="checkbox" id="wkSR" ${hasSR ? 'checked' : 'disabled'}> write a searchable transcript while I talk ${hasSR ? '<span class="note">(Chrome sends speech to Google to transcribe it)</span>' : '<span class="note">(not supported in this browser)</span>'}</label>
  <div class="btns"><button type="button" id="wkStart" class="primary">● Start recording</button></div>` : '<p class="note"><b>This browser cannot record the screen.</b> Use a recent Chrome, Edge or Brave on a computer.</p>'}
  ${pending ? `<h4>Your recording</h4><video controls src="${pending.url}"></video><p class="note">${fmtT(pending.duration)} · ${(pending.blob.size / 1048576).toFixed(1)} MB · ${pending.transcript.length} transcript lines</p>
  <div class="btns"><button type="button" id="wkPublish" class="primary">Publish &amp; copy link</button><button type="button" id="wkDiscard">Discard</button></div>` : ''}`);
}
let rec = null;
async function startRecording() {
  const opt = { mic: $('#wkMic').checked, cam: $('#wkCam').checked, tab: $('#wkTab').checked, sr: $('#wkSR') && $('#wkSR').checked };
  const md = navigator.mediaDevices, streams = [];
  try {
    const screen = await md.getDisplayMedia({ video: { frameRate: 30 }, audio: opt.tab, preferCurrentTab: true, selfBrowserSurface: 'include', systemAudio: 'include' }); streams.push(screen);
    let mic = null, cam = null;
    if (opt.mic) try { mic = await md.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } }); streams.push(mic); } catch (e) { L.toast('Microphone unavailable — recording without narration.'); }
    if (opt.cam) try { cam = await md.getUserMedia({ video: { width: 320, height: 240 } }); streams.push(cam); } catch (e) { L.toast('Camera unavailable — recording without it.'); }
    const mk = stream => { const v = document.createElement('video'); v.muted = true; v.playsInline = true; v.srcObject = stream; return v; };
    const sv = mk(screen), cv = cam ? mk(cam) : null; await sv.play(); if (cv) await cv.play();
    const st = screen.getVideoTracks()[0].getSettings(), W = Math.min(1920, st.width || 1280), H = Math.round(W * (st.height || 720) / (st.width || 1280));
    const cvs = document.createElement('canvas'); cvs.width = W; cvs.height = H; const g = cvs.getContext('2d');
    const draw = () => {
      g.drawImage(sv, 0, 0, W, H);
      if (cv) { const r = Math.round(H * .13), cx = r + 24, cy = H - r - 24; g.save(); g.beginPath(); g.arc(cx, cy, r, 0, 7); g.clip(); const s = Math.max(2 * r / cv.videoWidth, 2 * r / cv.videoHeight); g.drawImage(cv, cx - cv.videoWidth * s / 2, cy - cv.videoHeight * s / 2, cv.videoWidth * s, cv.videoHeight * s); g.restore(); g.lineWidth = 4; g.strokeStyle = '#f7f0e4'; g.beginPath(); g.arc(cx, cy, r, 0, 7); g.stroke(); }
    };
    draw(); const timer = setInterval(draw, 33);                       // an interval, not rAF, so it keeps running if the tab is hidden
    const out = cvs.captureStream(30), ac = new (window.AudioContext || window.webkitAudioContext)(), dest = ac.createMediaStreamDestination();
    if (screen.getAudioTracks().length) ac.createMediaStreamSource(new MediaStream(screen.getAudioTracks())).connect(dest);
    if (mic) ac.createMediaStreamSource(mic).connect(dest);
    dest.stream.getAudioTracks().forEach(t => out.addTrack(t));
    const mime = ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm'].find(m => MediaRecorder.isTypeSupported(m));
    const mr = new MediaRecorder(out, { mimeType: mime, videoBitsPerSecond: 1200000 }), chunks = [], segs = [], t0 = performance.now();
    mr.ondataavailable = ev => { if (ev.data.size) chunks.push(ev.data); };
    let sr = null;
    if (opt.sr) {
      const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (SR) {
        sr = new SR(); sr.continuous = true; sr.interimResults = false; sr.lang = navigator.language || 'en-US';
        sr.onresult = ev => { for (let i = ev.resultIndex; i < ev.results.length; i++) { if (!ev.results[i].isFinal) continue; const text = ev.results[i][0].transcript.trim(); if (!text) continue; const words = text.split(/\s+/).length; segs.push({ t: +Math.max(0, (performance.now() - t0) / 1000 - Math.min(8, words * .45)).toFixed(1), text: text.slice(0, 300) }); } };
        sr.onend = () => { if (rec && mr.state === 'recording') try { sr.start(); } catch (e) {} };
        try { sr.start(); } catch (e) {}
      }
    }
    rec = { mr, screen, streams, timer, ac, sr, segs, t0, chunks, clock: setInterval(() => { $('#recClock').textContent = fmtT((performance.now() - t0) / 1000); }, 500), cap: setTimeout(stopRecording, 240000) };
    screen.getVideoTracks()[0].addEventListener('ended', stopRecording);
    mr.onstop = finishRecording; mr.start(1000);
    $('#recNote').textContent = opt.mic ? 'narrating' : 'no narration'; $('#recBar').hidden = false; dlg.close(); L.toast('Recording — press ■ stop when you are done');
  } catch (e) { streams.forEach(s => s.getTracks().forEach(t => t.stop())); L.toast(e && e.name === 'NotAllowedError' ? 'Recording was cancelled.' : 'Could not start recording: ' + (e.message || e.name)); }
}
function stopRecording() { if (!rec || rec.mr.state === 'inactive') return; rec.mr.stop(); }
$('#recStop').onclick = stopRecording;
function finishRecording() {
  const r = rec; rec = null; clearInterval(r.timer); clearInterval(r.clock); clearTimeout(r.cap); if (r.sr) { r.sr.onend = null; try { r.sr.stop(); } catch (e) {} }
  r.streams.forEach(s => s.getTracks().forEach(t => t.stop())); try { r.ac.close(); } catch (e) {} $('#recBar').hidden = true; $('#recClock').textContent = '0:00';
  const blob = new Blob(r.chunks, { type: 'video/webm' });
  if (blob.size > 48 * 1048576) { L.toast('That recording is over 48 MB — record a shorter one.'); return; }
  if (!blob.size) { L.toast('Nothing was recorded.'); return; }
  pending = { blob, url: URL.createObjectURL(blob), duration: (performance.now() - r.t0) / 1000, transcript: r.segs };
  open('walk');
}
window.addEventListener('beforeunload', () => { if (rec) stopRecording(); });

/* ============================================================ feedback */
function viewFeedback() {
  if (!info.exists) { tmpl('<p class="note">Publish a link first — comments and reactions from viewers show up here.</p>'); return; }
  const rx = Object.entries(info.reactions).map(([e, n]) => `<span class="chip">${e} ${n}</span>`).join(' ') || '<span class="note">no reactions yet</span>';
  tmpl(`<p>${rx} <button type="button" id="fbRefresh">refresh</button></p>` + (info.comments.map(c => `<div class="fb"><span class="t ${c.kind}">${c.kind === 'video' ? '🎬' : '🎵'} ${fmtT(c.at)}</span><div><b>${esc(c.author)}</b><div>${esc(c.body)}</div></div><button type="button" class="x danger" data-cdel="${c.id}" title="Delete this comment">✕</button></div>`).join('') || '<p class="note">No comments yet.</p>'));
}

/* ============================================================ collaborators */
async function viewTeam() {
  if (L.project.shared) { tmpl('<p class="note">You were invited to this song. Edits you save are shared with the owner. <button type="button" data-rm="-1">leave this project</button></p>'); return; }
  try { team = await api(`/projects/${L.project.id}/collaborators`); } catch (e) { team = { collaborators: [] }; }
  tmpl(`<p class="note">Invite people who already have a LOOM account. They see this song in their project list and can edit it; <b>you</b> keep ownership (only you can delete or share it). Changes sync every few seconds, and if two people save at once nothing is overwritten — you are asked how to merge.</p>
  <div class="person"><span><b>${esc(team.owner ? team.owner.display_name : '')}</b> <span class="note">owner</span></span></div>
  ${team.collaborators.map(c => `<div class="person"><span><b>${esc(c.display_name)}</b> <span class="note">${esc(c.email || '')}</span></span><button type="button" data-rm="${c.user_id}" class="danger">remove</button></div>`).join('')}
  <label class="note" for="tmEmail" style="display:block;margin-top:12px">invite by email</label><input id="tmEmail" type="email" placeholder="friend@example.com"><div class="btns"><button type="button" id="tmInvite" class="primary">Invite</button></div><p class="note" id="tmMsg"></p>`);
}
async function invite() {
  const email = $('#tmEmail').value.trim(); if (!email) return;
  try { const r = await api(`/projects/${L.project.id}/collaborators`, { method: 'POST', body: JSON.stringify({ email }) }); L.toast(`${r.display_name} can now edit this song`); render(); }
  catch (e) { $('#tmMsg').textContent = e.message; }
}
async function removePerson(id) {
  const me = (await api('/auth/me')).user.id, target = id === -1 ? me : id;
  await api(`/projects/${L.project.id}/collaborators/${target}`, { method: 'DELETE' });
  if (id === -1) { dlg.close(); location.reload(); } else render();
}

/* ============================================================ summary (computed locally, no AI service) */
function summaryText() {
  const s = GN.summarize(L.S);
  return `${L.project.name}\n${s.key} · ${s.tempo} BPM · ${s.bars} bars (~${fmtT(s.seconds)})\n` + s.sections.map(x => `${x.name} (bar ${x.startBar}, ${x.bars} bars): ${x.chords.join(' – ') || '—'}  [${x.playing.join(', ')}]`).join('\n') + '\nSounds: ' + s.instruments.map(i => `${i.name} = ${i.instrument}`).join(', ');
}
function viewSummary() {
  const s = GN.summarize(L.S);
  tmpl(`<p class="note">Worked out from your notes — no AI service involved. The public page shows the same summary.</p>
  <h4>${esc(s.key)} · ${s.tempo} BPM · ${s.bars} bars (about ${fmtT(s.seconds)})</h4>${s.commonChords.length ? `<p>Main chords: ${s.commonChords.map(c => `<span class="chip">${esc(c)}</span>`).join(' ')}</p>` : ''}
  <table style="width:100%;border-collapse:collapse;font-size:12.5px"><thead><tr><th align="left">Section</th><th align="left">Chords</th><th align="left">Playing</th></tr></thead><tbody>${s.sections.map(x => `<tr><td style="padding:4px;border-bottom:1px solid var(--line)"><b>${esc(x.name)}</b><br><span class="note">bar ${x.startBar}, ${x.bars} bars</span></td><td style="padding:4px;border-bottom:1px solid var(--line)">${x.chords.map(c => `<span class="chip">${esc(c)}</span>`).join(' ') || '—'}</td><td style="padding:4px;border-bottom:1px solid var(--line)">${esc(x.playing.join(', ')) || '—'}</td></tr>`).join('')}</tbody></table>
  <div class="btns"><button type="button" id="smCopy">Copy as text</button></div>`);
}

/* ============================================================ live sync, presence, conflicts */
let timer = 0, lastSeenRev = 0;
async function poll() {
  clearTimeout(timer); let delay = 6000;
  try {
    if (!document.hidden && L.project && L.project.id && !rec) {
      const st = await api(`/projects/${L.project.id}/status`);
      const others = st.presence.filter(p => !p.me); $('#presence').innerHTML = others.map(p => `<span>${esc(p.name)}</span>`).join('');
      delay = st.collaborators || others.length ? 3500 : 15000;
      if (st.revision > L.project.revision && st.revision !== lastSeenRev) {
        if (!L.isDirty()) { lastSeenRev = st.revision; L.adoptRemote(await api(`/projects/${L.project.id}`)); L.toast(`${st.saved_by || 'Someone'} saved changes — your song is up to date`); }
        else showSync(st);
      } else if (st.revision <= L.project.revision) hideSync();
    }
  } catch (e) { /* offline or signed out: try again later */ }
  timer = setTimeout(poll, delay);
}
function showSync(st) {
  const bar = $('#syncBar'); if (!bar.hidden) return; bar.hidden = false;
  bar.innerHTML = `<b>${esc(st.saved_by || 'Someone')}</b> saved a newer version (revision ${st.revision}) while you have unsaved changes. <button type="button" id="syLoad">Load their version</button> <button type="button" id="syKeep">Keep mine for now</button>`;
}
function hideSync() { $('#syncBar').hidden = true; }
$('#syncBar').addEventListener('click', async e => {
  if (e.target.id === 'syLoad') { if (confirm('Load their version? Your unsaved changes will be discarded.')) { lastSeenRev = 0; L.adoptRemote(await api(`/projects/${L.project.id}`)); hideSync(); } }
  else if (e.target.id === 'syKeep') { lastSeenRev = (await api(`/projects/${L.project.id}/status`)).revision; hideSync(); }
});
L.on('conflict', d => {
  const f = $('#conflictForm');
  f.innerHTML = `<h3>Someone saved first</h3><p><b>${esc(d.saved_by || 'A collaborator')}</b> saved a newer version (revision ${d.revision}) after you opened this song. Saving now would replace their work. What would you like to do?</p>
  <div class="btns"><button type="button" id="cfTheirs">Load their version (discard my changes)</button><button type="button" id="cfCopy">Keep both — save mine as a new project</button><button type="button" id="cfMine" class="danger">Overwrite with mine</button><button value="close">Cancel</button></div>`;
  $('#conflictDlg').showModal();
});
$('#conflictForm').addEventListener('click', async e => {
  const id = e.target.id; if (!['cfTheirs', 'cfMine', 'cfCopy'].includes(id)) return; $('#conflictDlg').close();
  if (id === 'cfTheirs') { L.adoptRemote(await api(`/projects/${L.project.id}`)); L.toast('Loaded their version'); }
  else if (id === 'cfMine') { await L.save(true); }
  else { const p = await api('/projects', { method: 'POST', body: JSON.stringify({ name: (L.project.name || 'Song') + ' (my version)', bpm: L.S.tempo, state: L.S }) }); L.projects.unshift(p); L.adopt(p); L.toast('Saved as a new project — the original is untouched'); }
});

/* ============================================================ history that says what changed */
const stateCache = new Map();
const fetchState = async rev => { const k = L.project.id + ':' + rev; if (!stateCache.has(k)) stateCache.set(k, (await api(`/projects/${L.project.id}/versions/${rev}`)).state); return stateCache.get(k); };
L.on('history', async () => {
  const box = $('#historyList'), dlgH = $('#historyDlg'); box.innerHTML = '<p class="note">Loading…</p>'; dlgH.showModal();
  let list; try { list = await api(`/projects/${L.project.id}/versions`); } catch (e) { box.innerHTML = '<p>Could not load history.</p>'; return; }
  if (!list.length) { box.innerHTML = '<p>No history yet.</p>'; return; }
  box.innerHTML = list.map(v => `<div class="rev"><div><b>revision ${v.revision}</b> · ${esc(v.by || '')} · ${new Date(v.created_at).toLocaleString()}<div class="diff note" data-d="${v.revision}">${v.revision === list[list.length - 1].revision ? 'first version' : 'comparing…'}</div></div><button type="button" data-rev="${v.revision}">restore</button></div>`).join('');
  for (const v of list.slice(0, 12)) {
    if (!dlgH.open) return; const el = box.querySelector(`[data-d="${v.revision}"]`), prev = list.find(x => x.revision < v.revision); if (!prev || !el) continue;
    try { const [a, b] = await Promise.all([fetchState(prev.revision), fetchState(v.revision)]); const d = GN.diffStates(L.normalize(a), L.normalize(b)); el.textContent = d.lines.length ? d.lines.slice(0, 6).join(' · ') + (d.lines.length > 6 ? ' …' : '') : 'no audible change'; } catch (e) { el.textContent = ''; }
  }
});

L.on('refresh', reason => { if (reason === 'boot') poll(); });
})();
