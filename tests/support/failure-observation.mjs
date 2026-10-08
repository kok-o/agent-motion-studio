// Test-only observations: redact private prefixes, preserving the operation and
// fixture-relative paths. Never derive an errno from prose or an assertion.
export function safeText(value, roots = []) {
  let text = String(value).replaceAll('\\', '/');
  text = text.replace(/(?:https?|file):\/\/[^\s'"<>]+/gi, '<redacted-url>');
  for (const [root, label] of roots) {
    const escaped = root.replaceAll('\\', '/').replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    text = text.replace(new RegExp(escaped, process.platform === 'win32' ? 'gi' : 'g'), label);
  }
  text = text.replace(/\b(?:sk-(?:proj-|ant-)?[a-z0-9_-]+|gh[pousr]_[a-z0-9_]+)\b/gi, '<redacted-secret>');
  text = text.replace(/\b(token|api[_-]?key|password|secret|authorization)\s*[:=]\s*(?:Bearer\s+)?[^\s,;]+/gi, '$1=<redacted-secret>');
  text = text.replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer <redacted-secret>');
  return text.replace(/(^|[\s'"(=])(?:[a-z]:\/|\/)[^'"\r\n]*/gi, '$1<external-path>');
}

export function suppliedError(error, roots) {
  return Object.fromEntries(['code', 'syscall', 'path', 'dest', 'message'].map(key => [key,
    error?.[key] === undefined ? 'not-supplied' : safeText(error[key], roots)
  ]));
}

export async function probeStates(probes, roots) {
  const states = {};
  for (const [name, probe] of Object.entries(probes)) {
    try { states[name] = await probe(); }
    catch (error) { states[name] = { unavailable: suppliedError(error, roots) }; }
  }
  return states;
}
