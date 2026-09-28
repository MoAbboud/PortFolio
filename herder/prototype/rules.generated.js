// GENERATED FILE - do not edit by hand.
//
// Written by prototype/generate.py from herder's Python rules, so the browser and the
// real pipeline cannot drift apart. Regenerate after changing any extraction or render
// rule; prototype/tests/test_parity.py fails while this file is stale.
//
// Patterns are {source, flags} and become RegExp objects in herder.js. They are the
// Python sources verbatim.

export const RULES = {
  "generatedFrom": "herder/herder/{extractors/heuristic,domain/sentences,domain/render,domain/residue,domain/merge}.py",
  "sentenceSplit": {
    "source": "(?<=[.!?])\\s+|\\n+",
    "flags": ""
  },
  "fence": {
    "source": "```.*?```",
    "flags": "s"
  },
  "rules": [
    {
      "kind": "decision",
      "layer": "project",
      "why": "an explicit reversal of something said earlier",
      "confidence": 0.66,
      "pattern": {
        "source": "\\b(change of plan|changed my mind|change to|scrap (?:that|the|what)|forget (?:that|the|what)|disregard|ignore what i said|correction|i'm changing|i am changing|revis(?:e|ing|ed)|swap (?:one|that|the)|no longer|after all|instead of what i said|from what i said|(?:from|than) (?:earlier|before)|(?:said|gave|mentioned|described|told you) (?:you )?(?:earlier|before)|(?:earlier|before) (?:is|was) (?:off|out|wrong)|is off\\b)",
        "flags": "i"
      }
    },
    {
      "kind": "open_thread",
      "layer": "session",
      "why": "explicitly unfinished",
      "confidence": 0.58,
      "pattern": {
        "source": "\\b(still need|still have to|still to|not yet|todo|to do|open question|haven't|have not|yet to|remains to be|come back to)\\b",
        "flags": "i"
      }
    },
    {
      "kind": "identity",
      "layer": "stable",
      "why": "something durable about the user",
      "confidence": 0.55,
      "pattern": {
        "source": "\\b(i am a|i'm a|my name is|i work (?:at|as|on)|our team|my role|i'm the)\\b",
        "flags": "i"
      }
    },
    {
      "kind": "preference",
      "layer": "stable",
      "why": "a stated preference about how to work",
      "confidence": 0.55,
      "pattern": {
        "source": "\\b(i prefer|i'd rather|i would rather|i like|i don't like|i dislike|i hate|please always|please never|my preference)\\b",
        "flags": "i"
      }
    },
    {
      "kind": "constraint",
      "layer": "project",
      "why": "a prohibition or limit stated by its determiner",
      "confidence": 0.6,
      "pattern": {
        "source": "^(?:no|nothing|nobody|no one|none of|only)\\s+(?!thanks\\b|problem\\b|worries\\b|idea\\b|rush\\b|need\\b|pressure\\b|way\\b|doubt\\b)[a-z]",
        "flags": "i"
      }
    },
    {
      "kind": "constraint",
      "layer": "project",
      "why": "modal obligation or prohibition",
      "confidence": 0.62,
      "pattern": {
        "source": "\\b(must not|must|never|always|cannot|can't|can not|do not|don't|has to|have to|needs to|need to|required|mandatory|under no circumstances|only ever|no more than)\\b|\\b(?:doesn't|does not|won't|will not|may not)\\s+[a-z]",
        "flags": "i"
      }
    },
    {
      "kind": "decision",
      "layer": "project",
      "why": "a choice stated as settled",
      "confidence": 0.6,
      "pattern": {
        "source": "\\b(we(?:'| a)?re going to|we will|we'll|we use|we're using|we are using|let's|lets|decided|decision is|going with|switch(?:ing)? to|stick with|stay(?:ing)? on|i chose|we chose|we picked|instead of)\\b",
        "flags": "i"
      }
    },
    {
      "kind": "open_thread",
      "layer": "session",
      "why": "something left unfinished",
      "confidence": 0.5,
      "pattern": {
        "source": "\\b(todo|to do|next step|still need|still have to|remaining|open question|not yet|we should|haven't|have not|later on|come back to)\\b",
        "flags": "i"
      }
    },
    {
      "kind": "fact",
      "layer": "project",
      "why": "a plain statement of how things are",
      "confidence": 0.45,
      "pattern": {
        "source": "^(?!(?:can|could|would|should|do|does|did|what|why|how|when|where|which|who|please|tell me|explain|give me|show me|help me|walk me|remind me|assume|let me|thanks|thank you|ok|okay|yes|sure|great|hmm|that(?:'s| is| was)|it(?:'s| is| was)|this(?:'s| is| was)|those|these|they(?:'re| are)|i want (?:to (?:understand|know|see|learn)|you|your)|i'd like (?:to|you|your|help)|i would like)\\b)(?!.*[?:]\\s*$)(?!.*\\b(?:short|long|brief|quick|detailed|full|your)\\s+(?:answer|reply|response)\\b)(?!.*\\b(?:answer|reply|response)\\s+is\\s+fine\\b)(?!(?:i'm|i am|we're|we are)\\s+(?:thinking|wondering|trying|hoping|looking|curious|asking|guessing|not sure)\\b)(?:(?:i'm|i am|we're|we are|i've been|we've been)\\s+\\w+ing\\b|(?=.*\\b(?:is|are|am|was|were|will\\s+be|has|have|had|uses?|gets?|takes?|makes?|keeps?|holds?|runs?|goes?|comes?|sits?|stays?|lives?|works?|opens?|closes?|costs?|pays?|starts?|ends?|covers?|handles?|owns?|means?|counts?|allows?|requires?|includes?|follows?|happens?|tracks?|reports?)\\b))",
        "flags": "i"
      }
    }
  ],
  "prohibitionOpening": {
    "source": "^(?:no|nothing|nobody|no one|none of|only)\\s+(?!thanks\\b|problem\\b|worries\\b|idea\\b|rush\\b|need\\b|pressure\\b|way\\b|doubt\\b)[a-z]",
    "flags": "i"
  },
  "anaphoricRejection": {
    "source": "^(?:i|we)\\s+(?:do\\s+not|don't|dont|did\\s+not|didn't|will\\s+not|won't|cannot|can't)\\s+(?:want|like|need|think|accept)\\s+(?:that|this|it|those|these|them|either|any\\s+of\\s+(?:that|this|it|those|these|them))\\b",
    "flags": "i"
  },
  "refusalWithAnaphor": {
    "source": "^(?:no[.,!]?\\s+)?not\\b.{0,44}?\\b(?:that|this|it)\\s+(?:is|are|was|were|'s)\\b",
    "flags": "i"
  },
  "emptyRather": {
    "source": "\\b(?:i'd|i would)\\s+rather\\s+not\\s*(?:[,.!;]|$|thanks|thank you)",
    "flags": "i"
  },
  "pathy": {
    "source": "[\\w./-]+\\.(py|ts|tsx|js|sql|md|json|yml|yaml|toml|cfg|html|css|sh|ps1)\\b",
    "flags": ""
  },
  "changeCue": {
    "source": "\\b(change of plan|changed my mind|change to|scrap (?:that|the|what)|forget (?:that|the|what)|disregard|ignore what i said|correction|i'm changing|i am changing|revis(?:e|ing|ed)|swap (?:one|that|the)|no longer|after all|instead of what i said|from what i said|(?:from|than) (?:earlier|before)|(?:said|gave|mentioned|described|told you) (?:you )?(?:earlier|before)|(?:earlier|before) (?:is|was) (?:off|out|wrong)|is off\\b)",
    "flags": "i"
  },
  "residueQuestion": {
    "source": "\\?\\s*$",
    "flags": ""
  },
  "minSentenceChars": 20,
  "minProhibitionChars": 10,
  "minResidueChars": 10,
  "titleMax": 80,
  "extractorModel": "rules-v2",
  "priority": {
    "constraint": 0,
    "decision": 1,
    "open_thread": 2,
    "preference": 3,
    "identity": 3,
    "code_state": 4,
    "glossary": 5,
    "fact": 5,
    "artifact_ref": 6
  },
  "kindOrder": [
    "constraint",
    "decision",
    "open_thread",
    "preference",
    "identity",
    "code_state",
    "glossary",
    "fact",
    "artifact_ref"
  ],
  "layerOrder": [
    "stable",
    "project",
    "session"
  ],
  "layerHeadings": {
    "stable": "## Stable",
    "project": "## Project",
    "session": "## Session (most recent)"
  },
  "tailReserve": 0.1,
  "residueKind": "unsorted",
  "residueHeading": "## Also said (unsorted, lowest confidence)",
  "codeStateConfidence": 0.5,
  "fullSystem": {
    "extractModel": "qwen2.5:3b",
    "embedModel": "all-minilm",
    "nliModel": "cross-encoder/nli-deberta-v3-base"
  }
};

export default RULES;
