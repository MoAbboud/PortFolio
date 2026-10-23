// The preview runs the player's index.html in a sandboxed iframe with no origin of its own.
// Its fetch() calls cannot reach a server - there is none for the app - so a small script
// injected at the top of the page turns each call into a message to the workspace, which hands
// it to the player's app in a worker and sends the answer back. No DOM at import: tested in Node.

/** The script injected into the preview. It replaces fetch() and nothing else. */
export const BRIDGE = `<script>
(() => {
  let next = 0;
  const waiting = new Map();
  addEventListener("message", (event) => {
    const m = event.data;
    if (event.source === parent && m && m.cvc === "response" && waiting.has(m.id)) {
      waiting.get(m.id)(m);
      waiting.delete(m.id);
    }
  });
  window.fetch = (input, options = {}) => new Promise((resolve, reject) => {
    const id = ++next;
    const headers = {};
    new Headers(options.headers || {}).forEach((value, name) => { headers[name] = value; });
    waiting.set(id, (m) => {
      if (m.error) return reject(new TypeError(m.error));
      const body = m.status === 204 || m.body === null || m.body === undefined ? null : JSON.stringify(m.body);
      resolve(new Response(body, { status: m.status, headers: { "content-type": "application/json" } }));
    });
    parent.postMessage({ cvc: "request", id, url: String(input), method: options.method || "GET", headers,
      body: typeof options.body === "string" ? options.body : "" }, "*");
  });
})();
</script>`;

/** The player's index.html with the bridge in front of everything else it runs. */
export function previewDocument(indexHtml) {
  const html = String(indexHtml || "");
  const head = /<head[^>]*>/i.exec(html);
  if (head) return html.slice(0, head.index + head[0].length) + BRIDGE + html.slice(head.index + head[0].length);
  return BRIDGE + html;
}

/** A bridge message as the app's request object, the same shape the runner and judge use. */
export function toRequest(message, time) {
  const url = new URL(message.url, "http://app.local");
  const headers = {};
  for (const [name, value] of Object.entries(message.headers || {})) headers[name.toLowerCase()] = String(value);
  return {
    method: String(message.method || "GET").toUpperCase(),
    path: url.pathname,
    query: Object.fromEntries(url.searchParams),
    headers,
    body: typeof message.body === "string" ? message.body : "",
    time,
  };
}
