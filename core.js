/* Shared deterministic design and export rules. No network or storage access. */
(function (root) {
  'use strict';
  const SCALE = [
    {score: 2, label: '左图远强于右图', short: '左图远强', hint: '明显更强'},
    {score: 1, label: '左图强于右图', short: '左图更强', hint: '程度较强'},
    {score: 0, label: '两图感知强度相近', short: '两图相近', hint: '强度相似'},
    {score: -1, label: '右图强于左图', short: '右图更强', hint: '程度较强'},
    {score: -2, label: '右图远强于左图', short: '右图远强', hint: '明显更强'}
  ];
  function makePlan(data, formNumber, orientation) {
    const form = data.forms.find(f => f.number === Number(formNumber));
    if (!form || !['A', 'B'].includes(orientation)) throw new Error('无效的问卷编号或呈现方向');
    const orderIndex = ((form.number - 1) * 2 + (orientation === 'B' ? 1 : 0)) % 6;
    const order = [0, 1, 5, 2, 4, 3].map(n => (n + orderIndex) % 6);
    const trials = [];
    order.forEach((dimensionIndex, block) => {
      const dimension = data.dimensions[dimensionIndex];
      const pairs = form.dimensions[dimension.code];
      pairs.forEach((pair, item) => {
        const [baseLeft, baseRight] = pair;
        const canonical = [...pair].sort();
        trials.push({
          trial_index: trials.length + 1, dimension_position: block + 1,
          dimension_code: dimension.code, dimension: dimension.name,
          dimension_trial_index: item + 1, source_item_no: item + 1,
          pair_id: canonical.join('_'), canonical_ui_1: canonical[0], canonical_ui_2: canonical[1],
          base_left_ui: baseLeft, base_right_ui: baseRight,
          left_ui: orientation === 'A' ? baseLeft : baseRight,
          right_ui: orientation === 'A' ? baseRight : baseLeft
        });
      });
    });
    return {orderIndex, order: order.map(i => data.dimensions[i].code), trials};
  }
  function responseFields(trial, score) {
    if (!SCALE.some(s => s.score === score)) throw new Error('无效的五级答案');
    return {
      response_score_left: score,
      score_for_base_left: score * (trial.left_ui === trial.base_left_ui ? 1 : -1),
      score_for_canonical_ui_1: score * (trial.left_ui === trial.canonical_ui_1 ? 1 : -1),
      response_label: SCALE.find(s => s.score === score).label
    };
  }
  function csvCell(value) {
    let s = value === null || value === undefined ? '' : String(value);
    // Preserve negative numeric codes; neutralize spreadsheet formulas in user-entered text.
    if (typeof value === 'string' && /^[\s]*[=+@-]/.test(s)) s = "'" + s;
    return '"' + s.replace(/"/g, '""') + '"';
  }
  function toCsv(rows) {
    if (!rows.length) throw new Error('没有可导出的回答');
    const fields = Object.keys(rows[0]);
    return '\ufeff' + [fields.map(csvCell).join(','), ...rows.map(row => fields.map(k => csvCell(row[k])).join(','))].join('\r\n');
  }
  function formatTime(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    const minutes = Math.floor(seconds / 60);
    return (minutes < 100 ? String(minutes).padStart(2, '0') : String(minutes)) + ':' + String(seconds % 60).padStart(2, '0');
  }
  root.QuestionnaireCore = {SCALE, makePlan, responseFields, toCsv, formatTime};
})(typeof window === 'undefined' ? globalThis : window);
