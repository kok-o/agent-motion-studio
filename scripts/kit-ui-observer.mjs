// Passive, portable evidence for the installed-kit UI check. Never retain URLs,
// headers, bodies, console text, document titles or user paths in this report.
const names = new Set(['Error', 'AssertionError', 'TypeError', 'RangeError', 'SyntaxError', 'TimeoutError', 'ProtocolError', 'TargetCloseError']);
const codes = new Set(['ERR_ASSERTION', 'ERR_IPC_CHANNEL_CLOSED', 'ERR_IPC_DISCONNECTED', 'ENOENT', 'EACCES', 'EPERM', 'ECONNREFUSED', 'ECONNRESET', 'ETIMEDOUT']);
export function safeError(error) {
  const name = names.has(error?.name) ? error.name : 'Error';
  const message = typeof error?.message === 'string' ? error.message : '';
  // Error strings can contain arbitrary project text, complete session URLs and
  // paths with spaces. An allowlist is safer than incomplete redaction regexes.
  let portable = 'Diagnostic detail withheld; see the failing stage and error type';
  if (/^Navigation timeout of \d{1,7} ms exceeded$/.test(message)) portable = message;
  else if (/^Waiting failed: \d{1,7}ms exceeded$/.test(message)) portable = message;
  else if (message === 'studio startup timeout' || message === 'studio stopped before readiness') portable = message;
  else if (name === 'AssertionError') portable = 'Verification assertion failed';
  else if (name === 'TargetCloseError' || /Target closed|Session closed|Connection closed/.test(message)) portable = 'Browser target or connection closed';
  else if (name === 'TimeoutError') portable = 'Bounded operation timed out';
  return { name, message: portable, ...(codes.has(error?.code) ? { code: error.code } : {}) };
}

const resources = new Set(['document', 'stylesheet', 'image', 'media', 'font', 'script', 'texttrack', 'xhr', 'fetch', 'eventsource', 'websocket', 'manifest', 'other']);
const methods = new Set(['GET', 'POST', 'HEAD', 'OPTIONS', 'PUT', 'PATCH', 'DELETE']);
const consoleTypes = new Set(['log', 'debug', 'info', 'error', 'warning', 'warn', 'dir', 'trace', 'assert', 'clear', 'count', 'timeEnd', 'table', 'verbose']);
const networkFailures = new Set(['net::ERR_ABORTED', 'net::ERR_FAILED', 'net::ERR_CONNECTION_CLOSED', 'net::ERR_CONNECTION_REFUSED', 'net::ERR_CONNECTION_RESET', 'net::ERR_EMPTY_RESPONSE', 'net::ERR_TIMED_OUT', 'net::ERR_INTERNET_DISCONNECTED', 'net::ERR_NAME_NOT_RESOLVED', 'net::ERR_NETWORK_CHANGED', 'net::ERR_BLOCKED_BY_CLIENT', 'net::ERR_BLOCKED_BY_RESPONSE']);
function requestClass(request) {
  let path;
  try { path = new URL(request.url()).pathname; } catch { return 'other'; }
  if (path === '/api/session') return 'session';
  if (path === '/api/state') return 'state';
  if (path.startsWith('/api/generation/')) return 'generation';
  if (path.startsWith('/media/') || path.startsWith('/exports/') || path.startsWith('/previews/')) return 'media';
  if (request.resourceType() === 'document') return 'document';
  if (['/', '/app.js', '/i18n.js', '/generation-ui.js', '/style.css'].includes(path)) return 'static';
  return 'other';
}

function readDom({ expectedTitle, expectedExports, currentText }) {
  const title = document.getElementById('project-title');
  const exports = document.getElementById('exports');
  const status = document.getElementById('export-state');
  const player = document.getElementById('player');
  const notice = document.getElementById('notice');
  const titleText = title?.textContent?.trim() ?? '';
  const count = exports?.options?.length ?? null;
  return {
    readyState: ['loading', 'interactive', 'complete'].includes(document.readyState) ? document.readyState : 'unknown',
    titlePresent: Boolean(titleText), titleMatches: titleText === expectedTitle,
    documentTitleMatches: document.title === `${expectedTitle} · Agent Motion Studio`,
    exportsCount: count, exportsMatch: expectedExports === undefined ? null : count === expectedExports,
    selectedExport: Boolean(exports?.value), statusPresent: Boolean(status?.textContent?.trim()),
    currentVersion: status?.textContent === currentText, playerSource: Boolean(player?.getAttribute('src')),
    noticeError: Boolean(notice?.classList.contains('error')),
    media: Array.from(document.querySelectorAll('video,audio')).slice(0, 32).map((node, index) => ({
      index, role: node.id === 'player' ? 'player' : node.closest('#source-preview') ? 'source-preview' : node.closest('#storyboard') ? 'storyboard' : 'other',
      readyState: Number.isInteger(node.readyState) ? node.readyState : null,
      networkState: Number.isInteger(node.networkState) ? node.networkState : null,
      errorCode: Number.isInteger(node.error?.code) ? node.error.code : null,
      paused: Boolean(node.paused), seeking: Boolean(node.seeking),
      duration: Number.isFinite(node.duration) ? node.duration : null,
      currentTime: Number.isFinite(node.currentTime) ? node.currentTime : null,
    })),
  };
}

/** Attach before goto. This records evidence; it never changes the navigation gate. */
export function observeKitPage(page, report, label, { expectedTitle = 'film', expectedExports, currentText = 'Текущая версия', maxEvents = 160, maxPending = 256, snapshotTimeout = 2000 } = {}) {
  const start = performance.now(), clock = () => Math.round(performance.now() - start);
  const trace = { label, lifecycle: {}, events: [], eventsDropped: 0, requests: { started: 0, finished: 0, failed: 0, inFlight: 0, peak: 0, pending: [], pendingOmitted: 0 }, api: {}, diagnostics: { pageErrors: [], console: {}, pageCrashed: false, pageClosed: false, browserDisconnected: false, observerErrors: 0 } };
  (report.ui ??= []).push(trace);
  const eventLimit = Math.max(1, Math.min(1000, maxEvents)), pendingLimit = Math.max(1, Math.min(1000, maxPending));
  const pending = new Map(), known = new WeakMap(), listeners = [];
  let serial = 0, detached = false;
  function event(type, detail = {}) {
    if (trace.events.length < eventLimit) trace.events.push({ atMs: clock(), type, ...detail });
    else trace.eventsDropped++;
  }
  function listen(target, type, callback) {
    if (!target?.on) return;
    const guarded = (...args) => { try { callback(...args); } catch { trace.diagnostics.observerErrors++; } };
    target.on(type, guarded); listeners.push([target, type, guarded]);
  }
  function started(request) {
    if (known.has(request)) return known.get(request);
    const type = request.resourceType(), method = request.method();
    const entry = { id: ++serial, class: requestClass(request), resourceType: resources.has(type) ? type : 'other', method: methods.has(method) ? method : 'OTHER', startedMs: clock(), status: null, done: false };
    known.set(request, entry); trace.requests.started++; trace.requests.inFlight++;
    trace.requests.peak = Math.max(trace.requests.peak, trace.requests.inFlight);
    if (pending.size < pendingLimit) pending.set(request, entry);
    event('request', { id: entry.id, class: entry.class, resourceType: entry.resourceType, method: entry.method });
    return entry;
  }
  function ended(request, failed) {
    const entry = known.get(request);
    if (!entry || entry.done) return;
    entry.done = true; pending.delete(request); trace.requests.inFlight--;
    trace.requests[failed ? 'failed' : 'finished']++;
    const reason = failed ? request.failure?.()?.errorText : undefined;
    event(failed ? 'request-failed' : 'request-finished', { id: entry.id, class: entry.class, status: entry.status, ...(failed ? { failureCode: networkFailures.has(reason) ? reason : 'unavailable' } : {}) });
  }
  listen(page, 'request', started);
  listen(page, 'response', response => {
    const entry = known.get(response.request()); if (!entry) return;
    const status = response.status(); entry.status = Number.isInteger(status) && status >= 100 && status <= 599 ? status : null;
    if (['session', 'state', 'generation', 'document'].includes(entry.class)) {
      const api = trace.api[entry.class] ??= { responses: 0, lastStatus: null, failedResponses: 0 };
      api.responses++; api.lastStatus = entry.status; if (entry.status >= 400) api.failedResponses++;
    }
    event('response', { id: entry.id, class: entry.class, status: entry.status });
  });
  listen(page, 'requestfinished', request => ended(request, false));
  listen(page, 'requestfailed', request => ended(request, true));
  for (const type of ['domcontentloaded', 'load']) listen(page, type, () => { trace.lifecycle[type] = clock(); event(type); });
  listen(page, 'framenavigated', frame => { if (frame === page.mainFrame()) { trace.lifecycle.mainFrameNavigated = clock(); event('main-frame-navigated'); } });
  listen(page, 'pageerror', error => { if (trace.diagnostics.pageErrors.length < 16) trace.diagnostics.pageErrors.push(safeError(error)); event('page-error'); });
  listen(page, 'console', message => { const type = consoleTypes.has(message.type()) ? message.type() : 'other'; trace.diagnostics.console[type] = (trace.diagnostics.console[type] ?? 0) + 1; event('console', { level: type }); });
  listen(page, 'error', () => { trace.diagnostics.pageCrashed = true; event('page-crashed'); });
  listen(page, 'close', () => { trace.diagnostics.pageClosed = true; event('page-closed'); });
  let browser;
  try { browser = page.browser(); } catch { trace.diagnostics.observerErrors++; }
  listen(browser, 'disconnected', () => { trace.diagnostics.browserDisconnected = true; event('browser-disconnected'); });
  return {
    trace,
    async snapshot({ failure = false } = {}) {
      trace.capturedAtMs = clock();
      trace.requests.pending = Array.from(pending.values()).map(({ id, class: kind, resourceType, method, startedMs, status }) => ({ id, class: kind, resourceType, method, ageMs: Math.max(0, clock() - startedMs), status }));
      trace.requests.pendingOmitted = Math.max(0, trace.requests.inFlight - pending.size);
      let timer; delete trace.dom;
      try {
        trace.dom = await Promise.race([
          page.evaluate(readDom, { expectedTitle, expectedExports, currentText }),
          new Promise((_, reject) => { timer = setTimeout(() => reject(Object.assign(new Error('snapshot deadline'), { name: 'TimeoutError' })), Math.max(1, Math.min(5000, snapshotTimeout))); }),
        ]);
        trace.domObservedAtMs = clock(); delete trace.snapshotError;
      } catch (error) { trace.snapshotError = safeError(error); }
      finally { clearTimeout(timer); }
      // Cleanup and a recovering page may change the latest observation. Keep
      // the first failure-time DOM, pending requests and counters immutable.
      if (failure && !trace.failureSnapshot) trace.failureSnapshot = structuredClone(trace);
      return trace;
    },
    detach() {
      if (detached) return; detached = true;
      for (const [target, type, callback] of listeners) target.off(type, callback);
      pending.clear();
    },
  };
}

// The thrown object remains the original failure even if cleanup or persistence
// also fails. All cleanup callbacks run, and their failures stay separate.
export async function runWithCleanup({ run, cleanups = [], report, save = async () => {} }) {
  let value, primary, hasPrimary = false;
  const failed = error => { report.status = 'failed'; report.failure = safeError(error); };
  async function persist() {
    try { await save(); } catch (error) {
      (report.evidenceErrors ??= []).push(safeError(error));
      if (!hasPrimary) { primary = error; hasPrimary = true; failed(error); }
    }
  }
  try { value = await run(); } catch (error) { primary = error; hasPrimary = true; failed(error); await persist(); }
  for (const cleanup of cleanups) {
    try { await cleanup.run(); } catch (error) {
      (report.cleanupErrors ??= []).push({ label: cleanup.label, ...safeError(error) });
      if (!hasPrimary) { primary = error; hasPrimary = true; failed(error); }
    }
  }
  await persist();
  if (hasPrimary) throw primary;
  return value;
}
