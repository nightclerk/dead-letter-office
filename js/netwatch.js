// Network watch: counts every request this page (and the clerk's worker) makes.
// It wraps fetch, XMLHttpRequest, sendBeacon, WebSocket and EventSource, and
// also listens for any other resource load (images, styles, scripts) through
// the Performance API. It can only see this page, not your whole computer,
// which is why the real test is to switch off your internet.

const listeners = new Set();
const state = {
  phase: 'asleep', // asleep | downloading | silent | leak
  since: null,     // time the clerk arrived
  after: [],       // requests made after the clerk arrived
  before: 0,       // requests during download
};

function record(kind, url, bytesOut = 0) {
  let host = '';
  try { host = new URL(url, location.href).host; } catch { host = String(url); }
  if (url && (url.startsWith('blob:') || url.startsWith('data:'))) return; // local, never leaves the device
  const entry = { kind, url: String(url), host, bytesOut, t: performance.now() };
  if (state.since === null) {
    state.before++;
  } else {
    state.after.push(entry);
    state.phase = 'leak';
    console.warn('[netwatch] request after wake:', entry);
  }
  emit();
}

function bodySize(body) {
  if (!body) return 0;
  if (typeof body === 'string') return new Blob([body]).size;
  if (body instanceof Blob) return body.size;
  if (body instanceof ArrayBuffer) return body.byteLength;
  if (ArrayBuffer.isView(body)) return body.byteLength;
  if (body instanceof URLSearchParams) return new Blob([body.toString()]).size;
  return 0;
}

function emit() { for (const fn of listeners) fn(snapshot()); }

export function snapshot() {
  return {
    phase: state.phase,
    afterCount: state.after.length,
    afterBytes: state.after.reduce((s, e) => s + e.bytesOut, 0),
    afterHosts: [...new Set(state.after.map((e) => e.host))],
    beforeCount: state.before,
  };
}

export function onChange(fn) { listeners.add(fn); fn(snapshot()); return () => listeners.delete(fn); }

export function setPhase(phase) {
  if (phase === 'silent' && state.since === null) state.since = performance.now();
  if (state.phase !== 'leak') state.phase = phase;
  emit();
}

// Requests made by the worker are reported to us by message.
export function recordFromWorker(url, method) { record('worker-' + (method || 'GET').toLowerCase(), url); }

export function install() {
  const of = window.fetch.bind(window);
  window.fetch = (input, init = {}) => {
    const url = typeof input === 'string' ? input : input.url;
    record('fetch', url, bodySize(init.body));
    return of(input, init);
  };

  const open = XMLHttpRequest.prototype.open;
  const send = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) { this.__nw = url; return open.call(this, method, url, ...rest); };
  XMLHttpRequest.prototype.send = function (body) { record('xhr', this.__nw, bodySize(body)); return send.call(this, body); };

  if (navigator.sendBeacon) {
    const sb = navigator.sendBeacon.bind(navigator);
    navigator.sendBeacon = (url, data) => { record('beacon', url, bodySize(data)); return sb(url, data); };
  }

  const WS = window.WebSocket;
  window.WebSocket = function (url, protocols) { record('websocket', url); return new WS(url, protocols); };
  window.WebSocket.prototype = WS.prototype;

  if (window.EventSource) {
    const ES = window.EventSource;
    window.EventSource = function (url, cfg) { record('eventsource', url); return new ES(url, cfg); };
    window.EventSource.prototype = ES.prototype;
  }

  // Anything else the browser loads for this page (img, css, script, iframe...).
  // fetch/xhr are already counted above, so skip them here.
  try {
    new PerformanceObserver((list) => {
      for (const e of list.getEntries()) {
        if (e.initiatorType === 'fetch' || e.initiatorType === 'xmlhttprequest' || e.initiatorType === 'beacon') continue;
        if (state.since !== null && e.startTime >= state.since) record('resource:' + e.initiatorType, e.name);
      }
    }).observe({ type: 'resource', buffered: false });
  } catch { /* older browsers */ }
}
