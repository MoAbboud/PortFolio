# Snowball Creator - Build plan

## Objective

A tool that removes the blank page by always offering a next move, and turns the resulting
sequence of moves into something readable.

Version one is built and works. The remaining questions are about honesty and loss: the
prompts are described as something they are not, and there is no persistence at all.

## Order of work

```mermaid
flowchart LR
    S1[1. The loop] --> S2[2. Both views]
    S2 --> S3[3. Get it out]
    S3 --> S4[4. Polish]
    S4 --> S5[5. Fix the description]
    S5 --> S6[6. Stop losing work]
    S6 --> S7[7. Real branching]
```

| Stage | Goal | Done when | Status |
| --- | --- | --- | --- |
| 1 | The core loop | A seed leads to offered directions, a choice extends the chain, and the loop repeats | Done |
| 2 | Both views | The chain renders as a tree and as prose, with a running word count | Done |
| 3 | Get the work out | Export to a file and copy to the clipboard | Done |
| 4 | Polish | Undo, reset, keyboard shortcuts throughout, toasts, animation, mobile layout | Done |
| 5 | Describe it accurately | Nothing anywhere claims the prompts are generated from the writer's text | **Not done. This is the current work** |
| 6 | Stop losing work | Refreshing the page does not destroy the chain | Not started |
| 7 | Real branching | The tree is something the writer can navigate, not just a picture | Not started, and possibly should not be |

### Stage 5 in detail

The prompts are a fixed set of general moves that cycle by position in the chain. Nothing
reads the writer's text. The project's own README currently describes them as generated,
which sets an expectation the app cannot meet and makes the app look broken when it repeats
itself on a long chain.

Two ways to close the gap, and they are not equally good:

1. Correct the description. Cheap, honest, and keeps the app free, offline and private.
2. Actually generate the prompts from the writer's text. This means a model, which means a
   key, a cost, and the writer's text leaving the page. That breaks three of this app's
   properties at once.

The first is recommended. The prompts being general is arguably the feature; a general
prompt makes the writer do the thinking, which is what the tool is for.

### Stage 6 in detail

Refreshing the page currently destroys the chain, silently, with no warning. So does
closing the tab, and so does reset. For a tool a writer is meant to sit inside for twenty
minutes, this is the most likely way it will actually disappoint someone.

The smallest fix that helps: keep the chain in browser storage as it grows, restore it on
load, and offer to discard it. This keeps the app offline and private and needs no server.

## Decisions already made

| Decision | Reason |
| --- | --- |
| The tool offers moves, never content | If it wrote the material it would be a different product, and the writer would stop thinking |
| The prompts are general and fixed | A general prompt makes the writer supply the substance. It also keeps the app free, offline and private |
| The custom option is always available | A fixed prompt list will fail to fit, and the app must not become a dead end when it does |
| The chain is the only state | Both views are derived from it, so undo is one operation on a list rather than two unwindings |
| Views are rebuilt, not mutated | Rebuilding from one source cannot drift. Mutating two displays independently can |
| All animation lives in the style file | Animation driven from code is animation that has to be maintained twice |
| Every timing and constant lives in one configuration object | Tuning the feel of the app should not require reading the logic |
| Selection is a hold, not a click | Slows the choosing down slightly, which suits a tool about thinking. Keyboard selection is immediate, which suits a keyboard |
| Element references cached once | The render path runs on every choice |
| Export is plain text | The next thing that happens to it is a paste into something else |
| No storage, no network, no build step | The page runs from a file, and nothing typed into it leaves it |

## Open questions

| Question | Blocks | Notes |
| --- | --- | --- |
| Correct the description, or actually generate the prompts? | Stage 5 | Generating them costs money, needs a key, and sends the writer's text away. Correcting the description costs a paragraph |
| Should the chain survive a refresh? | Stage 6 | Almost certainly yes. The question is whether restoring is automatic or offered |
| Should reset warn first? | Stage 6 | It destroys unexported work with no confirmation today |
| Is the tree worth keeping if it never branches? | Stage 7 | It is a good-looking picture of a straight line. Either make it branch or stop implying it does |
| Should export be re-importable? | Stage 6 or 7 | Plain text cannot be resumed. A second structured format would fix that and complicate the output |

## Risks

| Risk | Effect if it happens | Response |
| --- | --- | --- |
| A writer loses twenty minutes of work to a refresh | The single most likely bad experience this app can produce | Stage 6 |
| The prompts are expected to respond to the content | The app looks broken when it repeats itself, which it will | Stage 5, by correcting the claim |
| The tree implies branching that does not exist | The writer looks for a way to fork and there is not one | Stage 7, or drop the metaphor |
| Reset is pressed by accident | Everything is gone, with no confirmation and no undo | Warn, and offer an export first |
| The word count is trusted as the writer's own | It includes the connecting phrases the app added, so it reads high | Count the writer's words, or say what is being counted |
