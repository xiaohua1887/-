(function () {
  'use strict';
  const DATA = window.QUESTIONNAIRE_DATA;
  const C = window.QuestionnaireCore;
  const app = document.getElementById('app');
  const storageKey = 'ui-perception:' + location.pathname.replace(/index\.html$/, '') + ':v2';
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

  function askConfirmation(message) {
    return new Promise(resolve=>{
      const dialog=document.getElementById('confirm-dialog');
      document.getElementById('confirm-message').textContent=message;
      let settled=false;
      const done=value=>{if(settled)return;settled=true;dialog.close();resolve(value);};
      document.getElementById('confirm-ok').onclick=()=>done(true);
      document.getElementById('confirm-cancel').onclick=()=>done(false);
      dialog.oncancel=event=>{event.preventDefault();done(false);};
      dialog.showModal();
    });
  }
  document.getElementById('partial-download').onclick=()=>{
    if(!state?.answers.length){toast('请先回答至少一道题，再下载已答结果。');return;}
    tick();download('csv');
  };
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
      if (!['tutorial', 'practice', 'check', 'intro', 'trial', 'break', 'microbreak', 'done'].includes(saved.stage) || saved.answers.length > 96 || saved.index !== saved.answers.length) return null;
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
    if (state.stage === 'tutorial') showTutorial();
    else if (state.stage === 'practice') showPractice();
    else if (state.stage === 'check') showCheck();
    else if (state.stage === 'intro') showIntro();
    else if (state.stage === 'trial') showTrial();
    else if ((state.stage === 'break' || state.stage === 'microbreak')) showBreak();
    else showDone();
    if (state.paused && state.stage === 'trial' && !pauseDialog.open) pauseDialog.showModal();
  }
  function showSetup() {
    const params = new URLSearchParams(location.search);
    const requestedForm = Number(params.get('form'));
    const formValid = Number.isInteger(requestedForm) && requestedForm >= 1 && requestedForm <= DATA.forms.length;
    const direction = params.get('orientation')?.toUpperCase();
    const saved = readSaved();
    let mismatch = false;
    if (saved) mismatch = (formValid && saved.form_number !== requestedForm) || (['A','B'].includes(direction) && direction !== saved.orientation);
    const resume = saved ? `<section class="resume-card"><h3>${saved.stage === 'done' ? '已有一份已完成的结果' : '发现未完成的问卷'}</h3><p class="rating-hint">问卷${String(saved.form_number).padStart(2,'0')} · 已完成 ${saved.answers.length} / 96 题 · 参与者 ${escapeHtml(saved.participant_id)}${mismatch ? '<br>当前链接的问卷或方向与已存进度不同，请确认后选择。' : ''}</p><div class="actions"><button class="button button-primary" id="restore-session" type="button">${saved.stage === 'done' ? '查看并下载结果' : '继续已存问卷'}</button><button class="button button-quiet" id="discard-session" type="button">清除本机进度，重新开始</button></div></section>` : '';
    app.innerHTML = `${resume}<div class="hero"><section class="hero-copy"><span class="eyebrow">PILOT / SIX DIMENSIONS</span><h1>看一看，<br>比较你的直观感受。</h1><p>每份问卷评价六个维度，每个维度16组界面。请根据视觉印象比较感知强弱，无需表达喜欢与否。</p><div class="stat-row"><div class="stat"><strong>6</strong><span>评价维度</span></div><div class="stat"><strong>16</strong><span>每维比较</span></div><div class="stat"><strong>96</strong><span>正式比较</span></div></div><div class="guide"><strong>作答方式</strong><p>选择更符合当前描述的界面，例如“左图更一致”或“右图更一致”；两图接近时选“两图差不多”。可随时下载已答结果进行试测，无需答完整份问卷。</p></div></section><form id="setup-form" class="setup-card"><h2>开始前，确认一下</h2><p>六维试测版 · 共50套。答案保存在本机，可随时下载已答CSV；答完后也可下载JSON。</p><label class="field"><span>问卷编号</span><select id="form-number" name="form"><option value="random">随机选择一套试测</option>${DATA.forms.map(f => `<option value="${f.number}" ${formValid && f.number === requestedForm ? 'selected' : ''}>试测 ${String(f.number).padStart(2,'0')}</option>`).join('')}</select><small>如果研究者提供了编号，请按指定编号作答。</small></label><label class="field"><span>参与者编号</span><input id="participant-id" name="participant" maxlength="60" placeholder="可留空，自动生成" autocomplete="off"><small>填写研究者提供的编号，或使用系统生成的匿名编号。</small></label><label class="field"><span>国家 / 地区</span><input id="country" name="country" required maxlength="80" placeholder="例如：中国 / South Africa" value="${escapeHtml((params.get('country') || '').slice(0,80))}" autocomplete="off"></label><label class="consent"><input type="checkbox" id="consent" required><span>我已了解作答方式，同意自愿参与，并会在结束后下载结果。</span></label><p id="setup-error" class="error" role="alert"></p><button class="button button-primary full-width" type="submit" ${saved ? 'disabled' : ''}>进入问卷 <span aria-hidden="true">→</span></button><p class="rating-hint" style="margin:14px 0 0">计时从第一组正式比较开始。无需赶时间。</p></form></div>`;
    if (saved) {
      document.getElementById('restore-session').onclick = async () => {
        state = saved;
        plan = C.makePlan(DATA, state.form_number, state.orientation);
        await claimSession();
        if (sessionLocked) return render();
        logEvent('restored');
        persist(); render();
      };
      document.getElementById('discard-session').onclick = async () => {
        if (!(await askConfirmation('清除后将无法恢复本机已存进度。若已完成，请先下载结果。确定清除？'))) return;
        try {localStorage.removeItem(storageKey);} catch {warnStorage();}
        render();
      };
    }
    document.getElementById('setup-form').onsubmit = async event => {
      event.preventDefault();
      if (saved) return;
      const numberValue = document.getElementById('form-number').value;
      const formNumber = numberValue === 'random' ? randomNumber(DATA.forms.length) + 1 : Number(numberValue);
      const orientation = ['A','B'].includes(direction) ? direction : (randomNumber(2) ? 'B' : 'A');
      const sessionId = crypto.randomUUID ? crypto.randomUUID() : Date.now().toString(36) + '-' + randomNumber(1000000000).toString(36);
      const participant = document.getElementById('participant-id').value.trim() || 'P-' + sessionId.slice(0,8);
      const country = document.getElementById('country').value.trim();
      if (!country) {document.getElementById('setup-error').textContent = '请填写国家或地区。'; return;}
      plan = C.makePlan(DATA, formNumber, orientation);
      state = {study_version: DATA.version, dataset_hash: DATA.dataset_hash, session_id: sessionId,
        participant_id: participant, country, form_number: formNumber, orientation,
        order_index: plan.orderIndex, dimension_order: plan.order, stage: 'tutorial', practice_index:0, practice_answers:[], tutorial_started_at:new Date().toISOString(), index: 0,
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
  function dimensionGuide(dim) {
    return `<div class="dimension-guide"><span class="eyebrow">本轮只判断这个维度</span><h2>${dim.name}</h2><p class="definition-large">${dim.definition}</p><p class="rating-hint">请根据界面的视觉印象判断。不同维度可以有不同答案；不需要判断哪个更喜欢或更好用。</p></div>`;
  }
  function showTutorial() {
    app.innerHTML=`<section class="center-card tutorial-card"><span class="eyebrow">开始前 · 作答教学</span><h1>先熟悉一下怎么比较。</h1><p class="muted">先阅读说明，再做3道练习。教学和练习不计入正式作答用时。</p><ol class="tutorial-steps"><li><strong>一次只看一个维度</strong><p>先看题目和维度说明，再比较左右两张图。判断的是它看起来有多符合这个描述。</p></li><li><strong>选择左图、差不多，或右图</strong><p>例如“一致性”的选项是“左图更一致／两图差不多／右图更一致”。选项会随维度变化。两图接近时可以选中间项。</p></li><li><strong>选中后，点击下一题</strong><p>提交前可以改选。图片可点击放大，也可以打开“双图大图对比”。不限制单题时间，按直观感受判断即可。</p></li><li><strong>需要时可以休息或下载</strong><p>右上角可暂停、下载已答CSV。这是试测，可以只做一部分题。正式结果只保存在本机，需要下载后交给研究者。</p></li></ol><h2>这份问卷会评价</h2><div class="tutorial-dimensions">${plan.order.map(code=>{const d=DATA.dimensions.find(d=>d.code===code);return `<article><strong>${d.name}</strong><p>${d.definition}</p></article>`;}).join('')}</div><p class="rating-hint">主观感知没有标准答案。科技感只判断视觉联想，不推测界面实际是否具有智能功能。建议使用电脑并将浏览器窗口最大化。</p><button id="begin-practice" class="button button-primary" type="button">开始3道操作练习 →</button></section>`;
    document.getElementById('begin-practice').onclick=()=>{state.stage='practice';logEvent('tutorial_read');persist();render();window.scrollTo(0,0);};
  }
  // Neutral schematic stimuli, separate from the 206 formal screenshots.
  function practiceImage(index, side) {
    const palettes=[['#e4edfc','#4675cc','#bccfe9'],['#fcf1e4','#b47943','#ead1b6'],['#e8f2ee','#548471','#bad7ca']];
    const [bg,accent,soft]=palettes[(index+side)%3];
    const icons=Array.from({length:12},(_,i)=>{const x=26+(i%3)*69,y=180+Math.floor(i/3)*69;return `<rect x="${x}" y="${y}" width="43" height="43" rx="${side ? 14 : 10}" fill="${i%3===0 ? accent : soft}"/><circle cx="${x+21}" cy="${y+21}" r="8" fill="white" opacity=".75"/>`;}).join('');
    const svg=`<svg xmlns="http://www.w3.org/2000/svg" width="250" height="500" viewBox="0 0 250 500"><rect width="250" height="500" rx="24" fill="${bg}"/><text x="22" y="35" font-family="sans-serif" font-size="14" fill="#283850">9:41</text><rect x="26" y="65" width="198" height="85" rx="16" fill="${accent}"/><rect x="44" y="88" width="80" height="9" rx="4" fill="white"/><rect x="44" y="108" width="125" height="6" rx="3" fill="white" opacity=".6"/>${icons}<rect x="26" y="462" width="198" height="17" rx="8" fill="white" opacity=".7"/></svg>`;
    return 'data:image/svg+xml;charset=utf-8,'+encodeURIComponent(svg);
  }
  function showPractice() {
    const index=state.practice_index || 0;
    const dim=DATA.dimensions.find(d=>d.code===plan.order[index]);
    app.innerHTML=`<section class="practice-screen"><span class="eyebrow">操作练习 ${index+1} / 3 · 不计入正式结果</span><h1>${C.dimensionQuestion(dim.code)}</h1><p class="definition">${dim.definition}</p><div class="image-grid">${['左图','右图'].map((label,side)=>`<figure class="image-card"><figcaption><strong>${label} · 练习示意图</strong></figcaption><div class="image-stage"><img class="stimulus practice-stimulus" alt="${label}练习示意图" src="${practiceImage(index,side)}"/></div></figure>`).join('')}</div><div class="response-panel"><p class="rating-hint">只练习操作，不评判你的主观答案。请选择一项，再点击“下一道练习”。</p><div class="choices">${C.SCALE.map(s=>`<button class="choice practice-choice" data-practice-score="${s.score}" aria-pressed="false" type="button">${C.comparisonLabel(dim.code,s.score)}</button>`).join('')}</div><p id="practice-feedback" role="status" class="rating-hint"></p><button id="next-practice" class="button button-primary" type="button" disabled>${index===2 ? '完成练习，继续 →' : '下一道练习 →'}</button></div></section>`;
    let selected=null;
    document.querySelectorAll('.practice-choice').forEach(b=>{b.onclick=()=>{selected=Number(b.dataset.practiceScore);document.querySelectorAll('.practice-choice').forEach(x=>x.setAttribute('aria-pressed',String(x===b)));document.getElementById('practice-feedback').textContent='已选择。提交前可以改选；主观感知没有标准答案。';document.getElementById('next-practice').disabled=false;};});
    document.getElementById('next-practice').onclick=()=>{if(selected===null)return;state.practice_answers.push({practice_index:index+1,dimension_code:dim.code,response_score_left:selected,response_label:C.comparisonLabel(dim.code,selected),answered_at:new Date().toISOString()});state.practice_index++;state.stage=state.practice_index===3 ? 'check' : 'practice';logEvent('practice_answered',{dimension:dim.code});persist();render();window.scrollTo(0,0);};
  }
  function showCheck() {
    app.innerHTML=`<section class="center-card"><span class="eyebrow">教学结束 · 两个小确认</span><h1>确认一下作答方式。</h1><form id="instruction-check"><fieldset><legend>1. 当题目问“哪张更有科技感”时，应该怎么判断？</legend><label class="check-option"><input type="radio" name="focus" value="perception" required>只看技术化、数字化及未来技术的视觉联想</label><label class="check-option"><input type="radio" name="focus" value="preference">选择自己更喜欢、觉得功能更好的界面</label></fieldset><fieldset><legend>2. 觉得两张图在当前维度上很接近时，可以怎么选？</legend><label class="check-option"><input type="radio" name="tie" value="force" required>必须选左图或右图</label><label class="check-option"><input type="radio" name="tie" value="similar">选择“两图差不多”</label></fieldset><p id="check-feedback" class="error" role="status"></p><button class="button button-primary" type="submit">确认，进入正式评价 →</button></form></section>`;
    document.getElementById('instruction-check').onsubmit=e=>{e.preventDefault();const focus=document.querySelector('input[name=focus]:checked')?.value;const tie=document.querySelector('input[name=tie]:checked')?.value;logEvent('instruction_check',{passed:focus==='perception' && tie==='similar'});if(focus!=='perception'||tie!=='similar'){document.getElementById('check-feedback').textContent='请再看一下：只判断题目指定的视觉感知；两图接近时可以选“两图差不多”。';persist();return;}state.tutorial_completed_at=new Date().toISOString();state.stage='intro';persist();render();window.scrollTo(0,0);};
  }
  function showIntro() {
    const dim=dimensionAt(0);
    app.innerHTML=`<section class="center-card"><span class="eyebrow">正式评价 · 第1个维度</span><h1>接下来，评价${dim.name}。</h1>${dimensionGuide(dim)}<p class="muted">本维度共16组界面。选项为“${C.comparisonLabel(dim.code,1)}／两图差不多／${C.comparisonLabel(dim.code,-1)}”。</p><p class="rating-hint">准备好后开始，正式计时从下一组图片呈现起记录。</p><button id="start-trials" class="button button-primary" type="button">开始评价${dim.name} →</button></section>`;
    document.getElementById('start-trials').onclick=()=>{state.started_at=new Date().toISOString();state.stage='trial';logEvent('started');persist();render();window.scrollTo(0,0);};
  }

  function showTrial() {
    const trial = plan.trials[state.index];
    const dimension = dimensionAt(state.index);
    const token = renderId;
    app.innerHTML = `<div class="progress-meta"><span>问卷 ${String(state.form_number).padStart(2,'0')} · 第 ${trial.dimension_position} / 6 个维度</span><span>已完成 ${state.answers.length} / 96 题</span></div><div class="progress-track" role="progressbar" aria-label="问卷进度" aria-valuenow="${state.answers.length}" aria-valuemin="0" aria-valuemax="96"><div class="progress-fill" style="width:${state.answers.length/96*100}%"></div></div><div class="dimension-tabs">${plan.order.map((code,i)=>`<span class="dimension-tab ${i+1===trial.dimension_position ? 'current' : i+1<trial.dimension_position ? 'done' : ''}">${i+1<trial.dimension_position ? '✓ ' : ''}${DATA.dimensions.find(d=>d.code===code).name}</span>`).join('')}</div><section aria-labelledby="trial-question"><div class="trial-heading"><div><h1 id="trial-question">${C.dimensionQuestion(dimension.code)}</h1><p class="definition">${dimension.definition}</p></div><span class="trial-number">本维度 ${trial.dimension_trial_index} / 16</span></div><div class="image-tools"><span>完整显示原图，不裁剪、不拉伸</span><button id="compare-large" class="button button-quiet" type="button">双图大图对比 ↗</button></div><div class="image-grid">${[['left',trial.left_ui,'左图'],['right',trial.right_ui,'右图']].map(([side,ui,label])=>`<figure class="image-card"><figcaption><strong>${label} <span class="muted">· ${ui}</span></strong><span class="image-caption-hint">点击查看大图</span></figcaption><div class="image-stage"><img class="stimulus" id="${side}-image" alt="${label} ${ui}" tabindex="0" role="button" aria-label="放大${label} ${ui}"></div></figure>`).join('')}</div><div id="loading-status" class="loading-status" role="status">正在加载两张界面图…</div><div class="response-panel"><p class="response-prompt">只根据「${dimension.name}」判断；两图接近时选择中间项</p><div class="choices" role="group" aria-label="三类比较">${C.SCALE.map((s,i)=>`<button class="choice" data-score="${s.score}" type="button" aria-pressed="${state.selected === s.score}" disabled aria-label="${C.comparisonLabel(dimension.code,s.score)}">${C.comparisonLabel(dimension.code,s.score)}<small>${i+1} · ${s.hint}</small></button>`).join('')}</div><div class="trial-actions"><p>快捷键 1—3 选择，Enter 确认。<br><span id="save-status" class="save-status">${storageWorking ? '进度自动保存在当前浏览器' : '本机保存不可用，请保持页面打开'}</span></p><button class="button button-primary" id="next-trial" type="button" disabled>${state.index === 95 ? '完成问卷' : trial.dimension_trial_index === 16 ? '完成本维度 →' : '下一题 →'}</button></div></div></section>`;
    document.getElementById('compare-large').onclick=()=>{document.getElementById('large-left').src=DATA.images[trial.left_ui];document.getElementById('large-right').src=DATA.images[trial.right_ui];document.getElementById('large-question').textContent=C.dimensionQuestion(dimension.code);document.getElementById('large-compare').showModal();};
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
    const dim = dimensionAt(state.index);
    const completed = Math.floor(state.index / 16);
    const heading = `已完成 ${completed} 个维度。`;
    app.innerHTML = `<section class="center-card"><span class="eyebrow">A SHORT PAUSE</span><h1>${heading}</h1><p class="muted">可以休息片刻，再继续。休息期间不计入有效作答时间。</p><div class="break-stats"><div><span>已完成</span><strong>${state.index} / 96</strong></div><div><span>总用时</span><strong>${C.formatTime(wallTime())}</strong></div><div><span>有效作答</span><strong>${C.formatTime(state.active_total_ms)}</strong></div></div><h2>下一个维度：${dim.name}</h2>${dimensionGuide(dim)}<button class="button button-primary" id="continue-block" type="button">准备好了，继续 →</button><p class="rating-hint" style="margin-top:18px">也可使用右上角“下载已答CSV”，只测试部分题目。</p></section>`;
    document.getElementById('continue-block').onclick = () => {state.stage='trial';logEvent('break_ended');persist();render();};
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
      scale_note: '三类分值为有序类别，正值表示左图更符合当前维度描述，不应直接解释为等距测量。',
      tutorial: {version:'instructions-practice-check-v1', started_at:state.tutorial_started_at, completed_at:state.tutorial_completed_at, practice_count:state.practice_answers?.length || 0, practice_excluded_from_ranking:true},
      scale: C.SCALE.map(s=>({score_left:s.score,label:s.label})), dimensions: dimensionSummary};
  }
  function download(format) {
    const base = 'UI试测6维16题_'  + state.form_number.toString().padStart(2,'0') + '_' + state.participant_id.replace(/[^a-zA-Z0-9_\u3400-\u9fff-]/g,'_').slice(0,40) + '_' + state.session_id.slice(0,8);
    const completed = state.stage === 'done';
    const elapsed = wallTime();
    const exportRows = state.answers.map(row => ({
      '练习完成题数':state.practice_answers?.length || 0,
      '问卷是否完成': completed ? '是' : '否',
      '完成用时（分秒）': completed ? C.formatTime(elapsed) : '',
      '完成用时（秒）': completed ? Math.round(elapsed) / 1000 : '',
      '完成时刻（本地）': state.finished_at ? new Date(state.finished_at).toLocaleString('zh-CN', {hour12:false}) : '',
      '完成时刻（UTC）': state.finished_at || '',
      '当前已用时（秒）': Math.round(elapsed) / 1000,
      '有效作答用时（秒）': Math.round(state.active_total_ms) / 1000,
      '本题用时（秒）': row.active_time_ms / 1000,
      ...row, response_label:C.comparisonLabel(row.dimension_code,row.response_score_left)
    }));
    const text = format === 'csv' ? C.toCsv(exportRows) : JSON.stringify({metadata:metadata(), responses:state.answers.map(row=>({...row,response_label:C.comparisonLabel(row.dimension_code,row.response_score_left)})), practice_responses:state.practice_answers || [], events:state.events}, null, 2);
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
    document.getElementById('new-session').onclick = async () => {
      if (!(await askConfirmation('请确认已下载结果。开始另一份试测会清除当前浏览器中的这份记录。继续？'))) return;
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
  document.getElementById('close-large').onclick=()=>document.getElementById('large-compare').close();
  document.getElementById('close-zoom').onclick = ()=>zoomDialog.close();
  document.addEventListener('keydown',event=>{
    if (event.repeat || !running() || pauseDialog.open || zoomDialog.open || document.getElementById('large-compare').open || ['INPUT','SELECT','TEXTAREA'].includes(document.activeElement?.tagName)) return;
    if (/^[1-3]$/.test(event.key)) {event.preventDefault(); selectScore(C.SCALE[Number(event.key)-1].score);}
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
  window.addEventListener('beforeunload',()=>{tick();persist();});
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
