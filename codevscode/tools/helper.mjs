// The helper's prompt and reply handling, for programs that are not JavaScript - the Python
// harness on Colab. JSON in on stdin, JSON out on stdout:
//
//   {"op": "messages", ...buildMessages arguments}  ->  [{role, content}, ...]
//   {"op": "parse", "text": "...", "allowed": [...]}  ->  {files, prose, skipped}
//   {"op": "condense", "text": "..."}                 ->  "..."
//
// One JavaScript implementation, so the harness measures a model on the same prompt the game
// gives it.

import { buildMessages, condenseReply } from "../helper/prompt.js";
import { parseReply } from "../helper/reply.js";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const request = JSON.parse(Buffer.concat(chunks).toString("utf8"));

let result;
switch (request.op) {
  case "messages":
    result = buildMessages(request);
    break;
  case "parse":
    result = parseReply(request.text, request.allowed);
    break;
  case "condense":
    result = condenseReply(request.text);
    break;
  default:
    console.error(`unknown op ${JSON.stringify(request.op)}`);
    process.exit(2);
}
process.stdout.write(JSON.stringify(result));
