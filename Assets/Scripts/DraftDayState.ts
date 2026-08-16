/**
 * DraftDayState — pure logic: player list, position filter, the visible-count
 * cap, and the user's own tier-zone assignments.
 *
 * Owns: the single source of truth for players / filter / cap / zone
 * membership / drafted marks. No scene access, no @input. Instantiated as a
 * plain class by DraftDayMain, which pushes its derived views into the UI
 * modules. DraftDayMain is the ONLY mutator.
 *
 * ── Two orthogonal facts about a player ─────────────────────────────────────
 * These are deliberately independent and must not be conflated:
 *
 *  1. ZONE ASSIGNMENT (`zoneAssignments`) — the USER'S OWN TIER SORTING. The
 *     user dragged this card into their QB / RB / WR / TE bin. It is a purely
 *     personal, subjective organization of the board. It is NOT "drafting".
 *     Vocabulary throughout this codebase is zone/tier — never `drafted`,
 *     `draft()`, `isDrafted` — for this concept.
 *
 *  2. DRAFTED (`Player.drafted`) — A FACT ABOUT THE OUTSIDE WORLD: some
 *     manager in the league took this player off the board. It has nothing to
 *     do with where the user filed the card.
 *
 *     A player can sit in a zone while unmarked, and can be marked drafted
 *     whether or not they are in a zone. Neither implies the other, and
 *     neither may be derived from the other.
 *
 *     >>> SEAM — NOT WIRED THIS PASS. <<<
 *     setDrafted/isDrafted/getDraftedCount below are the complete, honest
 *     plumbing for (2), but NOTHING calls setDrafted() yet: there is no
 *     drafted UI, no marking interaction, and no drafted visual. They exist
 *     so the concept has a real home the moment it is built out, rather than
 *     being retrofitted onto the zone vocabulary. Arc-pool membership
 *     deliberately ignores drafted state — when (2) ships, decide THEN
 *     whether drafted players are hidden, dimmed, or left in place.
 */
import { Player, playerId } from "./DraftDayDataService"

export type FilterKey = "ALL" | "QB" | "RB" | "WR" | "TE"

/** The four tier bins the user can sort cards into. */
export type ZoneKey = "QB" | "RB" | "WR" | "TE"

export const ZONE_KEYS: ZoneKey[] = ["QB", "RB", "WR", "TE"]

/** One bye week shared by two or more zoned players. See getByeClashes(). */
export interface ByeClash {
  bye: number
  playerIds: string[]
}

/**
 * Auto-route target for a card: the zone matching the card's OWN position,
 * regardless of which zone it was physically dropped nearest to. Returns null
 * for positions with no bin (K, DEF, ... from the live feed) — such a card is
 * never zoned and stays in the arc pool.
 */
export function zoneForPosition(position: string): ZoneKey | null {
  switch (position) {
    case "QB": return "QB"
    case "RB": return "RB"
    case "WR": return "WR"
    case "TE": return "TE"
    default: return null
  }
}

export class DraftDayState {
  private players: Player[] = []
  private filter: FilterKey = "ALL"
  readonly maxVisible: number

  /** (1) User's own tier sorting: playerId -> zone. Insertion-ordered. */
  private zoneAssignments = new Map<string, ZoneKey>()

  /** playerId -> Player, so the drafted seam can reach the model by id. */
  private byId = new Map<string, Player>()

  constructor(maxVisible: number = 24) {
    this.maxVisible = maxVisible
  }

  setPlayers(players: Player[]): void {
    this.players = players
    this.byId.clear()
    for (const p of players) this.byId.set(playerId(p), p)
    // A reload can return a different roster; drop zone assignments whose
    // player no longer exists so the map can't leak stale ids (and can't
    // silently shrink the arc pool by excluding a player that isn't there).
    for (const id of Array.from(this.zoneAssignments.keys())) {
      if (!this.byId.has(id)) this.zoneAssignments.delete(id)
    }
  }

  setFilter(filter: FilterKey): void {
    this.filter = filter
  }

  getFilter(): FilterKey {
    return this.filter
  }

  /** Current model for a player id, or null if the roster no longer has them. */
  getPlayer(id: string): Player | null {
    const p = this.byId.get(id)
    return p === undefined ? null : p
  }

  private getFiltered(): Player[] {
    if (this.filter === "ALL") return this.players
    return this.players.filter((p) => p.position === this.filter)
  }

  // ── Arc pool (filter-driven, re-laid-out on every filter change) ──────────

  /**
   * Players matching the current filter that are NOT sitting in a zone.
   * Zoned cards are excluded here — that exclusion is what makes zone
   * placement survive a filter change: the arc re-layout never sees them, so
   * it never destroys or respawns them.
   */
  private getArcPoolFiltered(): Player[] {
    return this.getFiltered().filter((p) => !this.zoneAssignments.has(playerId(p)))
  }

  /** Total arc-pool players matching the current filter, before the cap. */
  getArcPoolCount(): number {
    return this.getArcPoolFiltered().length
  }

  /** Arc-pool players, capped at maxVisible — the set the arc actually shows. */
  getArcPoolPlayers(): Player[] {
    return this.getArcPoolFiltered().slice(0, this.maxVisible)
  }

  // ── Zone membership (stable across filter changes) ────────────────────────

  assignZone(id: string, zone: ZoneKey): void {
    this.zoneAssignments.set(id, zone)
  }

  clearZone(id: string): void {
    this.zoneAssignments.delete(id)
  }

  getZone(id: string): ZoneKey | null {
    const z = this.zoneAssignments.get(id)
    return z === undefined ? null : z
  }

  getZoneCount(zone: ZoneKey): number {
    let n = 0
    this.zoneAssignments.forEach((z) => { if (z === zone) n++ })
    return n
  }

  /** Total cards the user has sorted into zones, across all four bins. */
  getZonedTotal(): number {
    return this.zoneAssignments.size
  }

  // ── Bye-week clashes (zoned cards only) ──────────────────────────────────
  //
  // A clash is a bye week shared by two or more players the user has sorted
  // into ANY zone — the four zones are read as one lineup, since a QB and a WR
  // both idle in week 11 is the same problem as two WRs. Arc-pool players are
  // deliberately excluded: the arc is everyone still available, so shared byes
  // there are meaningless and marking them would flag most of the board.
  //
  // Derived on demand from zoneAssignments rather than stored, so it cannot go
  // stale: there is no clash state to invalidate when a card moves, and this
  // module keeps its single source of truth.

  /**
   * Bye weeks currently shared by 2+ zoned players, ascending by week. Each
   * entry carries the ids of every player sharing it.
   */
  getByeClashes(): ByeClash[] {
    const byWeek = new Map<number, string[]>()
    this.zoneAssignments.forEach((_zone, id) => {
      const p = this.byId.get(id)
      if (!p) return
      const existing = byWeek.get(p.bye)
      if (existing) existing.push(id)
      else byWeek.set(p.bye, [id])
    })

    const out: ByeClash[] = []
    byWeek.forEach((ids, bye) => {
      if (ids.length >= 2) out.push({ bye, playerIds: ids })
    })
    out.sort((a, b) => a.bye - b.bye)
    return out
  }

  /**
   * Ids of every zoned player involved in any clash — the set the view uses to
   * decide which cards wear the warning treatment.
   */
  getClashingPlayerIds(): Set<string> {
    const ids = new Set<string>()
    for (const clash of this.getByeClashes()) {
      for (const id of clash.playerIds) ids.add(id)
    }
    return ids
  }

  // ── Drafted seam — see the header. Nothing calls setDrafted() yet. ────────

  setDrafted(id: string, drafted: boolean): void {
    const p = this.byId.get(id)
    if (p) p.drafted = drafted
  }

  isDrafted(id: string): boolean {
    const p = this.byId.get(id)
    return p ? p.drafted === true : false
  }

  getDraftedCount(): number {
    let n = 0
    for (const p of this.players) if (p.drafted === true) n++
    return n
  }
}
