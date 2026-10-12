// Team notes. Read the brief and the interface, ask the client what they did not say, then
// build it here - with your helper, by hand, or both.

export async function handle(request, db) {
  return reply(501, { error: "Not built yet." });
}

function reply(status, body) {
  return { status, body };
}
