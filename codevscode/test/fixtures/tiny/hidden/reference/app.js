export async function handle(request, db) {
  if (request.path !== "/words") return { status: 404, body: { error: "Not found." } };
  if (request.method === "POST") {
    let input;
    try {
      input = JSON.parse(request.body);
    } catch {
      return { status: 400, body: { error: "Send JSON." } };
    }
    if (typeof input?.word !== "string" || !input.word) return { status: 400, body: { error: "Send a word." } };
    db.run("INSERT INTO words (word) VALUES (?)", [input.word]);
    return { status: 201, body: { word: input.word } };
  }
  const limit = Math.min(Number(request.query.limit ?? 10), 10);
  const rows = db.all("SELECT word FROM words WHERE word >= ? ORDER BY word LIMIT ?", ["", limit]);
  return { status: 200, body: { words: rows.map((row) => row.word) } };
}
