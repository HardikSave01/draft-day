/**
 * DraftDayCardFieldController — spawns and arranges player cards in 3D
 * world space around the user as a gentle wraparound arc (rows of cards),
 * replacing the old flat 2D FlexLayout + pagination grid.
 *
 * Attached to the authored "Cards" root SceneObject (formerly "CardGrid")
 * — the one grab/move handle for the whole card field (Hard Rule 5). This
 * component treats its own SceneObject's local origin as the arc's pivot
 * (the user's approximate position), so it must stay parented directly
 * under an unrotated, origin-positioned ancestor (the DraftDay root).
 *
 * Owns: THE ARC POOL ONLY — the cards currently laid out in the arc, spawned
 * fresh and destroyed on every setPlayers() call. Card count is
 * data/filter-driven, so this is script-built content under a movable unit
 * root per Hard Rule 5, not hand-authored per-card slots.
 *
 * ── Arc pool vs zoned cards ────────────────────────────────────────────────
 * Cards the user has sorted into a tier zone are NOT part of the arc pool.
 * When a card is zoned, DraftDayMain calls releaseCard() and this controller
 * forgets it entirely — so the destroy-and-respawn in clearCards() can never
 * touch it, and a filter change re-lays out only the cards still in the arc.
 * That narrowing is what makes zone placement persist across filter changes.
 * When a card is pulled back out of a zone, adoptCard() re-admits it so the
 * next re-layout disposes of it normally (and no duplicate is spawned).
 *
 * Public API (Channel A — event bus):
 * - setPlayers(players)  — replace the arc pool (destroy + respawn)
 * - releaseCard(card)    — hand a card off to a zone; do NOT destroy it
 * - adoptCard(card)      — take a pulled-out card back into the arc pool
 * - arcCardScale()       — the uniform scale arc cards are spawned at
 * - onCardReleased: Event<DraftDayCardUI> — forwarded from each spawned card
 * - onCardGrabStart / onCardGrabMove: Event<DraftDayCardUI> — likewise, for
 *   the drop-target preview
 *
 * Holds no domain state beyond its own spawned card pool. Must not read
 * DraftDayState directly and must not own the visible-count cap — that's
 * DraftDayState.getArcPoolPlayers(), called by DraftDayMain, which passes the
 * already-filtered, already-capped list in here.
 */
import { DraftDayCardUI } from "./DraftDayCardUI"
import { Player } from "./DraftDayDataService"
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event"

// Baseline viewing distance DraftDayCardUI's internal text/panel sizing is
// calibrated for (see its NAME_SIZE, tuned around a 110cm flat panel).
// Cards placed farther than this are uniformly scaled up so their angular
// (apparent) size on the eye stays constant — see setPlayers()'s `scale`.
const BASELINE_CM = 110

// Mirrors DraftDayCardUI's own cardWidth/cardHeight @input defaults. Cards
// are spawned here with no width/height override, so every spawned card is
// exactly this size (pre-scale). Used only to derive the minimum row/column
// spacing that guarantees no overlap once cards are scaled up for distance.
const CARD_WIDTH_BASELINE_CM = 22
const CARD_HEIGHT_BASELINE_CM = 11
const MIN_BUFFER_CM = 2

@component
export class DraftDayCardFieldController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">DraftDayCardFieldController – Arranges player cards in a wraparound 3D arc around the user</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @widget(new SliderWidget(100, 220, 5))
  @hint("Distance from the user to the card arc, in centimeters. Cards are uniformly scaled by radiusCm/110 so apparent (angular) size stays constant regardless of distance.")
  radiusCm: number = 165

  @input
  @widget(new SliderWidget(30, 160, 5))
  @hint("Target horizontal angular span the card arc covers, in degrees (split evenly left/right of center). Widened automatically if columnGapDegrees would otherwise force card overlap.")
  arcSpanDegrees: number = 100

  @input
  @widget(new SliderWidget(1, 10, 1))
  @hint("Max card columns per row before wrapping to the next row")
  columns: number = 8

  @input
  @widget(new SliderWidget(8, 40, 1))
  @hint("Target vertical gap between card rows, in centimeters, before distance scaling. Enlarged automatically if it would otherwise be smaller than a scaled card's height plus a 2cm buffer.")
  rowGapCm: number = 14

  @input
  @widget(new SliderWidget(0, 20, 0.5))
  @hint("Minimum angular gap between adjacent columns beyond each card's own angular width, in degrees — the floor arcSpanDegrees/columns is widened to respect")
  columnGapDegrees: number = 1.5
  @ui.group_end

  // The arc pool: cards this controller owns and will destroy on the next
  // re-layout. Cards handed to a zone are removed from here (releaseCard) and
  // re-added when pulled back out (adoptCard).
  private spawned: DraftDayCardUI[] = []

  private _onCardReleased = new Event<DraftDayCardUI>()
  private _onCardGrabStart = new Event<DraftDayCardUI>()
  private _onCardGrabMove = new Event<DraftDayCardUI>()

  /** Forwarded from every card this controller spawns, for its whole lifetime. */
  get onCardReleased(): PublicApi<DraftDayCardUI> { return this._onCardReleased.publicApi() }

  /** Drag began / is moving, forwarded on the same terms as onCardReleased. */
  get onCardGrabStart(): PublicApi<DraftDayCardUI> { return this._onCardGrabStart.publicApi() }
  get onCardGrabMove(): PublicApi<DraftDayCardUI> { return this._onCardGrabMove.publicApi() }

  /** Uniform scale arc cards are spawned at (distance compensation). */
  arcCardScale(): number {
    return this.radiusCm / BASELINE_CM
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  setPlayers(players: Player[]): void {
    this.clearCards()
    if (players.length === 0) return

    const columns = Math.max(1, Math.min(this.columns, players.length))
    const rows = Math.ceil(players.length / columns)
    const scale = this.radiusCm / BASELINE_CM

    // Minimum angular column step that guarantees adjacent cards (at their
    // scaled width) never overlap, regardless of the configured arcSpanDegrees.
    const scaledCardWidth = CARD_WIDTH_BASELINE_CM * scale
    const cardAngularWidthDeg = (scaledCardWidth / this.radiusCm) * (180 / Math.PI)
    const minAngleStepDeg = cardAngularWidthDeg + this.columnGapDegrees
    const evenAngleStepDeg = columns > 1 ? this.arcSpanDegrees / (columns - 1) : 0
    const angleStepDeg = Math.max(minAngleStepDeg, evenAngleStepDeg)

    // Minimum row gap that guarantees adjacent rows (at their scaled height)
    // never overlap, regardless of the configured rowGapCm.
    const scaledCardHeight = CARD_HEIGHT_BASELINE_CM * scale
    const minRowGapCm = scaledCardHeight + MIN_BUFFER_CM
    const rowGap = Math.max(this.rowGapCm * scale, minRowGapCm)
    const topRowY = ((rows - 1) * rowGap) / 2

    for (let i = 0; i < players.length; i++) {
      const row = Math.floor(i / columns)
      const col = i % columns
      const itemsInRow = Math.min(columns, players.length - row * columns)
      const rowStartDeg = itemsInRow > 1 ? -((itemsInRow - 1) * angleStepDeg) / 2 : 0
      const angleDeg = rowStartDeg + col * angleStepDeg
      const angleRad = (angleDeg * Math.PI) / 180

      // Rotate a fixed "straight ahead" base position by the same yaw
      // applied to the card's own orientation — this rigidly preserves
      // "card front points back at the pivot origin" for any yaw (see
      // header). Row stacking is a pure vertical translation afterward
      // (yaw-only billboarding — cards stay upright, not tilted).
      const rot = quat.fromEulerAngles(0, angleRad, 0)
      const basePos = new vec3(0, 0, -this.radiusCm)
      const rotatedPos = rot.multiplyVec3(basePos)
      const y = topRowY - row * rowGap

      const cardObj = global.scene.createSceneObject(`Card_${i}`)
      cardObj.setParent(this.sceneObject)
      const t = cardObj.getTransform()
      t.setLocalPosition(new vec3(rotatedPos.x, rotatedPos.y + y, rotatedPos.z))
      t.setLocalRotation(rot)
      t.setLocalScale(new vec3(scale, scale, scale))

      const card = cardObj.createComponent(DraftDayCardUI.getTypeName()) as DraftDayCardUI
      card.setPlayer(players[i])
      // Subscribed once, at spawn, and never re-subscribed: the forwarding
      // stays live for the card's whole life, including while it is parented
      // into a tier zone, so pull-out drops report through the same channel.
      card.onReleased.add((c) => this._onCardReleased.invoke(c))
      // Same lifetime, same reason: a card already sitting in a zone must
      // preview its target while being dragged out and back, exactly like an
      // arc card does.
      card.onGrabStart.add((c) => this._onCardGrabStart.invoke(c))
      card.onGrabMove.add((c) => this._onCardGrabMove.invoke(c))

      this.spawned.push(card)
    }
  }

  /**
   * Hand a card off to a tier zone. The SceneObject is NOT destroyed — it is
   * simply forgotten by the arc pool, so the next clearCards() cannot touch
   * it. The caller (DraftDayMain) is responsible for re-parenting it.
   */
  releaseCard(card: DraftDayCardUI): void {
    const i = this.spawned.indexOf(card)
    if (i >= 0) this.spawned.splice(i, 1)
  }

  /**
   * Re-admit a card that was pulled back out of a tier zone: re-parent it
   * under the arc root (preserving where the user let go of it) and restore
   * the arc's distance-compensation scale. Its position is deliberately NOT
   * corrected to an arc slot — it keeps the spot the user dropped it in and
   * takes a normal slot on the next re-layout, which is also when it will be
   * destroyed, so no duplicate can be spawned for the same player.
   */
  adoptCard(card: DraftDayCardUI): void {
    if (this.spawned.indexOf(card) >= 0) return
    const obj = card.sceneObject
    const t = obj.getTransform()
    // setParent preserves the LOCAL transform, so world pose must be
    // re-asserted or the card teleports out of the user's hand on drop.
    const worldPos = t.getWorldPosition()
    const worldRot = t.getWorldRotation()
    obj.setParent(this.sceneObject)
    t.setWorldPosition(worldPos)
    t.setWorldRotation(worldRot)
    const s = this.arcCardScale()
    t.setLocalScale(new vec3(s, s, s))
    this.spawned.push(card)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  /** Destroys ONLY arc-pool cards. Zoned cards are not in `spawned`. */
  private clearCards(): void {
    for (const card of this.spawned) {
      if (!isNull(card) && !isNull(card.sceneObject)) card.sceneObject.destroy()
    }
    this.spawned = []
  }
}
