/**
 * DraftDayMain — orchestrator for the Draft Day player-card browser.
 *
 * Owns: data loading (live fetch with static fallback), filter state, tier
 * zone routing decisions, and pushing derived views into the card field, the
 * zone panels, and the status text. Holds no rendering logic itself —
 * delegates all visible UI to the DraftDayControlsUI / DraftDayZoneUI modules
 * and all placement to the DraftDayCardFieldController /
 * DraftDayZoneController controllers (Channel A).
 *
 * ── Card custody, in one place ─────────────────────────────────────────────
 * A card is in exactly one of two collections at any moment, and this script
 * is the ONLY thing that moves it between them:
 *
 *   ARC POOL  — owned by DraftDayCardFieldController. Filter-driven; every
 *               card in it is destroyed and respawned on a filter change.
 *   ZONE      — owned by DraftDayZoneController. Stable; a filter change
 *               never sees these cards, so a sorted card stays sorted.
 *
 * While a card is held, previewDropTarget() arms the zone it would land in —
 * feedback only, computed from the same predicates the drop itself uses, so
 * the highlight can never disagree with where the card actually goes.
 *
 * On release (DraftDayCardFieldController.onCardReleased) this script decides:
 *   released near the zone row  → route it into the zone matching the CARD'S
 *                                 OWN position, never the nearest zone. A WR
 *                                 dropped over the QB panel goes to WR, so
 *                                 drop aim precision is irrelevant.
 *   released away, was zoned    → pull it back out into the arc pool.
 *   released away, wasn't zoned → nothing; it stays where the user left it.
 *
 * Vocabulary: putting a card in a zone is the USER'S OWN TIER SORTING, not
 * "drafting". The orthogonal drafted concept is an unwired seam — see the
 * header of DraftDayState.ts.
 *
 * @input contract:
 * - controls:  DraftDayControlsUI          — top bar (title/status/refresh/filters)
 * - cardField: DraftDayCardFieldController — spawns/arranges arc-pool cards
 * - zones:     DraftDayZoneController      — the four 3D tier drop zones
 * All wired by the bootstrap's Phase B apply. Must not be created in code —
 * these are authored scene roots (Hard Rule 5).
 */
import { DraftDayControlsUI } from "./DraftDayControlsUI"
import { DraftDayCardFieldController } from "./DraftDayCardFieldController"
import { DraftDayZoneController } from "./DraftDayZoneController"
import { DraftDayCardUI } from "./DraftDayCardUI"
import { DraftDayDataService, Player } from "./DraftDayDataService"
import { ByeClash, DraftDayState, FilterKey, zoneForPosition } from "./DraftDayState"

@component
export class DraftDayMain extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">DraftDayMain – Orchestrates data load, filter state, tier-zone routing, and the UI modules</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Top control bar UI module (title, live/offline status, refresh, position filters)")
  controls!: DraftDayControlsUI

  @input
  @hint("3D card field controller — spawns/arranges arc-pool player cards in a wraparound arc around the user")
  cardField!: DraftDayCardFieldController

  @input
  @hint("Tier drop-zone controller — the four QB/RB/WR/TE 3D zones below the card arc")
  zones!: DraftDayZoneController
  @ui.group_end

  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @widget(new SliderWidget(6, 40, 1))
  @hint("Maximum arc-pool cards shown at once across the arc (filtered sets larger than this are capped; status text shows a 'shown/total' suffix when capped). Cards sorted into tier zones do not count against this.")
  maxVisibleCards: number = 24
  @ui.group_end

  private dataService = new DraftDayDataService()
  private state!: DraftDayState
  private lastStatusMessage: string = "Loading..."
  private lastIsLive: boolean = false

  onAwake() {
    if (!this.controls || !this.cardField || !this.zones) {
      print("[DraftDayMain] ERROR: required @input not wired (controls/cardField/zones). Check Phase B bootstrap wiring.")
      return
    }
    this.state = new DraftDayState(this.maxVisibleCards)
    // Cross-object access (subscribing to child UI modules' events) is unsafe in
    // onAwake — Main sits on the root, which runs onAwake before its children
    // (Controls/CardGrid/Zones) have run theirs. Defer to OnStartEvent.
    this.createEvent("OnStartEvent").bind(() => this.onStart())
  }

  private onStart(): void {
    this.controls.onRefresh.add(() => this.loadData())
    this.controls.onFilterChanged.add((filter: string) => this.onFilterChanged(filter as FilterKey))
    this.cardField.onCardReleased.add((card: DraftDayCardUI) => this.onCardReleased(card))
    this.cardField.onCardGrabStart.add((card: DraftDayCardUI) => this.previewDropTarget(card))
    this.cardField.onCardGrabMove.add((card: DraftDayCardUI) => this.previewDropTarget(card))

    this.controls.setStatus("Loading...", false)
    // One-off diagnostic for planning a demo: which players in the offline
    // dataset can actually be made to clash on camera.
    this.dataService.logStaticByeClashes()
    this.loadData()
  }

  private loadData(): void {
    this.controls.setStatus("Loading...", false)
    // Keep onAwake/handlers sync; run the async fetch+fallback flow as a fire-and-forget call.
    this.loadDataAsync()
  }

  private async loadDataAsync(): Promise<void> {
    const result = await this.dataService.load()
    this.state.setPlayers(result.players)
    this.lastStatusMessage = result.message
    this.lastIsLive = result.source === "live"
    this.reconcileZonedCards()
    this.renderArc()
  }

  private onFilterChanged(filter: FilterKey): void {
    this.state.setFilter(filter)
    // Re-lays out ONLY the arc pool. DraftDayState.getArcPoolPlayers()
    // excludes every zoned player, and DraftDayCardFieldController no longer
    // holds their card objects, so sorted cards are neither destroyed nor
    // respawned here — they just stay in their zone.
    this.renderArc()
  }

  /**
   * A refresh can return a fresh Player object for the same person (new ADP)
   * or drop them from the roster entirely. Re-push the current model into
   * every zoned card so a sorted card never displays stale data, and dispose
   * of any card whose player vanished (DraftDayState.setPlayers has already
   * dropped that zone assignment).
   */
  private reconcileZonedCards(): void {
    for (const card of this.zones.getAllCards()) {
      const id = card.getPlayerId()
      const player = this.state.getPlayer(id)
      if (player) {
        card.setPlayer(player)
      } else {
        const orphan = this.zones.detachCard(id)
        if (orphan && !isNull(orphan.sceneObject)) orphan.sceneObject.destroy()
      }
    }
  }

  private renderArc(): void {
    const visible: Player[] = this.state.getArcPoolPlayers()
    this.cardField.setPlayers(visible)
    this.refreshStatus()
    // A filter change tears down and respawns the arc pool but never touches
    // zoned cards, so clash marks already survive it. Re-applying anyway keeps
    // one rule — "the view is refreshed from state after any change" — instead
    // of a second rule about which changes happen to be safe to skip.
    this.applyByeClashes()
  }

  private refreshStatus(): void {
    const shown = this.state.getArcPoolPlayers().length
    const total = this.state.getArcPoolCount()
    const capped = total > shown ? ` • ${shown}/${total} shown` : ""
    const zoned = this.state.getZonedTotal()
    const sorted = zoned > 0 ? ` • ${zoned} sorted` : ""
    this.controls.setStatus(this.lastStatusMessage + capped + sorted, this.lastIsLive)
  }

  // ── Bye-week clashes ─────────────────────────────────────────────────────
  /**
   * Recomputes clashes from zone membership and pushes the result into the
   * view: a warning mark on every zoned card sharing a bye week with another
   * zoned card, and one summary line above the zone row.
   *
   * Strictly additive — it reads DraftDayState.zoneAssignments and writes only
   * presentation. Nothing here routes a card, moves custody, or touches the
   * drop test; a card is flagged or not purely on where it already sits.
   *
   * Called after every membership change. It always walks the full zoned set
   * and sets each card explicitly, so a card that has just stopped clashing is
   * cleared by the same pass that flags the ones that still do — there is no
   * incremental state to get out of step.
   */
  private applyByeClashes(): void {
    const clashing = this.state.getClashingPlayerIds()
    for (const card of this.zones.getAllCards()) {
      card.setClashWarning(clashing.has(card.getPlayerId()))
    }
    this.zones.setClashBanner(this.formatClashBanner(this.state.getByeClashes()))
  }

  /**
   * "2 starters share bye week 11", one clause per clashing week, joined when
   * there is more than one. Empty string when the board is clean, which is the
   * banner's signal to hide itself.
   */
  private formatClashBanner(clashes: ByeClash[]): string {
    if (clashes.length === 0) return ""
    const parts: string[] = []
    for (const c of clashes) {
      parts.push(`${c.playerIds.length} starters share bye week ${c.bye}`)
    }
    return parts.join("   •   ")
  }

  // ── Drop-target preview ──────────────────────────────────────────────────
  /**
   * Called on grab and on every frame of a drag: works out where this card
   * would land if released right now, and arms that zone.
   *
   * Deliberately built from the SAME two predicates, in the same order, that
   * onCardReleased() uses to perform the drop —
   *   1. zones.zoneAtWorldPosition(...) — is the card inside the acceptance
   *      region at all? (yes/no only; it never picks the zone)
   *   2. zoneForPosition(player.position) — which zone the card's OWN position
   *      routes to
   * — so the highlight cannot promise a destination the release would not
   * honor. If either predicate declines, the preview clears, which is what
   * makes this double as a readout of the drop band: hold a card too high or
   * out to the side and nothing lights up, because nothing would sort.
   *
   * Feedback only. Nothing here moves a card, changes custody, or writes state.
   */
  private previewDropTarget(card: DraftDayCardUI): void {
    const player = card.getPlayer()
    if (!player) {
      this.zones.setDropPreview(null)
      return
    }
    const inBand = this.zones.zoneAtWorldPosition(card.getWorldPosition()) !== null
    // A position with no bin (K, DEF, ...) routes nowhere, so it previews
    // nothing — the same answer the drop would give.
    this.zones.setDropPreview(inBand ? zoneForPosition(player.position) : null)
  }

  // ── Drop routing ─────────────────────────────────────────────────────────
  private onCardReleased(card: DraftDayCardUI): void {
    // Cleared first, unconditionally, so every early return below still leaves
    // the row at rest — a highlight stuck on after a release would be worse
    // than no highlight at all.
    this.zones.setDropPreview(null)

    const player = card.getPlayer()
    if (!player) return
    const id = card.getPlayerId()

    const nearZoneRow = this.zones.zoneAtWorldPosition(card.getWorldPosition())
    const heldBy = this.zones.zoneHolding(id)

    if (nearZoneRow === null) {
      // Released away from the zones. If it came out of one, that is the
      // pull-out / misdrop recovery: it rejoins the arc pool right where the
      // user let go and takes a normal slot on the next re-layout.
      if (heldBy !== null) this.pullOutOfZone(card, id)
      return
    }

    // AUTO-ROUTE: the destination is the card's OWN position, never the zone
    // it happened to land nearest. Dropping a WR on the QB panel files it
    // under WR — so the user only has to get the card near the zone row.
    const target = zoneForPosition(player.position)
    if (target === null) {
      // Live feed can return positions with no bin (K, DEF, ...). Those are
      // never sorted; treat the drop as "not a zone drop".
      print(`[DraftDay] ${player.name} has position "${player.position}" — no tier zone for it; leaving in the arc pool.`)
      if (heldBy !== null) this.pullOutOfZone(card, id)
      return
    }

    if (heldBy === target) {
      // Re-dropped into the zone it already lives in: just re-seat it in the
      // stack so it snaps back into the fan instead of hanging where dropped.
      this.zones.detachCard(id)
      this.zones.attachCard(target, card)
      this.zones.playLandPop(target)
      return
    }

    // Move custody: out of its old home (another zone, or the arc pool), into
    // the target zone. State and view are updated in the same operation.
    if (heldBy !== null) this.zones.detachCard(id)
    else this.cardField.releaseCard(card)

    this.state.assignZone(id, target)
    this.zones.attachCard(target, card)
    this.zones.playLandPop(target)
    this.refreshStatus()
    this.applyByeClashes()
  }

  private pullOutOfZone(card: DraftDayCardUI, id: string): void {
    this.zones.detachCard(id)
    this.state.clearZone(id)
    this.cardField.adoptCard(card)
    // Cleared explicitly: once detached this card is no longer in
    // zones.getAllCards(), so applyByeClashes() below will not visit it, and a
    // stale warning border would ride back out into the arc with it. Arc-pool
    // cards are never marked.
    card.setClashWarning(false)
    this.refreshStatus()
    this.applyByeClashes()
  }
}
