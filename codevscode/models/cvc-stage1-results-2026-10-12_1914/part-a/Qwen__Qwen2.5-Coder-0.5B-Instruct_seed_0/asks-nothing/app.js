// src/utils.js
function reply(status, body) {
  return { status, body };
}

function fail(status, message) {
  return reply(status, { error: message });
}

function notBuilt() {
  return fail(501, "Not built yet.");
}

export function handle(request, db) {
  // Your code here
}
