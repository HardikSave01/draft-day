# How Draft Day was built with CLAD

Draft Day was built entirely through CLAD in Lens Studio. What follows is not a feature list — it is the record of where CLAD's first answer was wrong, how that was caught, and what was done about it. The raw, unedited session transcripts are in [`/clad-log`](./clad-log).

## The first answer was the wrong paradigm, and rejecting it produced the architecture

The opening scaffold returned a flat 2D panel with pagination, floating in space. It worked. It was also a phone screen pinned to the air — the wrong paradigm for a headset, where the room itself is the layout surface.

Rather than iterate on it, the direction was reversed: restructure into independent world-space objects, each card its own entity with its own transform, arranged in an arc around the user. Everything that makes Draft Day feel spatial — the grab, the arc, the drop zones, the tray that spans your field of view — descends from rejecting that first answer rather than accepting it.

## Divergence was kept when it was better than the spec

A request for column-based zones came back as filter tabs instead — not what was asked for. The tabs were genuinely useful, so they stayed, and the zones were re-specified separately as a distinct feature. Both shipped. Treating the divergence as a finding rather than a defect produced a better app than the original spec described.

## A clarifying question turned into the core UX decision

CLAD asked two clarifying questions about zone semantics: what a zone means, and what happens on release. The answer was a deliberate call rather than a shrug — **auto-route on drop**. A released card travels to the zone matching its own position, regardless of exactly where the hand let go.

The reasoning: hand tracking in AR is imprecise. Requiring the user to aim accurately turns every single drop into a small failure, and in a draft you are making a pick every ninety seconds while talking to your league on a video call. Precision aiming is the wrong tax to charge. This is the decision most responsible for the app feeling good to use.

## Bugs found by looking, not by trusting

**Cards rendering 21× too wide.** Runtime inspection traced it to a `StackRoot` nested inside a `FlexLayout`, writing panel width into transform scale. Fixed narrowly, in one file, rather than by rebuilding the layout.

**A readability pass that over-corrected.** Light card plates were paired with a dark outline on the text. The outline did not add contrast — it only thickened the strokes until letterforms smeared and the counters filled in. No automated check catches this. It was caught by looking at Preview and reading the cards, then corrected with a real type hierarchy instead of an outline.

**A drop-zone widening pass that became a single 4.2m acceptance band.** The zones were widened to be more forgiving; the passes compounded into one continuous band that swallowed everything. Ten cards sorted themselves into zones during ordinary repositioning. The correction was not to guess at smaller padding values but to derive the threshold from the actual arc geometry — 15cm of clearance below the lowest row of the arc.

Each of these was found by watching the thing run, and each was corrected by finding the specific cause rather than reverting the work around it.

## The agent's reports were verified, not trusted

**Subagents twice reported tools as unavailable when those tools were in fact working.** The main session verified independently instead of accepting the report and routing around a problem that did not exist.

**When MCP tooling stopped binding altogether,** the workflow switched to human-in-the-loop verification rather than stalling: compile in Lens Studio, read the TypeScript Status panel, reset Preview, screenshot the result, feed it back. Slower per cycle, but it kept every claim of success grounded in something actually observed — instead of letting the agent assert unverified success into a build nobody had looked at.

**The agent pushed back on a proposed revert and was right.** A change was suspected of causing a fault; the agent produced timestamp evidence showing the suspected change post-dated the fault by two hours. The revert would have destroyed a working visual pass and left the actual error untouched. Pushback with evidence is worth more than compliance, and it was accepted on the evidence.

## The final compile failure: reading evidence instead of reverting

Immediately after a visual pass, 59 `TS1238` errors appeared — all of them in SIK's own untouched example sources. The obvious inference was that the visual pass broke the build, and the obvious response was to revert it and lose a day of work.

The evidence said otherwise. Nothing under `Packages/` or in any config file had been modified in 24 hours. The failing directory had been expanded at the exact moment of an earlier Lens Studio crash-restart — two hours *before* the visual pass ran. The build was broken before the change that appeared to break it.

This was an environment fault, not a code fault. The fix was deleting `Cache/TypeScript` and letting Lens Studio regenerate it. One command, no code touched, compile clean. Reverting would have thrown away a full day of visual work and fixed nothing.

## And the thing that made all of it recoverable

Discovered during that same failure: the project had never been under version control. Every rollback attempted up to that point had been impossible — there was nothing to roll back to. A snapshot commit was made before any further edits, so that the next failure would be survivable.

## What shipped

Real ADP data for 40 players. Grabbable world-space cards in an arc. Position filter tabs. Four drop zones with auto-routing and destination highlighting. Live roster requirement tracking against a standard lineup. And the differentiator: bye-week clash detection, which pulses both offending cards red the moment you draft a second starter who shares a bye with one you already have — the conflict that fantasy players otherwise discover in September, when it is too late to fix.

## On the data

The live ADP endpoint returns HTTP 403 from inside Lens Studio. Rather than fabricate plausible-looking numbers, the app ships against a real captured snapshot dated Aug 14 2026, and says so in the interface: the status pill reads `ADP · Aug 14 snapshot`. ADP data via Fantasy Football Calculator (fantasyfootballcalculator.com).
