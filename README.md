# Draft Day

A spatial fantasy football draft companion for Spectacles, built with CLAD in Lens Studio.

## What it does

Draft Day puts your draft board in the room instead of on a second screen. Real ADP rankings appear as grabbable cards floating in an arc around you. You pinch a player, drop him into a position zone, and your roster builds itself in space while your eyes stay on the video call with your league.

- **Real ADP data** — 40 players, Aug 14 2026 snapshot, via Fantasy Football Calculator
- **Grabbable 3D cards** — rank, name, position, team, bye week, ADP
- **Filter tabs** — All / QB / RB / WR / TE
- **Four position zones** — cards auto-route to the zone matching their position on release
- **Destination highlight** — the receiving zone brightens and outlines while a card is held
- **Roster requirements** — each zone tracks progress against a standard lineup (1 QB, 2 RB, 2 WR, 1 TE)
- **Bye-week clash detection** — if two of your own starters share a bye week, both cards pulse red and a banner appears

## Why the bye-week warning matters

Every NFL team gets one week off. If two of your starters share that week, your lineup has two holes on that Sunday. Nobody catches this during a live draft — they catch it in September, when it is too late to fix. Draft Day catches it at the moment you make the pick.

## Data

ADP data via Fantasy Football Calculator (fantasyfootballcalculator.com). The live endpoint returns HTTP 403 from within Lens Studio, so the app ships against a real captured snapshot dated Aug 14 2026 rather than fabricated values. The status
cd ~/Documents/DraftDay-Public && cat > README.md << 'EOF'
# Draft Day

A spatial fantasy football draft companion for Spectacles, built with CLAD in Lens Studio.

## What it does

Draft Day puts your draft board in the room instead of on a second screen. Real ADP rankings appear as grabbable cards floating in an arc around you. You pinch a player, drop him into a position zone, and your roster builds itself in space while your eyes stay on the video call with your league.

- **Real ADP data** — 40 players, Aug 14 2026 snapshot, via Fantasy Football Calculator
- **Grabbable 3D cards** — rank, name, position, team, bye week, ADP
- **Filter tabs** — All / QB / RB / WR / TE
- **Four position zones** — cards auto-route to the zone matching their position on release
- **Destination highlight** — the receiving zone brightens and outlines while a card is held
- **Roster requirements** — each zone tracks progress against a standard lineup (1 QB, 2 RB, 2 WR, 1 TE)
- **Bye-week clash detection** — if two of your own starters share a bye week, both cards pulse red and a banner appears

## Why the bye-week warning matters

Every NFL team gets one week off. If two of your starters share that week, your lineup has two holes on that Sunday. Nobody catches this during a live draft — they catch it in September, when it is too late to fix. Draft Day catches it at the moment you make the pick.

## Data

ADP data via Fantasy Football Calculator (fantasyfootballcalculator.com). The live endpoint returns HTTP 403 from within Lens Studio, so the app ships against a real captured snapshot dated Aug 14 2026 rather than fabricated values. The status pill in-app reads `ADP · Aug 14 snapshot`.

## Built with

Lens Studio, Spectacles Interaction Kit v0.18.0, TypeScript. Written with CLAD.

## CLAD prompt log

Raw, unedited session transcripts are in [`/clad-log`](./clad-log).

## How this was built

The CLAD execution story — where the first answer was wrong, how it was caught, and what was corrected — is in [CLAD_EXECUTION.md](./CLAD_EXECUTION.md).
