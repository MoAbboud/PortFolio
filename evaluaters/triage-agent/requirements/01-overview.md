# triage-agent - Overview

Public document. Behaviour only.

## What this is

An agent that reads the open issues on a code repository, works out what each one is, and
proposes a label or a comment. It never applies anything without being asked first. Every
change to the repository is confirmed by a person, one at a time.

The interesting part is not that a model can pick a tool. It is the policy around the
picking: what the agent is allowed to do on its own, what it must ask about, how many steps
it gets, and what happens when it asks for something that does not make sense.

## The problem it addresses

Issue triage is repetitive and someone always stops doing it. Handing it to an automated
agent is easy to demonstrate and hard to trust, because an agent with write access to a
repository can make a mess quickly and at scale. This project is about making the second
part safe rather than making the first part impressive.

## What it does

| Capability | Description |
| --- | --- |
| Read open issues | Lists what is currently open on the configured repository |
| Read one issue | Fetches a single issue in full |
| Propose a label | Suggests a label for an issue and applies it only after confirmation |
| Propose a comment | Drafts a comment and posts it only after confirmation |
| Stop on its own | Gives up after a fixed number of steps rather than looping |
| Survive its own mistakes | A tool called with a nonsensical argument returns an error the agent can read and react to, instead of crashing the run |

Reading is free. Writing is gated. That split is the design.

## How to use it

1. Supply a repository and an access token through the environment.
2. Check that the credentials work before running anything that writes.
3. Start a run against the repository.
4. The agent reads issues and proposes actions.
5. Every action that changes the repository stops and asks. Answer yes or no.
6. The run ends when the work is done or the step limit is reached, whichever comes first.

## What it does not do

- It does not close, reopen, assign, or edit issues.
- It does not create or delete labels, only applies existing ones.
- It does not act without confirmation. There is no unattended mode and adding one would
  be a change of scope, not a convenience feature.
- It does not run continuously or watch a repository.
- It does not touch code, branches, or pull requests.
- It does not decide the safety policy for itself. The policy was written before any agent
  code existed and the agent operates inside it.

## Requirements to run it

Python, a repository you have permission to write to, and an access token supplied through
an environment variable. The tool layer is fully testable offline, so the tests need no
network and no token.
