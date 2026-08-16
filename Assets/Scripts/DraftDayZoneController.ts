/**
 * DraftDayZoneController — the four tier drop zones (QB / RB / WR / TE) as
 * real 3D regions in world space.
 *
 * Attached to the authored "Zones" group root under DraftDay. The four zone
 * panels are authored sibling SceneObjects wired in through @input, so their
 * placement, size and colors are all editable in the Inspector without
 * touching code (Hard Rule 5).
 *
 * Owns:
 * - the drop-region hit test (zoneAtWorldPosition) — a padded, oriented box
 *   around each zone panel, sized so a release must be deliberately at the
 *   zone row, while WHICH zone it lands nearest still does not matter (see the
 *   auto-route note below);
 * - custody of the card SceneObjects sitting in each stack, and their fanned
 *   stack layout / visible-count capping;
 * - pushing the per-zone count into each DraftDayZoneUI;
 * - the shared bye-clash banner above the row (setClashBanner), whose text is
 *   composed elsewhere — this module renders it and never computes it.
 *
 * Does NOT own:
 * - WHICH zone a card belongs in. That is auto-routed from the card's own
 *   position by DraftDayState.zoneForPosition() and decided by DraftDayMain.
 *   Hit-testing here answers only "was this released near ANY zone?" — never
 *   "which zone is nearest". A WR card dropped over the QB panel goes to WR.
 * - zone MEMBERSHIP as domain state; that is DraftDayState.zoneAssignments.
 *   The per-zone arrays here are view state (visual stack order + the actual
 *   SceneObjects). DraftDayMain is the only mutator of both and updates them
 *   in the same operation, so they cannot diverge.
 *
 * Vocabulary note: placing a card here is the USER'S OWN TIER SORTING. It is
 * not "drafting" — see the header of DraftDayState.ts.
 */
import { DraftDayCardUI } from "./DraftDayCardUI"
import { DraftDayZoneUI } from "./DraftDayZoneUI"
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import { ZoneKey, ZONE_KEYS } from "./DraftDayState"

// ── Effective-value ceilings and floors ─────────────────────────────────────
// Every @input below is authored per-instance in Scene.scene, so changing a
// default here would be silently overridden by the stored value and nothing
// would move. These bounds are applied in code instead — the same approach
// DraftDayZoneUI uses for its panel height. Authored values that already sit
// inside a bound are used unchanged; only out-of-range ones are pulled in.
//
// Delete a bound (and let the @input speak for itself) once the corresponding
// authored value has been updated in the Inspector.

// Zone panels are ~22cm tall, leaving a 10.3cm stack band:
//   22 − 2(1.2 padding) − 6.5 (header) − 1.6 (hint) − 2(0.6 row gap) = 10.3
// A fan of n cards occupies (n−1)·offsetY + 11·scale, where 11cm is the card's
// own height. At 1.0 / 0.70 a two-card fan needs 1.0 + 7.7 = 8.7cm and a
// three-card fan 9.7cm, both inside the band; effectiveMaxVisible() therefore
// settles at 3 and the header keeps reporting the true total above that. Two
// cards in a zone is the case that has to look good — a five-card fan only
// fits by shrinking the cards past legibility, which is the wrong trade.
const MAX_STACK_OFFSET_Y_CM = 1.0
const MAX_STACK_CARD_SCALE = 0.70

// Mirrors DraftDayCardUI's cardHeight @input default, as
// DraftDayCardFieldController does for its own spacing math. Only used to
// check that a fan fits its band.
const CARD_HEIGHT_BASELINE_CM = 11

// ── Drop acceptance ─────────────────────────────────────────────────────────
// Both pads are CEILINGS: the authored values (22 and 8) are larger than what
// the geometry below allows, and an over-large acceptance box was zoning cards
// during ordinary repositioning.
//
// Vertical — derived from the card arc rather than picked. From
// DraftDayCardFieldController's authored inputs (radiusCm 165, columns 8,
// rowGapCm 14) and DraftDayMain's maxVisibleCards 24, with every root at the
// origin at scale 1 so arc-local Y is world Y:
//     arc scale        = 165 / 110            = 1.5
//     scaled card      = 11 × 1.5             = 16.5cm tall
//     row gap          = max(14 × 1.5, 16.5 + 2) = 21cm
//     rows             = ceil(24 / 8)         = 3
//     top row Y        = (3 − 1) × 21 / 2     = +21
//     lowest row Y     = 21 − 2 × 21          = −21
//     lowest row floor = −21 − 16.5 / 2       = −29.25   ← world Y
// The panels sit at world Y −58 at scale 1.09, so a box half-height of H local
// cm reaches up to −58 + 1.09·H. Putting the top edge a deliberate 15cm below
// the arc's lowest card edge means −44.25, so:
//     H = (−44.25 + 58) / 1.09 = 12.61 local cm
//     pad = H − panelHeight/2  = 12.61 − 11 = 1.6 local cm
// which lands the acceptance top at world Y −44.3 — 15.0cm of clear air under
// the arc. Re-derive this if the arc radius, row count or panel height change.
const MAX_DROP_PAD_Y_CM = 1.6

// Horizontal — each panel's box is about 1.5× its own width (24cm), so
// half-width = 12 + 6 = 18 local = 19.6cm world. Adjacent panel centers are
// 45.8cm apart, so consecutive boxes stop ~6.6cm short of each other: four
// separate targets with dead space between them and beyond the outer two.
//
// This does not weaken auto-routing. Horizontal aim still never decides WHICH
// zone a card enters — the card's own position does. It only means a release
// has to be at the zone row to count as a sort at all, instead of anywhere in
// the lower half of the room.
const MAX_DROP_PAD_X_CM = 6

// ── Clash banner ────────────────────────────────────────────────────────────
// One shared warning line for the whole zone row, created in code under the
// authored Zones root (there is no authored SceneObject for it, and adding one
// would mean editing the scene). Sits above the panels and below the card arc,
// centered and unrotated, facing the user like the row it summarizes.
//
// Deliberately NOT built on a BackPlate: BackPlate creates a collider and an
// Interactable, which would put an invisible interaction target right where
// cards are dragged. RoundedRectangle and Text create neither, so the whole
// banner — plate, warning glyph and text — stays non-interactive.
//
// This is the product's payoff moment, so it is built as an alert rather than
// a caption: a filled crimson plate, white text at a size comparable to the
// zone position letters, a warning glyph assembled from two rectangles (no
// font glyph, so nothing can render as tofu), and a pulse driven from the same
// getTime() clock and the same frequency as the card border pulse, so the
// banner and the flagged cards breathe together instead of drifting.
const BANNER_Y_CM = -38
const BANNER_Z_CM = -110
const BANNER_PLATE_W_CM = 96
const BANNER_PLATE_H_CM = 7.4
const BANNER_PLATE_RADIUS_CM = 1.2
const BANNER_SIZE = 78
const BANNER_WEIGHT = 700
const BANNER_TEXT_W_CM = 76
const BANNER_TEXT_X_CM = 5
const BANNER_CONTENT_Z = 0.4

// Warning glyph: a bar and a dot, i.e. "!", built from primitives.
const GLYPH_X_CM = -40
const GLYPH_BAR_W_CM = 1.0
const GLYPH_BAR_H_CM = 3.0
const GLYPH_BAR_Y_CM = 0.9
const GLYPH_DOT_CM = 1.0
const GLYPH_DOT_Y_CM = -1.6

// Pulse: crimson at rest, brightening to a hot red. Driven in RGB, never
// alpha — a standalone RoundedRectangle discards alpha (see the bye-chip note
// in DraftDayCardUI), so a pulse written into the alpha channel would be
// invisible. Frequency is duplicated from DraftDayCardUI's CLASH_PULSE_HZ;
// both read getTime(), so equal frequency means locked phase.
const BANNER_PULSE_HZ = 0.55
const BANNER_DIM_R = 0.62
const BANNER_DIM_G = 0.05
const BANNER_DIM_B = 0.10
const BANNER_HOT_R = 0.94
const BANNER_HOT_G = 0.16
const BANNER_HOT_B = 0.20

@component
export class DraftDayZoneController extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">DraftDayZoneController – Four 3D tier drop zones: hit testing, card custody, stack layout</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">References</span>')
  @ui.group_start("References")
  @input
  @hint("Authored QB zone panel SceneObject's DraftDayZoneUI component")
  zoneQB!: DraftDayZoneUI

  @input
  @hint("Authored RB zone panel SceneObject's DraftDayZoneUI component")
  zoneRB!: DraftDayZoneUI

  @input
  @hint("Authored WR zone panel SceneObject's DraftDayZoneUI component")
  zoneWR!: DraftDayZoneUI

  @input
  @hint("Authored TE zone panel SceneObject's DraftDayZoneUI component")
  zoneTE!: DraftDayZoneUI
  @ui.group_end

  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @widget(new SliderWidget(0, 40, 1))
  @hint("Horizontal slack around each zone panel that still counts as a drop, in centimeters. Generous by design — the card is routed by its own position, not by which zone was closest, so aim buys nothing. Capped at MAX_DROP_PAD_X_CM in code so the four acceptance boxes stay separate, with dead space between them.")
  dropPadXCm: number = 22

  @input
  @widget(new SliderWidget(0, 30, 1))
  @hint("Vertical slack around each zone panel that still counts as a drop, in centimeters. Keep well below the gap to the card arc above, or nudging an arc card downward would zone it by accident. Capped at MAX_DROP_PAD_Y_CM in code, derived from the card arc's lowest row — see the note at the top of the file.")
  dropPadYCm: number = 8

  @input
  @widget(new SliderWidget(10, 120, 5))
  @hint("Depth slack in front of and behind each zone panel that still counts as a drop, in centimeters. Large on purpose: judging depth in AR is the hardest part of the drop, so it should not have to be accurate.")
  dropPadZCm: number = 70

  @input
  @widget(new SliderWidget(0.3, 1.2, 0.05))
  @hint("Scale applied to a card once it is sitting in a zone stack, relative to the zone panel. Capped at MAX_STACK_CARD_SCALE in code so a full fan fits the panel's stack band.")
  stackCardScale: number = 0.8

  @input
  @widget(new SliderWidget(1, 8, 0.1))
  @hint("Vertical drop between consecutive cards in a zone stack, in centimeters — how far the fan spreads. Capped at MAX_STACK_OFFSET_Y_CM in code so a full fan fits the panel's stack band.")
  stackOffsetYCm: number = 2.6

  @input
  @widget(new SliderWidget(0, 3, 0.1))
  @hint("Horizontal stagger between consecutive cards in a zone stack, in centimeters")
  stackOffsetXCm: number = 0.6

  @input
  @widget(new SliderWidget(1, 10, 1))
  @hint("How many cards a zone stack shows before the rest are hidden behind the header count. Also capped by how many actually fit the panel's stack band — see effectiveMaxVisible().")
  maxVisibleStack: number = 5
  @ui.group_end

  // View state: the actual card objects in each stack, in visual stack order.
  private stacks: Map<ZoneKey, DraftDayCardUI[]> = new Map()

  private clashBanner: Text | null = null
  private bannerPlate: RoundedRectangle | null = null

  onAwake() {
    for (const key of ZONE_KEYS) this.stacks.set(key, [])
    this.buildClashBanner()
    // Cheap: returns on the first branch whenever the banner is hidden, which
    // is most of the session.
    this.createEvent("UpdateEvent").bind(() => this.updateBannerPulse())
    if (!this.zoneQB || !this.zoneRB || !this.zoneWR || !this.zoneTE) {
      print("[DraftDayZoneController] ERROR: one or more zone @inputs not wired (zoneQB/zoneRB/zoneWR/zoneTE). Check the Phase B bootstrap wiring.")
      return
    }
    // The zone panels build their own chrome in onAwake; labels/counts are
    // pushed after that, on start, so nothing races their construction.
    this.createEvent("OnStartEvent").bind(() => {
      for (const key of ZONE_KEYS) {
        const ui = this.uiFor(key)
        if (ui) {
          ui.setZoneLabel(key)
          ui.setCount(0)
        }
      }
    })
  }

  // ── Hit testing ──────────────────────────────────────────────────────────
  /**
   * Was `worldPos` released near ANY zone? Returns the first zone whose padded
   * box contains the point.
   *
   * The boxes no longer overlap: each is about 1.5x its panel's width, with
   * dead space between them and beyond the outer two, so a release has to be
   * AT the zone row to count as a sort. That is a separate question from aim —
   * the identity of the hit zone is still never used to decide where the card
   * goes, because DraftDayMain routes by the card's own position. This is only
   * a yes/no "is this a drop into the zone row" test.
   */
  zoneAtWorldPosition(worldPos: vec3): ZoneKey | null {
    for (const key of ZONE_KEYS) {
      if (this.isNearZone(key, worldPos)) return key
    }
    return null
  }

  private isNearZone(key: ZoneKey, worldPos: vec3): boolean {
    const ui = this.uiFor(key)
    if (!ui || isNull(ui.sceneObject)) return false
    // Zone panels are yaw-rotated to face the user, so the test runs in each
    // panel's own frame rather than as an axis-aligned world box.
    const local = ui.sceneObject.getTransform().getInvertedWorldTransform().multiplyPoint(worldPos)
    const halfW = ui.panelWidthCm() / 2 + this.effectiveDropPadX()
    const halfH = ui.panelHeightCm() / 2 + this.effectiveDropPadY()
    return Math.abs(local.x) <= halfW
      && Math.abs(local.y) <= halfH
      && Math.abs(local.z) <= this.dropPadZCm
  }

  // ── Clash banner ──────────────────────────────────────────────────────────
  private buildClashBanner(): void {
    const root = global.scene.createSceneObject("ClashBanner")
    root.setParent(this.sceneObject)
    root.getTransform().setLocalPosition(new vec3(0, BANNER_Y_CM, BANNER_Z_CM))
    root.createComponent("Component.Canvas")

    // Plate first — everything after it in the hierarchy paints on top.
    const plate = root.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    plate.size = new vec2(BANNER_PLATE_W_CM, BANNER_PLATE_H_CM)
    plate.cornerRadius = BANNER_PLATE_RADIUS_CM
    plate.backgroundColor = new vec4(BANNER_DIM_R, BANNER_DIM_G, BANNER_DIM_B, 1)
    plate.initialize()
    this.bannerPlate = plate

    // "!" from two rectangles rather than a font glyph: nothing to be missing
    // from the runtime font, so it cannot render as tofu.
    this.makeGlyphPart("BannerGlyphBar", GLYPH_BAR_W_CM, GLYPH_BAR_H_CM, GLYPH_BAR_Y_CM, root)
    this.makeGlyphPart("BannerGlyphDot", GLYPH_DOT_CM, GLYPH_DOT_CM, GLYPH_DOT_Y_CM, root)

    const labelObj = global.scene.createSceneObject("BannerLabel")
    labelObj.setParent(root)
    labelObj.getTransform().setLocalPosition(new vec3(BANNER_TEXT_X_CM, 0, BANNER_CONTENT_Z))
    const t = labelObj.createComponent("Component.Text") as Text
    t.text = ""
    t.depthTest = true
    t.size = BANNER_SIZE
    ;(t as Text & { weight?: number }).weight = BANNER_WEIGHT
    // White on crimson. No outline: the text now sits on its own filled plate,
    // so the plate is the contrast guarantee an outline would otherwise fake.
    t.textFill.color = new vec4(1, 1, 1, 1)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    // Ellipsis rather than Overflow: a second clash doubles the string, and
    // white text spilling off the plate onto open air would be unreadable.
    // Every clashing card is still pulsing regardless of what the line shows.
    t.horizontalOverflow = HorizontalOverflow.Ellipsis
    t.verticalOverflow = VerticalOverflow.Overflow
    t.layoutRect = Rect.create(-BANNER_TEXT_W_CM / 2, BANNER_TEXT_W_CM / 2, -2.6, 2.6)

    this.clashBanner = t
    root.enabled = false
  }

  private makeGlyphPart(name: string, w: number, h: number, y: number, parent: SceneObject): void {
    const so = global.scene.createSceneObject(name)
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(GLYPH_X_CM, y, BANNER_CONTENT_Z))
    const rect = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rect.size = new vec2(w, h)
    rect.cornerRadius = Math.min(w, h) / 2
    rect.backgroundColor = new vec4(1, 1, 1, 1)
    rect.initialize()
  }

  /**
   * Pulses the banner plate between crimson and hot red, in RGB.
   *
   * Uses getTime() at the same frequency as DraftDayCardUI's clash pulse, so
   * the banner and every flagged card cross their peaks on the same frames.
   * Returns immediately while the banner is hidden.
   */
  private updateBannerPulse(): void {
    const plate = this.bannerPlate
    if (!plate || isNull(plate)) return
    if (isNull(plate.sceneObject) || !plate.sceneObject.enabled) return
    const wave = (Math.sin(getTime() * BANNER_PULSE_HZ * 2 * Math.PI) + 1) / 2
    plate.backgroundColor = new vec4(
      BANNER_DIM_R + (BANNER_HOT_R - BANNER_DIM_R) * wave,
      BANNER_DIM_G + (BANNER_HOT_G - BANNER_DIM_G) * wave,
      BANNER_DIM_B + (BANNER_HOT_B - BANNER_DIM_B) * wave,
      1
    )
  }

  /**
   * Shows the shared bye-clash warning line, or hides it entirely when passed
   * an empty string. The text is composed by DraftDayMain — this controller
   * renders it and knows nothing about bye weeks.
   */
  setClashBanner(text: string): void {
    if (!this.clashBanner || isNull(this.clashBanner)) return
    this.clashBanner.text = text
    // The label sits on a child object now, so visibility is toggled on the
    // banner ROOT — the plate, glyph and text are all under it.
    const root = this.clashBanner.sceneObject.getParent()
    if (root && !isNull(root)) root.enabled = text.length > 0
  }

  // ── Drop-target preview ───────────────────────────────────────────────────
  /**
   * Arms `target` as the zone a held card would land in, dimming the other
   * three; pass null to clear the preview entirely (nothing held, or held
   * somewhere that would not sort).
   *
   * Pure feedback. This sets no state that routing or the hit test reads —
   * DraftDayMain decides the target with the same two predicates it uses to
   * perform the drop, so the preview cannot claim a destination the drop would
   * not honor.
   */
  setDropPreview(target: ZoneKey | null): void {
    for (const key of ZONE_KEYS) {
      const ui = this.uiFor(key)
      if (!ui || isNull(ui.sceneObject)) continue
      if (target === null) ui.setHighlight("normal")
      else ui.setHighlight(key === target ? "target" : "dimmed")
    }
  }

  /** Fires the landing flash on one zone. */
  playLandPop(zone: ZoneKey): void {
    const ui = this.uiFor(zone)
    if (!ui || isNull(ui.sceneObject)) return
    ui.playLandPop()
  }

  // ── Effective settings ────────────────────────────────────────────────────
  // See the bounds at the top of the file for why these are applied in code
  // rather than as @input defaults.

  private effectiveDropPadX(): number {
    return Math.min(this.dropPadXCm, MAX_DROP_PAD_X_CM)
  }

  private effectiveDropPadY(): number {
    return Math.min(this.dropPadYCm, MAX_DROP_PAD_Y_CM)
  }

  private effectiveStackOffsetY(): number {
    return Math.min(this.stackOffsetYCm, MAX_STACK_OFFSET_Y_CM)
  }

  private effectiveStackCardScale(): number {
    return Math.min(this.stackCardScale, MAX_STACK_CARD_SCALE)
  }

  /**
   * How many cards a stack may show without the fan overflowing its panel.
   *
   * The authored maxVisibleStack is an upper bound, but the real limit is
   * geometric: the band the panel holds open has to fit one whole card plus
   * one offset per additional card. Deriving it here (rather than hardcoding
   * "5") means a later change to panel height, card scale or fan spread can't
   * silently reintroduce cards hanging off the bottom of a panel — the count
   * simply drops and the header keeps reporting the true total.
   */
  private effectiveMaxVisible(ui: DraftDayZoneUI): number {
    const offset = this.effectiveStackOffsetY()
    const cardHeight = CARD_HEIGHT_BASELINE_CM * this.effectiveStackCardScale()
    const band = ui.stackHeightCm()
    const fits = offset > 0 ? Math.floor((band - cardHeight) / offset) + 1 : 1
    return Math.max(1, Math.min(this.maxVisibleStack, fits))
  }

  // ── Card custody ─────────────────────────────────────────────────────────
  /**
   * Take custody of a card and stack it in `zone`. The caller must have
   * already removed it from whatever owned it before (the arc pool via
   * DraftDayCardFieldController.releaseCard, or another zone via detachCard).
   */
  attachCard(zone: ZoneKey, card: DraftDayCardUI): void {
    const ui = this.uiFor(zone)
    if (!ui) return
    const stackRoot = ui.getStackRoot()
    if (isNull(stackRoot)) return

    const stack = this.stacks.get(zone)
    if (!stack || stack.indexOf(card) >= 0) return

    card.sceneObject.setParent(stackRoot)
    stack.push(card)
    this.layoutStack(zone)
  }

  /**
   * Give up custody of the card holding `playerId`, wherever it is stacked.
   * The SceneObject is left alone (still parented into the zone, still at its
   * current world pose) — the caller re-parents it. Returns null if no zone
   * holds that player.
   */
  detachCard(playerId: string): DraftDayCardUI | null {
    for (const key of ZONE_KEYS) {
      const stack = this.stacks.get(key)
      if (!stack) continue
      for (let i = 0; i < stack.length; i++) {
        if (stack[i].getPlayerId() === playerId) {
          const card = stack[i]
          stack.splice(i, 1)
          this.layoutStack(key)
          return card
        }
      }
    }
    return null
  }

  /** Which zone currently holds this player's card object, if any. */
  zoneHolding(playerId: string): ZoneKey | null {
    for (const key of ZONE_KEYS) {
      const stack = this.stacks.get(key)
      if (!stack) continue
      for (const card of stack) {
        if (card.getPlayerId() === playerId) return key
      }
    }
    return null
  }

  /** Every card currently in custody, across all four stacks. */
  getAllCards(): DraftDayCardUI[] {
    const out: DraftDayCardUI[] = []
    for (const key of ZONE_KEYS) {
      const stack = this.stacks.get(key)
      if (stack) for (const card of stack) out.push(card)
    }
    return out
  }

  /** Drops every card in every stack — used when the roster is replaced. */
  clearAll(): void {
    for (const key of ZONE_KEYS) {
      const stack = this.stacks.get(key)
      if (!stack) continue
      for (const card of stack) {
        if (!isNull(card) && !isNull(card.sceneObject)) card.sceneObject.destroy()
      }
      this.stacks.set(key, [])
      const ui = this.uiFor(key)
      if (ui) ui.setCount(0)
    }
  }

  // ── Stack layout ─────────────────────────────────────────────────────────
  /**
   * Fans the stack downward from the top of the zone's stack area. Only the
   * first maxVisibleStack cards are shown; the rest are hidden and accounted
   * for by the header count, so a deep stack never overflows the panel.
   * Later cards sit progressively further forward in Z so the fan reads as a
   * pile rather than as z-fighting coplanar quads.
   */
  private layoutStack(zone: ZoneKey): void {
    const ui = this.uiFor(zone)
    const stack = this.stacks.get(zone)
    if (!ui || !stack) return

    const offsetY = this.effectiveStackOffsetY()
    const cardScale = this.effectiveStackCardScale()
    const visible = Math.min(stack.length, this.effectiveMaxVisible(ui))
    const topY = ((visible - 1) * offsetY) / 2

    for (let i = 0; i < stack.length; i++) {
      const card = stack[i]
      if (isNull(card) || isNull(card.sceneObject)) continue
      const shown = i < visible
      card.setVisible(shown)
      if (!shown) continue
      const t = card.sceneObject.getTransform()
      t.setLocalPosition(new vec3(
        (i - (visible - 1) / 2) * this.stackOffsetXCm,
        topY - i * offsetY,
        i * 0.25
      ))
      t.setLocalRotation(quat.quatIdentity())
      t.setLocalScale(new vec3(cardScale, cardScale, cardScale))
    }

    ui.setCount(stack.length)
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private uiFor(zone: ZoneKey): DraftDayZoneUI | null {
    switch (zone) {
      case "QB": return this.zoneQB
      case "RB": return this.zoneRB
      case "WR": return this.zoneWR
      case "TE": return this.zoneTE
      default: return null
    }
  }
}
