export default [
  {
    id: "house/empty-word",
    category: "practicality",
    claim: "An empty word is accepted.",
    async run(t) {
      t.equal((await t.request("POST", "/words", { body: { word: "" } })).status, 400, "adding an empty word");
    },
  },
];
