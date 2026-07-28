# eval-harness - Overview

Public document. Behaviour only.

## What this is

A test harness for language model output. You give it a set of hand-labelled cases, it
sends each one to a model, records exactly what came back, scores the answers, and stores
the result under a run identifier so runs can be compared to each other.

It exists because a model is an unreliable component. Getting it to answer once proves
nothing. Knowing whether it still answers correctly after the prompt changed, or after the
model version changed, is the useful thing, and that requires a record.

## The task being evaluated

Structured extraction from messy support tickets. A ticket comes in as free text, and the
model is asked to pull out the fields that matter as structured data. The correct answer
for each case is written by hand in advance.

The task was chosen because it has one property that makes evaluation honest: there is a
right answer, and it can be compared field by field rather than judged by feel.

## What it does

| Capability | Description |
| --- | --- |
| Load cases | Reads a file of hand-labelled cases, one per line, with a stable identifier for each |
| Run a model | Sends every case to the model under test and records what came back |
| Preserve raw output | Stores exactly what the model returned, unmodified |
| Score | Applies one or more scorers to each answer, each producing a number and an explanation |
| Store runs | Every run gets an identifier, so the same cases can be run repeatedly and compared |
| Report | Summarise a run and, in time, diff it against an earlier one |

## Why raw output is preserved

The harness does not force the model into a structured output mode. It asks for structured
data and stores whatever text comes back, including malformed answers.

This is deliberate. A harness that guarantees well-formed output cannot measure how often
the model fails to produce well-formed output, which is one of the failure modes worth
measuring. Malformed answers have to be able to reach the scorers for a scorer to catch
them.

## How to use it

1. Write cases into the case file. Each needs a stable identifier, the input text, and the
   correct answer.
2. Supply the model credentials through the environment.
3. Run the harness against the case file.
4. Read the run summary.
5. Change something - the prompt, the model, the case set - run again, and compare.

## What it does not do

- It does not fix or repair model output.
- It does not train or tune anything.
- It does not decide whether a score is good. It reports numbers; you decide.
- It does not run continuously or watch anything. It runs when invoked.
- It is not a benchmark suite. It measures one task against one labelled set.

## Requirements to run it

Python, the model provider's client library, and credentials supplied through an
environment variable. The case loader and the storage layer work without the provider
library installed, so most of the harness can be exercised offline.
