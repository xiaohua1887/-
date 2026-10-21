(function () {
  'use strict';
  const DATA = window.QUESTIONNAIRE_DATA;
  const C = window.QuestionnaireCore;
  const app = document.getElementById('app');
  const storageKey = 'ui-perception:' + location.pathname.replace(/index\.html$/, '') + ':v1';
  const pauseDialog = document.getElementById('pause-dialog');
  const zoomDialog = document.getElementById('zoom-dialog');
  let state = null;
  let plan = null;
  let ready = false;
  let renderId = 0;
  let lastTick = performance.now();
  let lastSave = 0;
  let storageWorking = true;
  let toastTimeout = 0;
  let sessionLocked = false;
  const tabId = crypto.randomUUID ? crypto.randomUUID() : Date.now() + '-' + Math.random();
  let channel = null;
  let otherTabActive = false;

  function escapeHtml(value) {
    return String(value ?? '').replace(/[&<>"']/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'}[ch]));
  }
  function randomNumber(max) {
    const array = new Uint32Array(1);
    crypto.getRandomValues(array);
    return array[0] % max;
  }
  function toast(message) {
    const el = document.getElementById('toast');
    el.textContent = message;
    el.hidden = false;
    clearTimeout(toastTimeout);
    toastTimeout = setTimeout(() => {el.hidden = true;}, 4500);
  }
  function warnStorage() {
    storageWorking = false;
    if (document.getElementById('storage-warning')) return;
    const el = document.createElement('div');
    el.id = 'storage-warning';
    el.className = 'notice notice-warning storage-warning';
    el.textContent = '浏览器无法保存进度。请保持此页面打开，并在完成后下载结果。';
    document.querySelector('.site-header').after(el);
  }
  function persist() {
    if (!state || sessionLocked) return;
    try {localStorage.setItem(storageKey, JSON.stringify(state));} catch {warnStorage();}
  }
  function readSaved() {
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return null;
      const saved = JSON.parse(raw);
      if (saved.dataset_hash !== DATA.dataset_hash || !Array.isArray(saved.answers) || !Array.isArray(saved.events)) return null;
      const p = C.makePlan(DATA, saved.form_number, saved.orientation);
      if (!['intro', 'trial', 'break', 'done'].includes(saved.stage) || saved.answers.length > 96 || saved.index !== saved.answers.length) return null;
      if (saved.answers.some((row, i) => row.pair_id !== p.trials[i].pair_id || !C.SCALE.some(s => s.score === row.response_score_left))) return null;
      if (saved.stage === 'done' && saved.answers.length !== 96) return null;
      return saved;
    } catch {warnStorage(); return null;}
  }
  function wallTime() {
    if (!state?.started_at) return 0;
    return Math.max(0, (state.finished_at ? Date.parse(state.finished_at) : Date.now()) - Date.parse(state.started_at));
  }
  function running() {return !!state && state.stage === 'trial' && ready && !state.paused && !document.hidden && !sessionLocked;}
  function tick() {
    const now = performance.now();
    const delta = Math.max(0, now - lastTick);
    lastTick = now;
    if (running()) {
      state.current_active_ms += delta;
      state.active_total_ms += delta;
    }
    document.getElementById('wall-clock').textContent = C.formatTime(wallTime());
    document.getElementById('active-clock').textContent = C.formatTime(state?.active_total_ms || 0);
    if (state && now - lastSave > 1000) {persist(); lastSave = now;}
  }
  function logEvent(type, extra = {}) {
    if (state) state.events.push({type, at: new Date().toISOString(), trial_index: state.index + 1, ...extra});
  }
  function updateTools() {
    document.getElementById('session-tools').hidden = !state?.started_at || state.stage === 'done';
    document.getElementById('pause-button').disabled = !state || state.stage !== 'trial' || sessionLocked;
    tick();
  }
  function render() {
    renderId++;
    ready = false;
    document.body.dataset.screen = state?.stage || 'setup';
    updateTools();
    if (!state) return showSetup();
    if (sessionLocked) {
      app.innerHTML = '<section class="center-card"><h2>此问卷已在另一个标签页中打开。</h2><p>请回到原标签页继续作答，避免重复记录。</p><p class="muted">关闭其他标签页后，可刷新此页面恢复已保存的进度。</p></section>';
      return;
    }
    if (state.stage === 'intro') showIntro();
    else if (state.stage === 'trial') showTrial();
    else if (state.stage === 'break') showBreak();
    else showDone();
    if (state.paused && state.stage === 'trial' && !pauseDialog.open) pauseDialog.showModal();
  }
  function showSetup() {
    const params = new URLSearchParams(location.search);
    const requestedForm = Number(params.get('form'));
    const formValid = Number.isInteger(requestedForm) && requestedForm >= 1 && requestedForm <= 50;
    const direction = params.get('orientation')?.toUpperCase();
    const saved = readSaved();
    let mismatch = false;
    if (saved) mismatch = (formValid && saved.form_number !== requestedForm) || (['A','B'].includes(direction) && direction !== saved.orientation);
    const resume = saved ? `<section class="resume-card"><h3>${saved.stage === 'done' ? '已有一份已完成的结果' : '发现未完成的问卷'}</h3><p class="rating-hint">问卷${String(saved.form_number).padStart(2,'0')} · 已完成 ${saved.answers.length} / 96 题 · 参与者 ${escapeHtml(saved.participant_id)}${mismatch ? '<br>当前链接的问卷或方向与已存进度不同，请确认后选择。' : ''}</p><div class="actions"><button class="button button-primary" id="restore-session" type="button">${saved.stage === 'done' ? '查看并下载结果' : '继续已存问卷'}</button><button class="button button-quiet" id="discard-session" type="button">清除本机进度，重新开始</button></div></section>` : '';
    app.innerHTML = `${resume}<div class="hero"><section class="hero-copy"><span class="eyebrow">COMPARE WHAT YOU PERCEIVE</span><h1>两张界面，<br>哪一张感知更强？</h1><p>根据界面的视觉印象，比较一致性、活力感、趣味性、智能感、新潮感和高级感。判断的是感知强弱，无需表达喜欢与否。</p><div class="stat-row"><div class="stat"><strong>6</strong><span>评价维度</span></div><div class="stat"><strong>16</strong><span>每维题数</span></div><div class="stat"><strong>96</strong><span>正式比较</span></div></div><div class="guide"><strong>作答方式</strong><p>每题只判断当前的一个维度，从“左图远强”到“右图远强”选择最符合感受的一项。两图强度相近时，选择中间项。每完成一个维度可休息，也可以随时暂停。</p></div></section><form id="setup-form" class="setup-card"><h2>开始前，确认一下</h2><p>本次为网页试测。答案保存在当前浏览器，完成后请下载结果并发给研究者。</p><label class="field"><span>问卷编号</span><select id="form-number" name="form"><option value="random">未指定，随机选择一套</option>${DATA.forms.map(f => `<option value="${f.number}" ${formValid && f.number === requestedForm ? 'selected' : ''}>问卷 ${String(f.number).padStart(2,'0')}</option>`).join('')}</select><small>如果研究者提供了编号，请按指定编号作答。</small></label><label class="field"><span>参与者编号</span><input id="participant-id" name="participant" maxlength="60" placeholder="可留空，自动生成" autocomplete="off"><small>填写研究者提供的编号，或使用系统生成的匿名编号。</small></label><label class="field"><span>国家 / 地区</span><input id="country" name="country" required maxlength="80" placeholder="例如：中国 / South Africa" value="${escapeHtml((params.get('country') || '').slice(0,80))}" autocomplete="off"></label><label class="consent"><input type="checkbox" id="consent" required><span>我已了解作答方式，同意自愿参与，并会在结束后下载结果。</span></label><p id="setup-error" class="error" role="alert"></p><button class="button button-primary full-width" type="submit" ${saved ? 'disabled' : ''}>进入问卷 <span aria-hidden="true">→</span></button><p class="rating-hint" style="margin:14px 0 0">计时从第一组正式比较开始。无需赶时间。</p></form></div>`;
    if (saved) {
      document.getElementById('restore-session').onclick = async () => {
        state = saved;
        plan = C.makePlan(DATA, state.form_number, state.orientation);
        await claimSession();
        if (sessionLocked) return render();
        logEvent('restored');
        persist(); render();
      };
      document.getElementById('discard-session').onclick = () => {
        if (!confirm('清除后将无法恢复本机已存进度。若已完成，请先下载结果。确定清除？')) return;
        try {localStorage.removeItem(storageKey);} catch {warnStorage();}
        render();
      };
    }
    document.getElementById('setup-form').onsubmit = async event => {
      event.preventDefault();
      if (saved) return;
      const numberValue = document.getElementById('form-number').value;
      const formNumber = numberValue === 'random' ? randomNumber(50) + 1 : Number(numberValue);
      const orientation = ['A','B'].includes(direction) ? direction : (randomNumber(2) ? 'B' : 'A');
      const sessionId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + randomNumber(1000000000).toString(36);
      const participant = document.getElementById('participant-id').value.trim() || 'P-' + sessionId.slice(0,8);
      const country = document.getElementById('country').value.trim();
      if (!country) {document.getElementById('setup-error').textContent = '请填写国家或地区。'; return;}
      plan = C.makePlan(DATA, formNumber, orientation);
      state = {study_version: DATA.version, dataset_hash: DATA.dataset_hash, session_id: sessionId,
        participant_id: participant, country, form_number: formNumber, orientation,
        order_index: plan.orderIndex, dimension_order: plan.order, stage: 'intro', index: 0,
        answers: [], events: [], created_at: new Date().toISOString(), started_at: null, finished_at: null,
        active_total_ms: 0, current_active_ms: 0, current_shown_at: null, current_hidden_count: 0,
        current_pause_count: 0, selected: null, paused: false};
      await claimSession();
      logEvent('created'); persist(); render();
    };
  }
  function dimensionAt(index) {
    return DATA.dimensions.find(d => d.code === plan.trials[index].dimension_code);
  }
  function showIntro() {
    const dimension = dimensionAt(0);
    app.innerHTML = `<section class="center-card"><span class="eyebrow">READY WHEN YOU ARE</span><h1>先认识当前的评价标准。</h1><p class="muted">问卷 ${String(state.form_number).padStart(2,'0')} · 共六个维度，每维16题。每题只比较当前维度的强弱。</p><div class="dimension-list">${plan.order.map(code => `<span>${DATA.dimensions.find(d=>d.code===code).name}</span>`).join('')}</div><h2>第一个维度：${dimension.name}</h2><p class="definition-large">${dimension.definition}</p><p class="rating-hint">五级选项依次为：左图远强、左图更强、两图相近、右图更强、右图远强。请选择后，再点击“下一题”。</p><button id="start-trials" class="button button-primary" type="button">开始本维度 →</button></section>`;
    document.getElementById('start-trials').onclick = () => {
      state.started_at = new Date().toISOString(); state.stage = 'trial';
      logEvent('started'); persist(); render();
    };
  }
  function showTrial() {
    const trial = plan.trials[state.index];
    const dimension = dimensionAt(state.index);
    const token = renderId;
    app.innerHTML = `<div class="progress-meta"><span>问卷 ${String(state.form_number).padStart(2,'0')} · 第 ${trial.dimension_position} / 6 个维度</span><span>已完成 ${state.answers.length} / 96 题</span></div><div class="progress-track" role="progressbar" aria-label="问卷进度" aria-valuenow="${state.answers.length}" aria-valuemin="0" aria-valuemax="96"><div class="progress-fill" style="width:${state.answers.length/96*100}%"></div></div><div class="dimension-tabs">${plan.order.map((code,i)=>`<span class="dimension-tab ${i+1===trial.dimension_position ? 'current' : i+1<trial.dimension_position ? 'done' : ''}">${i+1<trial.dimension_position ? '✓ ' : ''}${DATA.dimensions.find(d=>d.code===code).name}</span>`).join('')}</div><section aria-labelledby="trial-question"><div class="trial-heading"><div><h1 id="trial-question">哪张界面的${dimension.name}更强？</h1><p class="definition">${dimension.definition}</p></div><span class="trial-number">本维度 ${trial.dimension_trial_index} / 16</span></div><div class="image-grid">${[['left',trial.left_ui,'左图'],['right',trial.right_ui,'右图']].map(([side,ui,label])=>`<figure class="image-card"><figcaption><strong>${label} <span class="muted">· ${ui}</span></strong><span class="image-caption-hint">点击查看大图</span></figcaption><div class="image-stage"><img class="stimulus" id="${side}-image" alt="${label} ${ui}" tabindex="0" role="button" aria-label="放大${label} ${ui}"></div></figure>`).join('')}</div><div id="loading-status" class="loading-status" role="status">正在加载两张界面图…</div><div class="response-panel"><p class="response-prompt">仅比较「${dimension.name}」的感知强度</p><div class="choices" role="group" aria-label="五级比较">${C.SCALE.map((s,i)=>`<button class="choice" data-score="${s.score}" type="button" aria-pressed="${state.selected === s.score}" disabled aria-label="${s.label}">${s.short}<small>${i+1} · ${s.hint}</small></button>`).join('')}</div><div class="trial-actions"><p>快捷键 1—5 选择，Enter 确认。<br><span id="save-status" class="save-status">${storageWorking ? '进度自动保存在当前浏览器' : '本机保存不可用，请保持页面打开'}</span></p><button class="button button-primary" id="next-trial" type="button" disabled>${state.index === 95 ? '完成问卷' : trial.dimension_trial_index === 16 ? '完成本维度 →' : '下一题 →'}</button></div></div></section>`;
    const images = [document.getElementById('left-image'), document.getElementById('right-image')];
    let loaded = 0;
    let failed = false;
    function imageReady() {
      if (token !== renderId || failed) return;
      loaded++;
      if (loaded !== 2) return;
      lastTick = performance.now();
      ready = true;
      if (!state.current_shown_at) state.current_shown_at = new Date().toISOString();
      document.getElementById('loading-status').textContent = '两图已加载 · 点击图片可放大';
      document.querySelectorAll('.choice').forEach(b=>{b.disabled=false;});
      document.getElementById('next-trial').disabled = state.selected === null;
      persist();
      const next = plan.trials[state.index+1];
      if (next) for (const ui of [next.left_ui,next.right_ui]) {const image = new Image(); image.src = DATA.images[ui];}
    }
    function imageFailed() {
      if (token !== renderId) return;
      failed = true; ready = false;
      document.getElementById('loading-status').innerHTML = '图片加载失败，请检查网络。 <button id="retry-images" class="button-link" type="button">重新加载</button>';
      document.querySelectorAll('.choice').forEach(b=>{b.disabled=true;});
      document.getElementById('next-trial').disabled = true;
      document.getElementById('retry-images').onclick = () => {tick(); render();};
    }
    images.forEach((image,i) => {
      image.onload = imageReady; image.onerror = imageFailed;
      image.src = DATA.images[i === 0 ? trial.left_ui : trial.right_ui];
      const zoom = () => {if (!ready) return; document.getElementById('zoom-image').src = image.src; zoomDialog.showModal();};
      image.onclick = zoom;
      image.onkeydown = event => {if (event.key === 'Enter' || event.key === ' ') {event.preventDefault(); event.stopPropagation(); zoom();}};
    });
    document.querySelectorAll('.choice').forEach(button => {button.onclick = () => selectScore(Number(button.dataset.score));});
    document.getElementById('next-trial').onclick = nextTrial;
  }
  function selectScore(score) {
    if (!running()) return;
    tick(); state.selected = score;
    document.querySelectorAll('.choice').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.score) === score)));
    document.getElementById('next-trial').disabled = false;
    persist();
  }
  function nextTrial() {
    if (!running() || state.selected === null) return;
    tick(); ready = false;
    const trial = plan.trials[state.index];
    const now = new Date().toISOString();
    const row = {
      study_version: DATA.version, dataset_hash: DATA.dataset_hash, session_id: state.session_id,
      participant_id: state.participant_id, country: state.country,
      questionnaire_id: 'F' + String(state.form_number).padStart(2,'0'), orientation: state.orientation,
      dimension_order: state.dimension_order.join('>'), ...trial,
      ...C.responseFields(trial,state.selected), active_time_ms: Math.round(state.current_active_ms),
      elapsed_since_start_ms: Math.round(wallTime()), trial_started_at: state.current_shown_at,
      answered_at: now, visibility_interruptions: state.current_hidden_count,
      manual_pause_count: state.current_pause_count
    };
    state.answers.push(row); state.index++;
    state.selected = null; state.current_active_ms = 0; state.current_shown_at = null;
    state.current_hidden_count = 0; state.current_pause_count = 0;
    if (state.index === 96) {state.stage = 'done'; state.finished_at = now; logEvent('finished');}
    else if (state.index % 16 === 0) {state.stage = 'break'; logEvent('dimension_completed', {dimension: trial.dimension_code});}
    persist(); render();
    app.focus({preventScroll:true});
    window.scrollTo({top:0,behavior:'instant'});
  }
  function showBreak() {
    const next = dimensionAt(state.index);
    const completed = state.index / 16;
    app.innerHTML = `<section class="center-card"><span class="eyebrow">A MOMENT TO RESET</span><h1>已完成 ${completed} 个维度。</h1><p class="muted">${completed === 3 ? '问卷已过半，建议休息约1分钟。' : '可以休息20—30秒，再切换到下一个评价标准。'}休息时间不计入有效作答。</p><div class="break-stats"><div><span>已完成</span><strong>${state.index} / 96</strong></div><div><span>总用时</span><strong>${C.formatTime(wallTime())}</strong></div><div><span>有效作答</span><strong>${C.formatTime(state.active_total_ms)}</strong></div></div><h2>下一个维度：${next.name}</h2><p class="definition-large">${next.definition}</p><button class="button button-primary" id="continue-block" type="button">准备好了，继续 →</button><p class="rating-hint" style="margin-top:18px">开始下一组后，请只依据「${next.name}」进行判断。</p></section>`;
    document.getElementById('continue-block').onclick = () => {state.stage = 'trial'; logEvent('break_ended'); persist(); render();};
  }
  function metadata() {
    const dimensionSummary = state.dimension_order.map(code => ({
      code, dimension: DATA.dimensions.find(d=>d.code===code).name,
      trials: state.answers.filter(a=>a.dimension_code===code).length,
      active_time_ms: state.answers.filter(a=>a.dimension_code===code).reduce((sum,a)=>sum+a.active_time_ms,0)
    }));
    return {study_version: DATA.version, dataset_hash: DATA.dataset_hash, session_id: state.session_id,
      participant_id: state.participant_id, country: state.country, questionnaire_id: 'F' + String(state.form_number).padStart(2,'0'),
      orientation: state.orientation, order_index: state.order_index, dimension_order: state.dimension_order,
      created_at: state.created_at, started_at: state.started_at, finished_at: state.finished_at,
      exported_at: new Date().toISOString(), completed: state.stage === 'done', total_responses: state.answers.length,
      total_elapsed_ms: wallTime(), active_response_ms: Math.round(state.active_total_ms),
      time_zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      timing_note: '总用时包括休息、加载和离开页面；有效作答时间仅累计两图加载完成后、页面可见且未暂停的答题时间。刷新前最后约1秒可能未保存；不等同于眼动或注意力测量。',
      scale_note: '五级分值为有序类别，正值表示左图更强，不应直接解释为等距测量。',
      scale: C.SCALE.map(s=>({score_left:s.score,label:s.label})), dimensions: dimensionSummary};
  }
  function download(format) {
    const base = 'UI感知_' + state.form_number.toString().padStart(2,'0') + '_' + state.participant_id.replace(/[^a-zA-Z0-9_\u3400-\u9fff-]/g,'_').slice(0,40) + '_' + state.session_id.slice(0,8);
    const completed = state.stage === 'done';
    const elapsed = wallTime();
    const exportRows = state.answers.map(row => ({
      '问卷是否完成': completed ? '是' : '否',
      '完成用时（分秒）': completed ? C.formatTime(elapsed) : '',
      '完成用时（秒）': completed ? Math.round(elapsed) / 1000 : '',
      '完成时刻（本地）': state.finished_at ? new Date(state.finished_at).toLocaleString('zh-CN', {hour12:false}) : '',
      '完成时刻（UTC）': state.finished_at || '',
      '当前已用时（秒）': Math.round(elapsed) / 1000,
      '有效作答用时（秒）': Math.round(state.active_total_ms) / 1000,
      '本题用时（秒）': row.active_time_ms / 1000,
      ...row
    }));
    const text = format === 'csv' ? C.toCsv(exportRows) : JSON.stringify({metadata:metadata(), responses:state.answers, events:state.events}, null, 2);
    const blob = new Blob([text], {type:format === 'csv' ? 'text/csv;charset=utf-8' : 'application/json;charset=utf-8'});
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a'); link.href=url; link.download=base+'.'+format;
    document.body.append(link); link.click(); link.remove(); setTimeout(()=>URL.revokeObjectURL(url),10000);
    toast('已发起下载，请确认文件已保存；在手机浏览器中也可通过下载列表查看。');
  }
  function showDone() {
    app.innerHTML = `<section class="center-card"><div class="completion-icon" aria-hidden="true">✓</div><span class="eyebrow">ALL COMPARISONS COMPLETE</span><h1>感谢，你已完成全部评价。</h1><p class="muted">问卷 ${String(state.form_number).padStart(2,'0')} · 参与者 ${escapeHtml(state.participant_id)} · ${escapeHtml(state.country)}</p><div class="result-stats"><div><span>完成题数</span><strong>96 / 96</strong></div><div><span>总用时</span><strong>${C.formatTime(wallTime())}</strong></div><div><span>有效作答</span><strong>${C.formatTime(state.active_total_ms)}</strong></div></div><p>请下载结果文件，并发送给研究者。</p><div class="actions"><button class="button button-primary" id="download-csv" type="button">下载 CSV 结果</button><button class="button" id="download-json" type="button">下载 JSON 完整记录</button></div><p class="download-note">CSV包含逐题答案和耗时，可用于整理数据；JSON另含总体计时、维度汇总和暂停记录。结果未自动上传，请确认文件已保存。</p><button id="new-session" class="button-link" type="button">下载后，开始另一份试测</button></section>`;
    document.getElementById('download-csv').onclick = () => download('csv');
    document.getElementById('download-json').onclick = () => download('json');
    document.getElementById('new-session').onclick = () => {
      if (!confirm('请确认已下载结果。开始另一份试测会清除当前浏览器中的这份记录。继续？')) return;
      try {localStorage.removeItem(storageKey);} catch {warnStorage();}
      if (channel) channel.postMessage({type:'released',tabId,sessionId:state.session_id});
      state=null; plan=null; render();
    };
  }
  async function claimSession() {
    // Avoid concurrent completion of the same local session in two tabs.
    otherTabActive = false;
    if (!channel || !state) return;
    channel.postMessage({type:'claim',tabId,sessionId:state.session_id});
    await new Promise(resolve=>setTimeout(resolve,160));
    if (otherTabActive) sessionLocked=true;
  }
  if ('BroadcastChannel' in window) {
    channel = new BroadcastChannel(storageKey);
    channel.onmessage = ({data}) => {
      if (!state || data.tabId === tabId || data.sessionId !== state.session_id) return;
      if (data.type === 'claim' && !sessionLocked) channel.postMessage({type:'occupied',tabId,sessionId:state.session_id,target:data.tabId});
      else if (data.type === 'occupied' && data.target === tabId) otherTabActive=true;
    };
  }
  document.getElementById('pause-button').onclick = () => {
    if (!state || state.stage !== 'trial' || state.paused || sessionLocked) return;
    tick(); state.paused = true; state.current_pause_count++;
    logEvent('paused'); persist(); pauseDialog.showModal();
  };
  function resume() {
    if (!state || sessionLocked) return;
    tick(); state.paused = false; lastTick = performance.now();
    logEvent('resumed'); persist(); pauseDialog.close();
  }
  document.getElementById('resume-button').onclick = resume;
  pauseDialog.addEventListener('cancel',event=>{event.preventDefault(); resume();});
  document.getElementById('close-zoom').onclick = ()=>zoomDialog.close();
  document.addEventListener('keydown',event=>{
    if (event.repeat || !running() || pauseDialog.open || zoomDialog.open || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (/^[1-5]$/.test(event.key)) {event.preventDefault(); selectScore(C.SCALE[Number(event.key)-1].score);}
    else if (event.key === 'Enter') {event.preventDefault(); nextTrial();}
  });
  document.addEventListener('visibilitychange',()=>{
    // Account for the interval ending at the visibility transition using the previous state.
    const now = performance.now();
    if (document.hidden && state?.stage === 'trial' && ready && !state.paused && !sessionLocked) {
      const delta = Math.max(0,now-lastTick); state.current_active_ms+=delta; state.active_total_ms+=delta;
      state.current_hidden_count++; logEvent('page_hidden');
    } else if (!document.hidden && state) logEvent('page_visible');
    lastTick=now; persist();
  });
  window.addEventListener('pagehide',()=>{tick(); persist();});
  window.addEventListener('beforeunload',event=>{
    tick(); persist();
    if (state && state.stage !== 'done' && !sessionLocked) {event.preventDefault(); event.returnValue='';}
  });
  document.querySelector('.brand').onclick = event=>{
    if (state) {event.preventDefault(); toast('当前问卷进行中；请完成后下载结果，或在刷新后的首页管理进度。');}
  };
  if (!DATA || !C) {
    app.innerHTML='<section class="center-card"><h2>问卷文件未完整加载</h2><p>请确认 data.js、core.js 和 app.js 与网页一起上传，然后刷新重试。</p></section>';
    return;
  }
  render();
  setInterval(tick,250);
})();
