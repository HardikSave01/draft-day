/**
 * DraftDayDataService — fetches live ADP data from Fantasy Football Calculator,
 * with graceful degradation to an embedded static dataset.
 *
 * Owns: the fetch/parse/fallback flow. Pure logic — no scene access, no @input.
 * Not a @component; instantiated as a plain class by DraftDayMain.
 */

export interface Player {
  name: string
  position: string
  team: string
  bye: number
  adp: number

  /**
   * Overall ADP rank, 1-based: 1 is the first player off the board.
   *
   * Assigned here, once, immediately after the whole dataset is sorted — NOT
   * derived from a card's index in the arc. That distinction is the point: the
   * arc renumbering itself when the user filters to WR would make rank
   * meaningless ("#1" would mean "first WR" on one screen and "first overall"
   * on another). Because it travels on the Player, a filtered or zoned card
   * keeps the rank it was born with.
   *
   * Optional only because the field is populated after construction; every
   * player returned by load() has one.
   */
  rank?: number

  /**
   * SEAM — NOT WIRED THIS PASS.
   *
   * "Some manager in the league took this player off the board." A fact about
   * the outside world, entirely INDEPENDENT of where the user filed the card:
   * a player can sit in one of the user's tier zones while unmarked, and can
   * be marked drafted whether or not they are in a zone. Neither state may be
   * derived from the other.
   *
   * Do NOT reuse this field (or the word "drafted") for the user's own tier
   * sorting — that is zone assignment and lives in DraftDayState.zoneAssignments.
   *
   * Nothing sets this yet: there is no drafted UI, no marking interaction and
   * no drafted visual. DraftDayState.setDrafted()/isDrafted() are the only
   * accessors, so the concept has a real home the day it gets built out.
   */
  drafted?: boolean
}

/**
 * Stable identity for a player across reloads and across the live/static
 * datasets. Name alone collides (e.g. two "Michael Carter"s), so it is
 * qualified by team.
 */
export function playerId(p: Player): string {
  return `${p.name}|${p.team}`
}

/**
 * Stamps 1-based overall rank onto an already-ADP-sorted list. Called once per
 * load, on the full dataset, before any filtering can narrow it.
 */
function assignRanks(players: Player[]): void {
  for (let i = 0; i < players.length; i++) players[i].rank = i + 1
}

export interface LoadResult {
  players: Player[]
  source: "live" | "static"
  message: string
}

const ADP_URL = "https://fantasyfootballcalculator.com/api/v1/adp/standard?teams=12&year=2026&position=all"

// ── Status labels ───────────────────────────────────────────────────────────
// The fallback label names WHAT the data is and HOW OLD it is, rather than
// announcing a failed connection: the embedded dataset is a deliberate,
// dated snapshot, and "Offline" framed a working offline mode as an error.
// Update the date here whenever STATIC_PLAYERS below is refreshed.
const STATIC_STATUS_LABEL = "ADP · Aug 14 snapshot"
const LIVE_STATUS_LABEL = "ADP · live"

// ── Embedded static fallback dataset (40 players) ────────────────────────────
const STATIC_PLAYERS: Player[] = [
  { name: "Josh Allen", position: "QB", team: "BUF", bye: 7, adp: 19.0 },
  { name: "Drake Maye", position: "QB", team: "NE", bye: 11, adp: 48.3 },
  { name: "Lamar Jackson", position: "QB", team: "BAL", bye: 13, adp: 49.6 },
  { name: "Joe Burrow", position: "QB", team: "CIN", bye: 6, adp: 54.1 },
  { name: "Dak Prescott", position: "QB", team: "DAL", bye: 14, adp: 63.3 },
  { name: "Jayden Daniels", position: "QB", team: "WAS", bye: 7, adp: 68.7 },
  { name: "Jahmyr Gibbs", position: "RB", team: "DET", bye: 6, adp: 1.5 },
  { name: "Bijan Robinson", position: "RB", team: "ATL", bye: 11, adp: 2.3 },
  { name: "Jonathan Taylor", position: "RB", team: "IND", bye: 13, adp: 4.2 },
  { name: "Christian McCaffrey", position: "RB", team: "SF", bye: 8, adp: 6.5 },
  { name: "Derrick Henry", position: "RB", team: "BAL", bye: 13, adp: 6.8 },
  { name: "James Cook III", position: "RB", team: "BUF", bye: 7, adp: 9.4 },
  { name: "De'Von Achane", position: "RB", team: "MIA", bye: 6, adp: 11.9 },
  { name: "Saquon Barkley", position: "RB", team: "PHI", bye: 10, adp: 14.6 },
  { name: "Ashton Jeanty", position: "RB", team: "LV", bye: 13, adp: 16.3 },
  { name: "Josh Jacobs", position: "RB", team: "GB", bye: 11, adp: 17.4 },
  { name: "Chase Brown", position: "RB", team: "CIN", bye: 6, adp: 19.1 },
  { name: "Omarion Hampton", position: "RB", team: "LAC", bye: 7, adp: 22.0 },
  { name: "Kyren Williams", position: "RB", team: "LAR", bye: 11, adp: 24.9 },
  { name: "Breece Hall", position: "RB", team: "NYJ", bye: 13, adp: 26.9 },
  { name: "Puka Nacua", position: "WR", team: "LAR", bye: 11, adp: 2.7 },
  { name: "Ja'Marr Chase", position: "WR", team: "CIN", bye: 6, adp: 4.9 },
  { name: "Jaxon Smith-Njigba", position: "WR", team: "SEA", bye: 11, adp: 5.9 },
  { name: "Amon-Ra St. Brown", position: "WR", team: "DET", bye: 6, adp: 8.5 },
  { name: "Drake London", position: "WR", team: "ATL", bye: 11, adp: 11.9 },
  { name: "CeeDee Lamb", position: "WR", team: "DAL", bye: 14, adp: 14.0 },
  { name: "George Pickens", position: "WR", team: "DAL", bye: 14, adp: 16.5 },
  { name: "Rashee Rice", position: "WR", team: "KC", bye: 5, adp: 16.7 },
  { name: "Justin Jefferson", position: "WR", team: "MIN", bye: 6, adp: 18.4 },
  { name: "A.J. Brown", position: "WR", team: "NE", bye: 11, adp: 19.0 },
  { name: "Nico Collins", position: "WR", team: "HOU", bye: 8, adp: 22.0 },
  { name: "Zay Flowers", position: "WR", team: "BAL", bye: 13, adp: 24.5 },
  { name: "Chris Olave", position: "WR", team: "NO", bye: 8, adp: 26.4 },
  { name: "Malik Nabers", position: "WR", team: "NYG", bye: 8, adp: 30.7 },
  { name: "Brock Bowers", position: "TE", team: "LV", bye: 13, adp: 53.7 },
  { name: "Trey McBride", position: "TE", team: "ARI", bye: 14, adp: 54.2 },
  { name: "Colston Loveland", position: "TE", team: "CHI", bye: 10, adp: 73.0 },
  { name: "Tyler Warren", position: "TE", team: "IND", bye: 13, adp: 80.5 },
  { name: "Sam LaPorta", position: "TE", team: "DET", bye: 6, adp: 104.0 },
  { name: "Kyle Pitts Sr.", position: "TE", team: "ATL", bye: 11, adp: 108.2 },
]

export class DraftDayDataService {
  private internetModule: InternetModule = require("LensStudio:InternetModule")

  /**
   * Attempts the live ADP fetch; on ANY failure (no internet, non-200,
   * malformed JSON, timeout) falls back to the embedded static dataset.
   * Never throws — always resolves with a usable player list.
   */
  async load(): Promise<LoadResult> {
    if (!global.deviceInfoSystem.isInternetAvailable()) {
      print("[DraftDay] Internet unavailable — using static dataset.")
      return this.staticResult(STATIC_STATUS_LABEL)
    }

    try {
      const response = await this.internetModule.fetch(ADP_URL, { method: "GET" })
      if (response.status !== 200) {
        print(`[DraftDay] Live fetch returned HTTP ${response.status} — using static dataset.`)
        return this.staticResult(STATIC_STATUS_LABEL)
      }

      const json = await response.json()
      const players = this.parseLiveResponse(json)
      if (!players || players.length === 0) {
        print("[DraftDay] Live response parsed to zero players — using static dataset.")
        return this.staticResult(STATIC_STATUS_LABEL)
      }

      print(`[DraftDay] Live fetch succeeded — ${players.length} players from fantasyfootballcalculator.com.`)
      return { players, source: "live", message: LIVE_STATUS_LABEL }
    } catch (err) {
      print(`[DraftDay] Live fetch failed (${err}) — using static dataset.`)
      return this.staticResult(STATIC_STATUS_LABEL)
    }
  }

  private staticResult(message: string): LoadResult {
    const players = STATIC_PLAYERS.slice().sort((a, b) => a.adp - b.adp)
    assignRanks(players)
    return { players, source: "static", message }
  }

  /**
   * Prints every bye week in the EMBEDDED static dataset shared by two or more
   * players, grouped by week, each player with position and ADP.
   *
   * A planning aid, not a runtime feature: the bye-clash warning works off
   * whichever players the user has actually zoned, but to stage a clash on
   * camera you need to know in advance which two cards to reach for. Reports
   * the static set specifically because that is what a demo runs on when the
   * live fetch is unavailable — and the offline path is the reproducible one.
   */
  logStaticByeClashes(): void {
    const byWeek = new Map<number, Player[]>()
    for (const p of STATIC_PLAYERS) {
      const existing = byWeek.get(p.bye)
      if (existing) existing.push(p)
      else byWeek.set(p.bye, [p])
    }

    const weeks = Array.from(byWeek.keys()).sort((a, b) => a - b)
    print("[DraftDay] Static dataset — bye weeks shared by 2+ players:")
    let found = 0
    for (const week of weeks) {
      const group = byWeek.get(week)
      if (!group || group.length < 2) continue
      found++
      // Best draft capital first: the earliest-ADP pair in a week is the one
      // that will actually be near the front of the arc, and so the easiest to
      // pick up on camera.
      group.sort((a, b) => a.adp - b.adp)
      print(`  Bye ${week} — ${group.length} players`)
      for (const p of group) {
        print(`      ${p.name} (${p.position}, ${p.team}) ADP ${p.adp.toFixed(1)}`)
      }
    }
    if (found === 0) print("  (none — every player has a distinct bye week)")
  }

  /**
   * FFC ADP API response shape: { status, meta, players: [{ name, position,
   * team, bye, adp, adp_formatted, ... }] }. Defensive — any field-shape
   * drift falls through to null and the caller falls back to static data.
   */
  private parseLiveResponse(json: any): Player[] | null {
    if (!json || !Array.isArray(json.players)) return null
    const out: Player[] = []
    for (const p of json.players) {
      if (!p || typeof p.name !== "string") continue
      const player: Player = {
        name: p.name,
        position: typeof p.position === "string" ? p.position : "??",
        team: typeof p.team === "string" ? p.team : "???",
        bye: typeof p.bye === "number" ? p.bye : 0,
        adp: typeof p.adp === "number" ? p.adp : 999,
      }
      out.push(player)
    }
    out.sort((a, b) => a.adp - b.adp)
    assignRanks(out)
    return out
  }
}
