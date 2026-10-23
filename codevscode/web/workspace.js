// The workspace: one challenge, one attempt. The brief and the questions on the left, the files
// in the middle, the running app on the right. The player's app runs in a worker on the same
// runner and SQLite as the judge; the preview's fetch() calls reach it through the bridge.
//
// Stage 4a: everything but the helper (4b) and the coach (4c).

import { previewDocument, toRequest } from "./bridge.js";
import { escapeHtml, renderMarkdown } from "./markdown.js";

const ANSWER_TIMEOUT_MS = 5000;
const slug = decodeURIComponent(location.pathname.split("/").filter(Boolean).pop());
const $ = (id) => document.getElementById(id);

// Browser storage is a convenience - drafts survive a refresh - and the page works without it.
const store = {
  get(key) {
    try {
      return JSON.parse(localStorage.getItem(key));
    } catch {
      return null;
    }
  },
  set(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Private window or storage blocked: nothing is kept, everything still works.
    }
  },
  remove(key) {
    try {
      localStorage.removeItem(key);
    } catch {}
  },
};

let attempt = null;
let files = {};
let openFile = "app.js";

// The API

async function api(method, path, body) {
  const response = await fetch(path, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(typeof data.detail === "string" ? data.detail : `The server answered ${response.status}.`);
  return data;
}

async function startOrResume(fresh) {
  const saved = fresh ? null : store.get(`cvc:attempt:${slug}`);
  if (saved) {
    try {
      return await api("GET", `/attempts/${saved}`);
    } catch {
      store.remove(`cvc:attempt:${slug}`);
    }
  }
  const started = await api("POST", "/attempts", { challenge: slug });
  store.set(`cvc:attempt:${slug}`, started.id);
  return started;
}

// The app worker

let worker = null;
let nextId = 0;
const pending = new Map();

function freshWorker() {
  if (worker) worker.terminate();
  for (const { reject } of pending.values()) reject(new Error("The app was restarted."));
  pending.clear();
  worker = new Worker("/static/web/app-worker.js");
  // A worker that cannot start (a missing file, a script error) says so here, rather than
  // leaving every request to time out.
  worker.onerror = (event) => {
    event.preventDefault();
    const reason = new Error(`The app runner could not start: ${event.message || "unknown error"}`);
    for (const { reject, timer } of pending.values()) {
      clearTimeout(timer);
      reject(reason);
    }
    pending.clear();
  };
  worker.onmessage = ({ data }) => {
    const waiting = pending.get(data.id);
    if (!waiting) return;
    pending.delete(data.id);
    clearTimeout(waiting.timer);
    data.ok ? waiting.resolve(data) : waiting.reject(new Error(data.error));
  };
}

function send(message) {
  const id = ++nextId;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      freshWorker();
      reject(new Error(`Your app did not answer within ${ANSWER_TIMEOUT_MS / 1000} seconds - an endless loop? It has been stopped; press Run again.`));
    }, ANSWER_TIMEOUT_MS);
    pending.set(id, { resolve, reject, timer });
    worker.postMessage({ id, ...message });
  });
}

// The preview and the bridge

async function run() {
  $("preview-status").textContent = "Starting...";
  freshWorker();
  try {
    await send({ type: "load", files });
    $("preview").srcdoc = previewDocument(files["index.html"]);
    $("preview-status").textContent = "Running. The database starts empty each time you press Run.";
  } catch (error) {
    $("preview").srcdoc = "";
    $("preview-status").textContent = error.message;
  }
}

addEventListener("message", async (event) => {
  const message = event.data;
  if (event.source !== $("preview").contentWindow || !message || message.cvc !== "request") return;
  const answer = (reply) => event.source.postMessage({ cvc: "response", id: message.id, ...reply }, "*");
  try {
    const result = await send({ type: "request", request: toRequest(message, Date.now()) });
    if (result.crashed !== undefined) {
      $("preview-status").textContent = `${message.method} ${message.url} crashed: ${result.crashed}`;
      answer({ status: 500, body: null });
    } else if (!result.response || !Number.isInteger(result.response.status)) {
      $("preview-status").textContent = `handle() answered ${message.method} ${message.url} without a { status, body } object.`;
      answer({ status: 500, body: null });
    } else {
      answer({ status: result.response.status, body: result.response.body ?? null });
    }
  } catch (error) {
    $("preview-status").textContent = error.message;
    answer({ error: error.message });
  }
});

// Try it: the walk-through, crashes only

async function tryIt() {
  const list = $("problems");
  list.innerHTML = '<li class="clean">Checking...</li>';
  if (!worker) freshWorker();
  let problems;
  try {
    ({ problems } = await send({ type: "check", files, smoke: attempt.smoke }));
  } catch (error) {
    problems = [error.message];
  }
  list.innerHTML = problems.length
    ? problems.map((p) => `<li class="problem">${escapeHtml(p)}</li>`).join("")
    : '<li class="clean">No crashes along the walk-through.</li>';
  document.documentElement.dataset.check = problems.length ? `problems:${problems.length}` : "clean";
}

// The editor

function renderTabs() {
  $("tabs").innerHTML = Object.keys(files)
    .map((name) => `<button type="button" role="tab" aria-selected="${name === openFile}" data-file="${escapeHtml(name)}">${escapeHtml(name)}</button>`)
    .join("");
}

function open(name) {
  openFile = name;
  $("editor").value = files[name] ?? "";
  renderTabs();
}

function saveDraft() {
  store.set(`cvc:files:${attempt.id}`, files);
  $("saved").textContent = "Saved in this browser.";
}

$("tabs").addEventListener("click", (event) => {
  const name = event.target.closest("button")?.dataset.file;
  if (name) open(name);
});

$("editor").addEventListener("input", () => {
  files[openFile] = $("editor").value;
  saveDraft();
});

$("editor").addEventListener("keydown", (event) => {
  if (event.key !== "Tab" || event.shiftKey) return;
  event.preventDefault();
  const editor = event.target;
  const { selectionStart: start, selectionEnd: end } = editor;
  editor.setRangeText("  ", start, end, "end");
  editor.dispatchEvent(new Event("input"));
});

$("reset-file").addEventListener("click", () => {
  if (!confirm(`Put ${openFile} back to the starter? Your changes to it are lost.`)) return;
  files[openFile] = attempt.files[openFile] ?? "";
  open(openFile);
  saveDraft();
});

// The client

function renderAnswers() {
  $("answers").innerHTML = attempt.answers.length
    ? attempt.answers.map((a) => `<li>${escapeHtml(a)}</li>`).join("")
    : '<li class="empty">Nothing yet.</li>';
}

$("ask-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const text = $("ask-text").value.trim();
  if (!text) return;
  $("ask-error").textContent = "";
  const button = event.submitter;
  button.disabled = true;
  try {
    const reply = await api("POST", `/attempts/${attempt.id}/questions`, { text });
    const item = document.createElement("li");
    item.innerHTML = `<div class="q">${escapeHtml(text)}</div><div class="a${reply.new ? " unlocked" : ""}">${escapeHtml(reply.reply)}</div>`;
    $("conversation").prepend(item);
    if (reply.new) {
      attempt.answers.push(reply.reply);
      renderAnswers();
    }
    $("ask-text").value = "";
  } catch (error) {
    $("ask-error").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

// The clock

function tick() {
  const end = new Date(attempt.started_at).getTime() + attempt.time_limit_minutes * 60000;
  const left = Math.max(0, end - Date.now());
  const minutes = Math.floor(left / 60000);
  const seconds = Math.floor((left % 60000) / 1000);
  $("clock").textContent = left ? `${minutes}:${String(seconds).padStart(2, "0")}` : "Time is up";
  $("clock").classList.toggle("late", left < 5 * 60000);
}

// Start

$("run").addEventListener("click", run);
$("try").addEventListener("click", tryIt);
$("new-attempt").addEventListener("click", async () => {
  if (!confirm("Start a new attempt? The clock and the client start again, and your files go back to the starter.")) return;
  store.remove(`cvc:files:${attempt.id}`);
  await boot(true);
});

async function boot(fresh = false) {
  try {
    attempt = await startOrResume(fresh);
  } catch (error) {
    $("challenge-title").textContent = error.message;
    return;
  }
  document.title = `${attempt.title} - Code vs Code`;
  $("challenge-title").textContent = attempt.title;
  $("brief").innerHTML = renderMarkdown(attempt.brief);
  $("interface").innerHTML = renderMarkdown(attempt.interface);
  files = { ...attempt.files, ...(store.get(`cvc:files:${attempt.id}`) || {}) };
  $("conversation").innerHTML = "";
  renderAnswers();
  open("app.js");
  tick();
  await tryIt();
  document.documentElement.dataset.ready = "1";
}

setInterval(() => attempt && tick(), 1000);
boot();
