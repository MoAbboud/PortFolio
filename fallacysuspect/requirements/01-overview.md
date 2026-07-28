# fallacysuspect - Overview

Public document. Behaviour only.

## What this is

fallacysuspect reads a debate transcript and marks passages that may contain a logical
fallacy. It reports them as warnings with a confidence level, and it explains what the
named fallacy is. It never states who won the argument and never says a speaker is wrong.

The distinction matters and is the whole design. The tool points at a sentence and says
"this pattern of reasoning is worth a second look". Deciding whether it actually is a
fallacy stays with the reader.

## The problem it addresses

Reading a long transcript for bad reasoning is slow, and people are worse at spotting
fallacies in arguments they agree with. A tool that flags candidates without taking a side
gives the reader somewhere to start without doing their thinking for them.

## What it does

| Capability | Description |
| --- | --- |
| Analyse a transcript | Paste text of any length and get it scanned passage by passage |
| Live progress | A progress bar advances through the text as it is scanned and shifts colour as findings accumulate |
| Highlight in place | The original transcript is shown with the flagged passages marked, so a finding is always read in context |
| Report alongside | A panel lists each finding with the exact quote, the name of the pattern, and a plain definition of it |
| Link the two | Hovering a highlighted passage connects it to its entry in the report |
| Confidence | Each warning carries a confidence level rather than a verdict |
| Charitable reading | Where possible, a finding includes the strongest fair interpretation of the passage |
| History | Past analyses are kept and can be listed again |
| Choose the model | More than one trained model can be installed. A menu picks which one runs, and each report names the model that produced it |
| Command line | The same analysis is available from a terminal for anyone who prefers it |

## Recognised patterns

The tool works from a fixed list of named reasoning patterns, including appeals to emotion,
false dilemma, false causality, slippery slope, ad hominem and faulty generalisation.
Anything outside that list is not reported.

The exact list is defined by the model, not by the application, so it can change when a
better model is installed. The current default model recognises thirteen patterns; an older
model kept alongside it recognises fourteen. The menu that selects a model shows how many
patterns each one knows.

## How to use it

1. Start the application and open it in a browser.
2. Paste a transcript into the box. Speaker labels are fine and are handled.
3. Optionally pick a model from the menu. Left alone it uses the newest one.
4. Press Evaluate and watch the progress bar work through the text.
5. The page turns into two columns without reloading: transcript on the left, report on
   the right, tagged with the model that produced it.
6. Read each warning next to the passage it came from. Hover a highlight to jump to its
   entry.
7. Treat each one as a question, not a ruling.

## What it does not do

- It does not decide who is right. There is no winner, no score per speaker, no summary
  verdict.
- It does not fact-check. A factually false claim that is argued cleanly is not flagged.
- It does not detect sarcasm, rhetoric that is deliberate, or bad faith.
- It does not read audio or video. Text in, text out.
- It does not identify or profile speakers, and it does not collect any information about
  the person using it. No addresses, no location, no analytics. This was decided
  deliberately and is not an oversight.
- It is not accurate enough to be relied on unsupervised. It misses real fallacies and it
  raises some false alarms. Every finding is labelled a warning for that reason.

## Requirements to run it

A machine with a recent Python installed, and a browser. No account, no API key, no
internet connection required once it is set up. Everything is computed locally and nothing
leaves the machine.
