/**
 * Browser adapter for the reviewed base-R ASG engine.
 * All normative calculations execute in R compiled to WebAssembly.
 * JavaScript only loads assets, passes typed input, and converts R output.
 * Owner: Nil Shah and Codex. Updated: 2026-10-30.
 */

export const WEBR_VERSION = '0.6.0';
const WEBR_MODULE = `https://webr.r-wasm.org/v${WEBR_VERSION}/webr.mjs`;
const WEBR_BASE = `https://webr.r-wasm.org/v${WEBR_VERSION}/`;

export const DEFAULT_INPUTS = Object.freeze({
  subject: 'read', start_grade: 6, end_grade: 6, start_week: 4,
  end_week: '32', start_rit: 180, end_rit: '204', include_actual: true,
});

// Deliberate source/version pin: updating an R file or table requires reviewing
// the change, regenerating these hashes, and rerunning the R self-checks.
const ASSETS = Object.freeze({
  'r/norms_engine.R': '79d03453189220fa66ffe3114e5be21c42ca90e4638234574990dcc63d9b3b0a',
  'r/self_checks.R': '244b6b111b764746a1a37bfb4d2a9964861f301713a1b36ab98689538d057745',
  'data/growth_parameters.csv.gz': '44f2e9fe7bb70436e2bc2f075d35511c3b67caa37ed27ea3ee61555a7bd8a480',
  'data/achievement_parameters.csv.gz': 'd04dc9c9cd4047546451f8cb68f7978e1cf27438aab43c48a16abf02dcbaf5de',
  'data/provenance.dcf': '7b9f709238b671eb9b041c819c94e96c9f490408d8df78f9e8bc0c7fe4073f21',
  'data/golden_cases.csv': '44116cf54cde58cba9ad1fe43d68da9477dc8e378575e58b7192235396a19ca5',
});

let worker;
let initialization;
let runtimeSummary;
let jobQueue = Promise.resolve();
let lastStatus = 'R has not started yet.';
const statusListeners = new Set();

function reportStatus(message) {
  lastStatus = message;
  for (const listener of statusListeners) {
    try { listener(message); } catch { /* A display callback cannot alter R. */ }
  }
}

async function sha256(bytes) {
  if (!globalThis.crypto?.subtle) {
    throw new Error('This browser needs HTTPS or localhost to load the verified R calculator.');
  }
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}

async function fetchVerifiedAsset(path, expectedHash) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 45000);
  try {
    const response = await fetch(new URL(path, import.meta.url), {
      cache: 'no-cache', signal: controller.signal,
    });
    if (!response.ok) throw new Error(`Could not load ${path} (HTTP ${response.status}).`);
    const bytes = new Uint8Array(await response.arrayBuffer());
    if (await sha256(bytes) !== expectedHash) {
      throw new Error(`The pinned ${path} checksum changed. Refresh or review the published source version.`);
    }
    return { path, bytes };
  } finally {
    clearTimeout(timeout);
  }
}

/** Convert WebR's documented recursive toJs representation into plain values.
 * Missing R values become null. Atomic length-one values become scalars.
 * No numerical formulas or percentile rounding are implemented here.
 */
function plainRValue(node) {
  if (node == null || typeof node !== 'object') return node;
  if (Array.isArray(node)) return node.map(plainRValue);
  if (node.type === 'null') return null;
  if (!Object.hasOwn(node, 'type')) {
    return Object.fromEntries(Object.entries(node).map(([key, value]) => [key, plainRValue(value)]));
  }
  const values = Array.from(node.values ?? []);
  if (node.type === 'list' || node.type === 'pairlist' || node.type === 'environment') {
    if (node.names?.length && node.names.every(name => typeof name === 'string' && name.length)) {
      return Object.fromEntries(node.names.map((name, index) => [name, plainRValue(values[index])]));
    }
    return values.map(plainRValue);
  }
  if (['double', 'integer', 'logical', 'character'].includes(node.type)) {
    if (values.length === 1) return values[0];
    return values;
  }
  throw new Error(`Unsupported R result type: ${node.type}.`);
}

async function withShelter(callback) {
  const shelter = await new worker.Shelter();
  try { return await callback(shelter); }
  finally { await shelter.purge(); }
}

function enqueue(callback) {
  const next = jobQueue.then(callback, callback);
  jobQueue = next.catch(() => undefined);
  return next;
}

/**
 * Load the pinned WebR runtime and the exact reviewed engine/data once.
 * onStatus receives readable status strings; the promise resolves to metadata.
 * PostMessage is WebR's no-COOP/COEP mode, suitable for GitHub Pages.
 */
export async function initializeR({ onStatus } = {}) {
  if (typeof onStatus === 'function') {
    statusListeners.add(onStatus);
    onStatus(lastStatus);
  }
  if (!initialization) {
    initialization = (async () => {
      if (globalThis.location?.protocol === 'file:') {
        throw new Error('Open this calculator through its HTTPS website or a localhost web server.');
      }
      reportStatus('Downloading the R runtime…');
      const { WebR, ChannelType } = await import(WEBR_MODULE);
      if (ChannelType.PostMessage === undefined) throw new Error('Pinned WebR communication mode is unavailable.');
      worker = new WebR({
        baseUrl: WEBR_BASE,
        channelType: ChannelType.PostMessage,
        interactive: false,
      });
      await worker.init();
      reportStatus('Loading and verifying the pinned norms tables…');
      const files = await Promise.all(Object.entries(ASSETS).map(([path, hash]) => fetchVerifiedAsset(path, hash)));
      await worker.FS.mkdir('/app');
      await worker.FS.mkdir('/app/r');
      await worker.FS.mkdir('/app/data');
      for (const file of files) await worker.FS.writeFile(`/app/${file.path}`, file.bytes);
      reportStatus('Starting the reviewed R calculations…');
      runtimeSummary = await withShelter(async shelter => {
        const summary = await shelter.evalR(`
          source('/app/r/norms_engine.R')
          source('/app/r/self_checks.R')
          asg_norms <- load_asg_norms('/app')
          list(engine = 'R in browser', r_version = R.version.string,
            growth_rows = nrow(asg_norms$growth), status_rows = nrow(asg_norms$status),
            percentile_method = 'M05', parameter_workbook_sha256 = asg_norms$provenance$ParameterWorkbookSHA256)
        `);
        return { ...plainRValue(await summary.toJs({ depth: 0 })), webR_version: WEBR_VERSION };
      });
      reportStatus('R is ready. Calculations run in this browser.');
      return Object.freeze(runtimeSummary);
    })().catch(error => {
      reportStatus(`R could not start: ${error.message}`);
      throw error;
    });
  }
  return initialization;
}

function inputPayload(inputs = {}) {
  if (inputs == null || typeof inputs !== 'object' || Array.isArray(inputs)) {
    throw new Error('Calculator inputs must be a named object.');
  }
  const payload = {};
  for (const key of Object.keys(DEFAULT_INPUTS)) {
    let value = Object.hasOwn(inputs, key) ? inputs[key] : DEFAULT_INPUTS[key];
    if (value == null) value = '';
    if (key === 'include_actual') {
      if (typeof value !== 'boolean') throw new Error('include_actual must be true or false.');
    } else if (!['string', 'number'].includes(typeof value)) {
      throw new Error(`${key} must be a single number or text value.`);
    }
    payload[key] = value;
  }
  return payload;
}

/**
 * Execute calculate_asg in R, never by interpolating input into R source code.
 * Inputs use snake_case (see RUNTIME.md). Returned objects mirror the R result;
 * warnings is always an array, missing values are null, parameters are scalars.
 */
export async function calculate(inputs = {}) {
  const payload = inputPayload(inputs);
  await initializeR();
  return enqueue(() => withShelter(async shelter => {
    const request = await new shelter.RList(payload);
    const environment = await shelter.evalR('new.env(parent = globalenv())');
    await environment.bind('request', request);
    const result = await shelter.evalR('do.call(calculate_asg, c(list(norms = asg_norms), as.list(request)))', {
      env: environment,
    });
    const plain = plainRValue(await result.toJs({ depth: 0 }));
    plain.warnings = plain.warnings == null ? [] : Array.isArray(plain.warnings) ? plain.warnings : [plain.warnings];
    return plain;
  }));
}

/** Run the actual R engine's 217 independent numeric/source/guard checks.
 * Resolves {passed,total,all_passed,golden_scenarios,independent_numeric_comparisons,checks}; passed is a count.
 * This does not claim visual, mobile, or production validation.
 */
export async function runSelfChecks() {
  await initializeR();
  return enqueue(() => withShelter(async shelter => {
    const result = await shelter.evalR('run_browser_self_checks(asg_norms)');
    return plainRValue(await result.toJs({ depth: 0 }));
  }));
}
