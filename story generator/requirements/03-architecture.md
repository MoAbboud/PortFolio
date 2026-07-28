# Breakdown Takes - Architecture

Internal document.

## Two implementations

There are two versions of this app in the folder, and knowing which is which matters before
editing either.

| File | What it is | Status |
| --- | --- | --- |
| `breakdown-takes.html` | A single self-contained page in plain JavaScript. Opens from the file system, no build step, no dependencies | The working version. This is what gets used |
| `breakdown-takes-generator.jsx` | The same app as a React component | A parallel implementation. Needs a React host, which the repository does not provide |

They share the layout algorithm, the role colours and the worked example, and they have
drifted apart in the details. The plain page has the tracking-row export; the component
does not.

Two implementations of one app is a maintenance cost with no benefit. A fix applied to one
does not reach the other, and nothing signals the divergence. The plan lists choosing one
as an open item, with the plain page the obvious survivor since it satisfies the repository's
standing constraint of running from a file with nothing installed.

The rest of this document describes the plain page.

## Components

```mermaid
flowchart LR
    subgraph page[One browser tab]
        ED[Editor view<br/>the story description]
        VAL[Validation]
        LAY[Layout algorithm]
        BOARD[The board<br/>nodes and connectors]
        CTRL[Playback controls]
        TRK[Tracking row export]
    end
    ED --> VAL --> LAY --> BOARD
    CTRL --> BOARD
    ED --> TRK --> FILE[(Spreadsheet file)]
```

The app has exactly two views and moves between them explicitly. The editor holds the
description; the board holds the drawing. Going back to the editor preserves the
description, because recording is iterative and the story gets edited between takes.

## The layout algorithm

The only interesting logic in the app. It turns a list of beats and their parent links into
coordinates, with nothing positioned by hand.

```mermaid
flowchart TB
    IN[Beats, each with a parent] --> CHILD[Build a map of parent to children]
    CHILD --> ROOTS[Find the beats with no parent]
    ROOTS --> DEPTH[Walk down from each root, assigning a depth]
    DEPTH --> GROUP[Group the beats by depth]
    GROUP --> Y[Vertical position comes from depth,<br/>spread evenly across the available height]
    GROUP --> X[Horizontal position comes from position within the depth group,<br/>spread evenly, or centred if alone]
    Y --> OUT[Coordinates as percentages]
    X --> OUT
```

Positions are percentages rather than pixels, so the same layout works at any board size
and the drawing survives a window resize without being recomputed from the story.

The consequences worth knowing:

- Depth is derived from the parent chain, so the vertical axis is the passage of the story.
- Beats that share a depth sit side by side, so a branch reads as two things happening at
  once.
- A beat pointing at a parent that does not exist is never reached by the walk and will not
  be laid out. This is why validation runs first.

## Reveal and playback

The board draws a prefix of the beats: everything up to a visible count. Playback advances
that count on a timer.

```mermaid
stateDiagram-v2
    [*] --> Editing
    Editing --> Ready: generate, after validation passes
    Ready --> Playing: play
    Playing --> Paused: pause
    Paused --> Playing: play
    Playing --> Ready: reset
    Paused --> Ready: reset
    Paused --> Paused: step forward one beat
    Playing --> Complete: last beat revealed
    Complete --> Ready: reset
    Ready --> Editing: back to the editor
    Complete --> Editing: back to the editor
```

Reveal being a count rather than a queue of animations is what makes step, reset and reveal-all
trivial: each is just a different value for one number, and the board is redrawn from it.

The control bar hides itself while playback runs. If it did not, it would be in the
recording, and the recording is the product.

## Class diagram

The plain page is functions over shared state rather than classes. The diagram describes
the structure as it is, grouped by responsibility, so the seams are visible.

```mermaid
classDiagram
    direction TB

    class Story {
        +title
        +subreddit
        +author
        +verdict
        +nodes: Beat[]
    }

    class Beat {
        +id
        +text
        +type
        +parent
    }

    class PositionedBeat {
        +id
        +text
        +type
        +parent
        +x  "percent"
        +y  "percent"
    }

    class TypeColors {
        <<constants>>
        +context
        +escalation
        +conflict
        +action
        +reaction
        +verdict
    }

    class Editor {
        +generateTree()
        +showError(message)
        +goEditor()
        +switchToPreview()
    }

    class Layout {
        +autoLayout(beats) PositionedBeat[]
        +getCenter(beat) Point
    }

    class Board {
        +setupPreview()
        +buildLegend()
        +renderFull()
        +renderTree()
        +appendOne()
        +drawNode(beat)
        +setBoardHeight()
    }

    class Playback {
        +play()
        +pause()
        +tick()
        +stepForward()
        +resetTree()
        +getSpeed() int
        +syncUI()
    }

    class ControlBar {
        +showBar()
        +autoHideBar()
    }

    class Tracker {
        +saveToCSV()
        +csvCell(value) string
    }

    Editor --> Story
    Story "1" --> "many" Beat
    Layout ..> Beat
    Layout ..> PositionedBeat : produces
    Board --> PositionedBeat
    Board --> TypeColors
    Playback --> Board
    ControlBar --> Playback
    Tracker --> Story
```

## Key sequence - recording a take

```mermaid
sequenceDiagram
    actor N as Narrator
    participant E as Editor
    participant V as Validation
    participant L as Layout
    participant B as Board
    participant P as Playback
    participant R as Screen recorder

    N->>E: write or edit the beats
    N->>E: generate
    E->>V: check the description
    alt malformed
        V-->>N: what is wrong, nothing drawn
    else valid
        V->>L: beats with their parents
        L-->>B: coordinates as percentages
        B-->>N: full tree, for checking the layout
        N->>P: reset, choose a pace
        N->>R: start recording
        N->>P: play
        loop each beat
            P->>B: raise the visible count by one
            B-->>N: the next beat appears
            Note over N: narrates over it
        end
        N->>R: stop recording
    end
```

## Rules this architecture is meant to protect

- Nothing is positioned by hand. If a layout looks wrong, the algorithm is wrong or the
  story structure is wrong.
- Validation runs before anything is drawn. A half-drawn tree wastes a take.
- Positions are percentages. Resizing must not require recomputing the layout from the
  story.
- The visible count is the only playback state. Step, reset and reveal-all are values for
  one number, not separate code paths.
- Controls hide themselves during playback, because they would otherwise be in the video.
- Going back to the editor preserves the description.
- Role colours are defined once and drive both the nodes and the legend.
- The page runs from a file with no build step and no network call.
