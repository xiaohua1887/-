/* Shared deterministic design and export rules. No network or storage access. */
(function (root) {
  'use strict';
  const SCALE = [
    {score: 1, label: '左图更符合当前描述', short: '左图', hint: '选择左图'},
    {score: 0, label: '两图差不多', short: '差不多', hint: '两图相近'},
    {score: -1, label: '右图更符合当前描述', short: '右图', hint: '选择右图'}
  ];
  const DIMENSION_WORDING = {
    consistency:'更一致', vitality:'更有活力', fun:'更有趣',
    technology:'更有科技感', trendiness:'更新潮', premium:'更高级'
  };
  function comparisonLabel(code, score) {
    if (!DIMENSION_WORDING[code] || !SCALE.some(s=>s.score===score)) throw new Error('无效的比较答案');
    return score === 0 ? '两图差不多' : (score === 1 ? '左图' : '右图') + DIMENSION_WORDING[code];
  }
  function dimensionQuestion(code) {return '哪张界面看起来' + DIMENSION_WORDING[code] + '？';}
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
    if (!SCALE.some(s => s.score === score)) throw new Error('无效的三类答案');
    return {
      response_score_left: score,
      score_for_base_left: score * (trial.left_ui === trial.base_left_ui ? 1 : -1),
      score_for_canonical_ui_1: score * (trial.left_ui === trial.canonical_ui_1 ? 1 : -1),
      response_label: comparisonLabel(trial.dimension_code, score)
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
  root.QuestionnaireCore = {SCALE, comparisonLabel, dimensionQuestion, makePlan, responseFields, toCsv, formatTime};
})(typeof window === 'undefined' ? globalThis : window);
