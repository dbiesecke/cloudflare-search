import { parseDocument } from "htmlparser2";

export const parseHtml = (html) => parseDocument(html, { decodeEntities: true });
export const hasClass = (node, name) => (node.attribs?.class || "").split(/\s+/).includes(name);
export function findAll(node, predicate) {
  const result = [];
  function visit(current) {
    if (predicate(current)) result.push(current);
    for (const child of current.children || []) visit(child);
  }
  visit(node);
  return result;
}
export const find = (node, predicate) => findAll(node, predicate)[0];
export function text(node) {
  if (!node || ["script", "style"].includes(node.name)) return "";
  if (node.type === "text") return node.data;
  return (node.children || []).map(text).join(" ").replace(/\s+/g, " ").trim();
}
export function safeUrl(href, base) {
  if (typeof href !== "string" || !href.trim()) return null;
  try {
    const url = new URL(href, base);
    return ["http:", "https:"].includes(url.protocol) && !url.username && !url.password ? url.href : null;
  } catch { return null; }
}
export function providerError(error_type, http_status = null) {
  return Object.assign(new Error("Provider failed."), { error_type, http_status });
}
export function checkResponse(response, document) {
  const challenge = find(document, (node) =>
    ["challenge-form", "captcha-form", "img-form"].includes(node.attribs?.id) ||
    hasClass(node, "anomaly-modal__modal") ||
    (node.name === "form" && /(?:anomaly\.js|captcha)/i.test(node.attribs?.action || "")));
  if (challenge || response.status === 202) throw providerError("blocked", response.status);
  if (!response.ok) throw providerError("http_error", response.status);
}
export function uniqueResults(results) {
  const seen = new Set();
  return results.filter((result) => result.url && result.title && !seen.has(result.url) && seen.add(result.url));
}
