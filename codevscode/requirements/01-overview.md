# codevscode - Overview

Public document. Behaviour only.

## What this is

Code vs Code is a game for two coders who get the same small app to build. Each one has a
helper, an AI coding assistant they name themselves, and the helper writes the code.

Typing speed does not win it, and neither does code that merely runs. The app is judged
against the checklist a quality analyst would use: is it secure, is it efficient, is it
practical for the people who will use it, does it do what the client actually needed. The
player wins by doing the parts of the job that a helper cannot do for them: asking the right
questions, catching what the helper got wrong, finding the bugs in the other player's app,
and defending their own.

## How a match goes

1. **The brief.** A short request from a client - a sign-up page, a booking list, a shared
   shopping list. It is vague on purpose, the way real requests are.
2. **Ask.** The client knows things the brief does not say: how many people will use it,
   who must not see what, what happens when something goes wrong. The client answers what it
   is asked and volunteers nothing else. Everything it knows will be tested whether you asked
   about it or not, so the questions you ask decide what you get to build for.
3. **Build.** Tell your helper what to build. Read what it writes, run it, test it, and tell
   it what to fix. It is fast and confident, and sometimes it is wrong. You submit before
   the clock runs out.
4. **Review.** You get your opponent's app - built by someone else's helper, code you have
   never seen. Find its bugs. Every bug you report comes with a test that shows it failing, so
   a report is never just an opinion.
5. **Defend.** Your opponent has been reviewing your app at the same time. For each bug they
   found, fix it with your helper or concede it. A fix only counts if their test now passes
   and nothing else broke.
6. **The result.** A score card that says where every point came from: what your app passed,
   which questions paid off, which bugs you found, which you fixed, and how much time you had
   left.

## Practice and ranked

In **practice**, a coach is on. It does not give answers. It points out where you have not
looked yet: nothing asked about scale, no test for an empty input, no look at how passwords
are stored. In **ranked** play the coach is off.

## Playing on your own

Matches are not live. You build when it suits you, and your opponent builds when it suits
them; the review and the defence happen over the following days, like a code review at work.
If nobody else has taken the challenge yet, you play the house: the challenge author's own
version of the app, with bugs planted in it to find, and a reviewer who knows the common
mistakes.

## The helper

Every player's helper is the same model; the name is yours. It runs inside your browser, on
your own machine, after a one-time download. Nothing you type to it is sent to an AI company,
and no match costs anyone money.

The model is our own: an open coding model trained further by us, on data chosen for this
game, and measured against the model it started from on challenges it has never seen.

## What it is not

- Not a typing race and not a puzzle site. There are no algorithm riddles.
- Not a course. It does not teach a language; it teaches the questions to ask about code.
- Not a place to bring your own AI. Everyone gets the same helper.
- Not a host for real apps. What is built lives inside the game.

## Where it runs

In a desktop browser with a reasonably recent graphics card. A phone can follow a match and
read results, but building needs a desktop. Sign-in is by an email link; there are no
passwords.
