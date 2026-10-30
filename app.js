// Presentation only. All norms calculations and input/source guards run in R.
import { initializeR, calculate, runSelfChecks } from './calculator-r.js';

const form = document.querySelector('#scenario-form');
const calculateButton = document.querySelector('#calculate-button');
const downloadButton = document.querySelector('#download-button');
const formStatus = document.querySelector('#form-status');
const runtimeStatus = document.querySelector('#runtime-status');
const runtimeLabel = document.querySelector('#runtime-label');
const errorBox = document.querySelector('#calculation-error');
const warningsBox = document.querySelector('#warnings');
const warningList = document.querySelector('#warning-list');
const chartContainer = document.querySelector('#chart-container');
const results = document.querySelector('#results');
let ready = false;
let busy = false;
let dirty = false;
let lastResult = null;
let requestVersion = 0;
const metricDefinitions = [
  ['conditional_projection', 'Conditional Growth Projection', r => r.growth.conditional_projection, 2],
  ['projected_ending_rit', 'Projected ending RIT', r => r.growth.projected_ending_rit, 2],
  ['conditional_sd', 'SD of Growth', r => r.growth.conditional_sd, 2],
  ['observed', 'Observed Growth', r => r.growth.observed, 2],
  ['cgi', 'Conditional Growth Index (CGI)', r => r.growth.cgi, 2],
  ['cgp', 'Conditional Growth Percentile (CGP)', r => r.growth.cgp, 0],
  ['starting_mean', 'Starting achievement mean', r => r.achievement.start.mean, 2],
  ['starting_sd', 'Starting achievement SD', r => r.achievement.start.sd, 2],
  ['starting_percentile', 'Starting achievement percentile', r => r.achievement.start.percentile, 0],
  ['ending_mean', 'Ending achievement mean', r => r.achievement.end.mean, 2],
  ['ending_sd', 'Ending achievement SD', r => r.achievement.end.sd, 2],
  ['ending_percentile', 'Ending achievement percentile', r => r.achievement.end.percentile, 0]
];
const finite = value => typeof value === 'number' && Number.isFinite(value);
const numberText = (value, digits = 2) => finite(value) ? value.toFixed(digits) : '—';
const compactNumber = value => finite(value) ? new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(value) : '—';
const gradeText = value => value === 0 ? 'K' : String(value);
const timepointText = (grade, week) => `Grade ${gradeText(grade)} · ${finite(week) ? `Week ${week}` : 'Ending week not supplied'}`;

function readInputs() {
  return {
    subject: form.elements.subject.value,
    start_grade: Number(form.elements.start_grade.value),
    end_grade: Number(form.elements.end_grade.value),
    start_week: Number(form.elements.start_week.value),
    end_week: form.elements.end_week.value.trim(),
    start_rit: form.elements.start_rit.value.trim(),
    end_rit: form.elements.end_rit.value.trim(),
    include_actual: form.elements.include_actual.checked
  };
}

function setDirty() {
  dirty = true;
  document.body.classList.toggle('stale', Boolean(lastResult));
  downloadButton.disabled = true;
  if (ready && !busy) {
    formStatus.textContent = lastResult ? 'Inputs changed. Select Calculate.' : 'Select Calculate.';
    formStatus.classList.add('dirty');
  }
  form.elements.end_rit.disabled = !form.elements.include_actual.checked;
}

function showError(message) {
  errorBox.textContent = message;
  errorBox.hidden = false;
}

function clearResults() {
  lastResult = null;
  document.querySelectorAll('[data-metric]').forEach(node => { node.textContent = '—'; });
  document.querySelectorAll('[id^="diag-"]').forEach(node => { node.textContent = '—'; });
  chartPlaceholder('Check the inputs above.');
  document.querySelector('#scenario-summary').textContent = 'No current calculation.';
  document.querySelector('#reference-location').textContent = 'No reference selected.';
  document.querySelectorAll('#reference-parameters td').forEach(node => { node.textContent = '—'; });
  warningsBox.hidden = true;
  downloadButton.disabled = true;
  document.body.classList.remove('stale');
}

function chartPlaceholder(message) {
  chartContainer.replaceChildren();
  const placeholder = document.createElement('div');
  placeholder.className = 'chart-placeholder';
  const text = document.createElement('p');
  text.textContent = message;
  placeholder.append(text);
  chartContainer.append(placeholder);
}

function svgElement(tag, attributes = {}, text) {
  const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  if (text !== undefined) node.textContent = text;
  return node;
}

function renderChart(result) {
  const { inputs, growth } = result;
  if (!result.growth_available || !finite(inputs.start_rit) || !finite(growth.projected_ending_rit)) {
    chartPlaceholder('Growth is unavailable for these inputs.');
    return;
  }
  // Scales and coordinates format R results for the chart; no norms are computed here.
  const width = Math.max(290, Math.round(chartContainer.clientWidth));
  const height = 260;
  const margin = { left: 54, right: width < 440 ? 110 : 145, top: 22, bottom: 48 };
  const startX = margin.left;
  const endX = width - margin.right;
  const plotTop = margin.top;
  const plotBottom = height - margin.bottom;
  const hasActual = finite(inputs.end_rit) && finite(growth.observed);
  const values = [inputs.start_rit, growth.projected_ending_rit];
  if (hasActual) values.push(inputs.end_rit);
  const low = Math.min(...values);
  const high = Math.max(...values);
  const spread = Math.max(high - low, 10);
  const minimum = Math.floor((low - spread * 0.2) / 5) * 5;
  const maximum = Math.ceil((high + spread * 0.2) / 5) * 5;
  const y = value => plotBottom - ((value - minimum) / (maximum - minimum)) * (plotBottom - plotTop);
  const projectedY = y(growth.projected_ending_rit);
  const actualY = hasActual ? y(inputs.end_rit) : null;
  let projectedLabelY = projectedY;
  let actualLabelY = actualY;
  if (hasActual && Math.abs(projectedY - actualY) < 31) {
    projectedLabelY = Math.min(plotBottom - 5, projectedY + 16);
    actualLabelY = Math.max(plotTop + 5, actualY - 16);
  }
  const svg = svgElement('svg', { viewBox: `0 0 ${width} ${height}`, width, height, role: 'img', 'aria-labelledby': 'chart-svg-title chart-svg-description' });
  svg.append(svgElement('title', { id: 'chart-svg-title' }, 'Starting score, projected ending score and actual ending score'));
  svg.append(svgElement('desc', { id: 'chart-svg-description' }, `Starting RIT ${compactNumber(inputs.start_rit)}. Projected ending RIT ${compactNumber(growth.projected_ending_rit)}.${hasActual ? ` Actual ending RIT ${compactNumber(inputs.end_rit)}.` : ' No actual ending score is included.'}`));
  const commonText = { 'font-family': 'Segoe UI, Arial, sans-serif', fill: '#66717a', 'font-size': 11 };
  for (let tick = 0; tick <= 4; tick++) {
    const value = minimum + (maximum - minimum) * tick / 4;
    const tickY = y(value);
    svg.append(svgElement('line', { x1: startX, x2: endX + 5, y1: tickY, y2: tickY, stroke: '#e5e7eb', 'stroke-width': 1 }));
    svg.append(svgElement('text', { ...commonText, x: startX - 12, y: tickY + 4, 'text-anchor': 'end' }, compactNumber(value)));
  }
  svg.append(svgElement('text', { ...commonText, x: 12, y: (plotTop + plotBottom) / 2, transform: `rotate(-90 12 ${(plotTop + plotBottom) / 2})`, 'text-anchor': 'middle', 'font-size': 10 }, 'RIT SCORE'));
  svg.append(svgElement('line', { x1: startX, x2: endX, y1: y(inputs.start_rit), y2: projectedY, stroke: '#087c7a', 'stroke-width': 3, 'stroke-linecap': 'round' }));
  if (hasActual) svg.append(svgElement('line', { x1: startX, x2: endX, y1: y(inputs.start_rit), y2: actualY, stroke: '#526773', 'stroke-width': 3, 'stroke-dasharray': '7 5', 'stroke-linecap': 'round' }));
  svg.append(svgElement('circle', { cx: startX, cy: y(inputs.start_rit), r: 5, fill: '#fff', stroke: '#087c7a', 'stroke-width': 2.5 }));
  svg.append(svgElement('circle', { cx: endX, cy: projectedY, r: 5, fill: '#fff', stroke: '#087c7a', 'stroke-width': 2.5 }));
  if (hasActual) svg.append(svgElement('circle', { cx: endX, cy: actualY, r: 5, fill: '#526773', stroke: '#fff', 'stroke-width': 2 }));
  const labelX = endX + 12;
  const labelSize = width < 440 ? 10 : 12;
  svg.append(svgElement('text', { ...commonText, x: labelX, y: projectedLabelY + 4, fill: '#087c7a', 'font-size': labelSize, 'font-weight': 650 }, `Projected ${compactNumber(growth.projected_ending_rit)}`));
  if (hasActual) svg.append(svgElement('text', { ...commonText, x: labelX, y: actualLabelY + 4, fill: '#526773', 'font-size': labelSize, 'font-weight': 650 }, `Actual ${compactNumber(inputs.end_rit)}`));
  const startLabelY = y(inputs.start_rit) > plotTop + 25 ? y(inputs.start_rit) - 14 : y(inputs.start_rit) + 22;
  svg.append(svgElement('text', { ...commonText, x: startX + 10, y: startLabelY, fill: '#173a45', 'font-size': 11, 'font-weight': 650 }, compactNumber(inputs.start_rit)));
  svg.append(svgElement('text', { ...commonText, x: startX, y: height - 29, 'text-anchor': 'start', fill: '#173a45', 'font-weight': 650 }, 'Starting'));
  svg.append(svgElement('text', { ...commonText, x: startX, y: height - 12, 'text-anchor': 'start', 'font-size': width < 440 ? 9 : 10 }, timepointText(inputs.start_grade, inputs.start_week)));
  svg.append(svgElement('text', { ...commonText, x: endX, y: height - 29, 'text-anchor': 'middle', fill: '#173a45', 'font-weight': 650 }, 'Ending'));
  svg.append(svgElement('text', { ...commonText, x: endX, y: height - 12, 'text-anchor': 'middle', 'font-size': width < 440 ? 9 : 10 }, timepointText(inputs.end_grade, inputs.end_week)));
  chartContainer.replaceChildren(svg);
}

function diagnosticText(raw, displayed) {
  return finite(raw) ? `${raw.toFixed(6)} → ${numberText(displayed, 0)}` : '—';
}

function renderResult(result) {
  lastResult = result;
  metricDefinitions.forEach(([key, , getter, digits]) => {
    document.querySelector(`[data-metric="${key}"]`).textContent = numberText(getter(result), digits);
  });
  const input = result.inputs;
  const subjectLabel = input.subject === 'sci' ? 'Science' : input.subject_label;
  document.querySelector('#scenario-summary').textContent = `${subjectLabel} · Grade ${gradeText(input.start_grade)} to ${gradeText(input.end_grade)} · ${finite(input.end_week) ? `Weeks ${input.start_week}–${input.end_week}` : `Starting week ${input.start_week}`}`;
  document.querySelector('#starting-context').textContent = timepointText(input.start_grade, input.start_week);
  document.querySelector('#ending-context').textContent = timepointText(input.end_grade, input.end_week);
  warningList.replaceChildren();
  for (const warning of result.warnings || []) {
    const item = document.createElement('li');
    item.textContent = warning;
    warningList.append(item);
  }
  warningsBox.hidden = warningList.children.length === 0;
  renderChart(result);
  const parameters = result.source.parameters;
  const referenceBody = document.querySelector('#reference-parameters');
  referenceBody.replaceChildren();
  for (const parameter of ['P1', 'P2', 'V11', 'V12', 'V21', 'V22']) {
    const row = document.createElement('tr');
    const name = document.createElement('th');
    name.scope = 'row';
    name.textContent = parameter;
    const value = document.createElement('td');
    value.textContent = numberText(parameters?.[parameter], 6);
    row.append(name, value);
    referenceBody.append(row);
  }
  document.querySelector('#reference-location').textContent = finite(result.source.growth_row) ? `Growth source: ${result.source.growth_sheet} · row ${result.source.growth_row}` : 'No growth reference matches this interval.';
  document.querySelector('#source-hash').textContent = result.source.parameter_workbook_sha256;
  const diagnosticCases = [ ['start', result.achievement.start.percentile_raw, result.achievement.start.percentile, result.achievement.start.pnorm_raw, result.achievement.start.pnorm_percentile], ['end', result.achievement.end.percentile_raw, result.achievement.end.percentile, result.achievement.end.pnorm_raw, result.achievement.end.pnorm_percentile], ['growth', result.growth.cgp_raw, result.growth.cgp, result.growth.pnorm_raw, result.growth.pnorm_percentile] ];
  for (const [name, raw, rounded, exactRaw, exactRounded] of diagnosticCases) {
    document.querySelector(`#diag-${name}-m05`).textContent = diagnosticText(raw, rounded);
    document.querySelector(`#diag-${name}-pnorm`).textContent = diagnosticText(exactRaw, exactRounded);
  }
}

async function calculateCurrent() {
  if (!ready || busy || !form.reportValidity()) return;
  const currentRequest = ++requestVersion;
  const inputs = readInputs();
  busy = true;
  dirty = false;
  calculateButton.disabled = true;
  downloadButton.disabled = true;
  calculateButton.querySelector('span').textContent = 'Calculating…';
  results.setAttribute('aria-busy', 'true');
  formStatus.textContent = 'Calculating…';
  formStatus.classList.remove('dirty');
  errorBox.hidden = true;
  try {
    const result = await calculate(inputs);
    if (currentRequest !== requestVersion) return;
    renderResult(result);
    if (dirty) {
      formStatus.textContent = 'Inputs changed. Select Calculate.';
      formStatus.classList.add('dirty');
    } else {
      formStatus.textContent = 'Updated.';
    }
    document.body.classList.toggle('stale', dirty);
    downloadButton.disabled = dirty;
  } catch (error) {
    if (currentRequest !== requestVersion) return;
    clearResults();
    showError(error instanceof Error ? error.message : 'The R calculation could not be completed. Check the scenario and try again.');
    formStatus.textContent = 'Check the inputs and try again.';
  } finally {
    if (currentRequest === requestVersion) {
      busy = false;
      calculateButton.disabled = !ready;
      calculateButton.querySelector('span').textContent = 'Calculate';
      results.setAttribute('aria-busy', 'false');
    }
  }
}

form.addEventListener('submit', event => { event.preventDefault(); calculateCurrent(); });
form.addEventListener('input', setDirty);
form.addEventListener('change', setDirty);
document.querySelector('#reset-button').addEventListener('click', () => {
  if (busy) return;
  form.reset();
  setDirty();
  if (ready) calculateCurrent();
});

document.querySelector('#self-check-button').addEventListener('click', async () => {
  if (!ready || busy) return;
  const button = document.querySelector('#self-check-button');
  const status = document.querySelector('#self-check-status');
  busy = true;
  calculateButton.disabled = true;
  downloadButton.disabled = true;
  button.disabled = true;
  status.textContent = 'Running selected reference checks in this browser’s R engine…';
  status.classList.remove('checks-failed');
  try {
    const check = await runSelfChecks();
    const passed = check.passed === check.total;
    status.textContent = `${check.passed} of ${check.total} selected checks passed in this browser.`;
    status.classList.toggle('checks-failed', !passed);
    if (!passed) {
      const names = (check.checks || []).filter(item => !item.passed).slice(0, 5).map(item => item.name);
      if (names.length) status.textContent += ` Check: ${names.join('; ')}.`;
    }
  } catch (error) {
    status.textContent = `The checks could not finish. ${error instanceof Error ? error.message : ''}`;
    status.classList.add('checks-failed');
  } finally {
    busy = false;
    button.disabled = false;
    calculateButton.disabled = !ready;
    downloadButton.disabled = !lastResult || dirty;
    if (dirty) {
      formStatus.textContent = 'Inputs changed. Select Calculate.';
      formStatus.classList.add('dirty');
    }
  }
});

downloadButton.addEventListener('click', () => {
  if (!lastResult || busy || dirty) return;
  const quote = value => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = [['ASG calculator', '2025 student norms', 'M05 percentile method'], ['Input', 'Value'], ...Object.entries(lastResult.inputs), [], ['Metric', 'Value'], ...metricDefinitions.map(([, label, getter]) => [label, getter(lastResult)]), [], ['Notes'], ...(lastResult.warnings || []).map(warning => [warning])];
  const csv = rows.map(row => row.map(quote).join(',')).join('\r\n');
  const url = URL.createObjectURL(new Blob(['\uFEFF', csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'asg-calculator-results.csv';
  anchor.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

let resizeFrame;
new ResizeObserver(() => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { if (lastResult) renderChart(lastResult); });
}).observe(chartContainer);

async function start() {
  try {
    await initializeR({ onStatus: () => {
      runtimeLabel.textContent = 'Loading…';
      formStatus.textContent = 'Loading calculator…';
    } });
    ready = true;
    runtimeLabel.textContent = 'Ready';
    runtimeStatus.classList.add('ready');
    calculateButton.disabled = false;
    document.querySelector('#self-check-button').disabled = false;
    await calculateCurrent();
  } catch (error) {
    runtimeStatus.classList.add('failed');
    runtimeLabel.textContent = 'R could not start';
    formStatus.textContent = 'Reload this page to try starting R again.';
    results.setAttribute('aria-busy', 'false');
    chartPlaceholder('The R engine could not start. Reload this page to try again.');
    showError(`The R engine could not start. ${error instanceof Error ? error.message : 'Please reload this page and try again.'}`);
  }
}

start();
