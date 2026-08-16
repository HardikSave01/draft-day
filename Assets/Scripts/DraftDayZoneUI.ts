/**
 * DraftDayZoneUI — one tier drop-zone panel (QB / RB / WR / TE).
 *
 * The SAME @component class is attached to four authored sibling
 * SceneObjects under DraftDay/Zones; each instance is differentiated purely
 * by its @input values (zoneLabel / accentColor), so nothing in here is
 * hardcoded to a single position.
 *
 * Owns: this panel's visual chrome ONLY — the light readability backplate, the
 * header (position label + stack count), the left-edge position color bar, and
 * the "empty" hint caption.
 *
 * Does NOT own: the player cards themselves. Card SceneObjects are parented
 * under getStackRoot() and positioned/scaled by DraftDayZoneController. This
 * module never creates, moves, destroys, or reads a card — it is a passive
 * view that renders exactly what setZoneLabel()/setCount() push in, and it
 * holds no domain state (which players are in which zone lives in
 * DraftDayState; the stack's visual order lives in DraftDayZoneController).
 *
 * Public API (Channel A — event bus):
 * - setZoneLabel(label)  — header position label
 * - setCount(n)          — header count; also toggles the empty hint
 * - getStackRoot()       — the mount point external code parents cards under
 * - setHighlight(mode)   — drop-target preview state pushed in from outside
 * - playLandPop()        — short flash when a card actually lands here
 * - panelWidthCm() / panelHeightCm() — panel extents, used by the
 *   controller's drop-region hit test
 * No events — this panel has no interactive affordances of its own.
 */
import { FlexLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import { FlexItem } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign, FlexDirection, FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"

// ── Zone panel type hierarchy ───────────────────────────────────────────────
// The panel has exactly one job when you glance at it: say which pile it is.
// So the position letter is the dominant element by a wide margin, the count
// sits beside it as a secondary fact, and the hint is a caption — not, as
// before, three strings within a few points of each other on one flat ramp.
const LETTER_SIZE = 120
const LETTER_WEIGHT = 700
const COUNT_SIZE = Math.round(LETTER_SIZE * 0.42)
const COUNT_WEIGHT = 500
const HINT_SIZE = Math.round(LETTER_SIZE * 0.28)
const HINT_WEIGHT = 400

// Half-height, in cm, that one line of text reserves per unit of font size.
// Same ratio as DraftDayCardUI's; verify in Preview alongside LETTER_SIZE.
const LINE_HEIGHT_PER_SIZE = 1.2 / 48

function applyType(t: Text, size: number, weight: number): void {
  t.size = size
  ;(t as Text & { weight?: number }).weight = weight
}

// ── Readability surface + ink (additive-display pass) ───────────────────────
// Kept byte-identical across the three Draft Day UI modules: each module owns
// its own copy so a change is corrected per module rather than re-derived per
// call site.
//
// On an additive display black is transparent, so the old dark BackPlate
// styles ("default"/"dark", value 0.09–0.27 grey) were effectively holes —
// whatever the user was looking at showed straight through the card and
// competed with the text. A LIGHT, semi-opaque plate is the opposite: it lays
// down its own light, so text always has a surface behind it.
//
// Alpha was 0.85, which held up indoors but washed out against a white wall in
// a bright room: at 0.85 the passthrough behind the plate is still supplying
// ~15% of every pixel, and against a bright wall that is enough to lift the
// ink's background and collapse the contrast the dark text depends on. 0.94
// leaves just enough transparency to read as an AR overlay rather than a solid
// tile, while making the surface almost entirely the plate's own light.
const SURFACE_R = 0.90
const SURFACE_G = 0.92
const SURFACE_B = 0.96
const SURFACE_A = 0.97

// Text sits ON that light plate, so it is near-black, not white.
//
// There is deliberately NO outline and NO drop shadow here. An outline is a
// technique for light text over an UNKNOWN background: it manufactures an edge
// where none is guaranteed. Once the plate is light and the text is dark, the
// plate itself is that guarantee, and the outline only thickens every stroke
// until the counters (the enclosed gaps in a, e, o, 8) fill in and the line
// smears into a dark band. If a string is ever placed over open air rather
// than over a plate, it needs its own outline treatment again — but nothing in
// this module does.
function ink(): vec4 {
  return new vec4(0.08, 0.09, 0.12, 1)
}

/** Lower-emphasis ink for supporting lines. Still solid, never faded to alpha. */
function inkSoft(): vec4 {
  return new vec4(0.30, 0.32, 0.36, 1)
}

/** Repaints a BackPlate's rounded rectangle as the light, semi-opaque surface. */
function applyLightSurface(so: SceneObject): void {
  const rect = so.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
  if (!rect || isNull(rect)) return
  rect.gradient = false
  rect.backgroundColor = new vec4(SURFACE_R, SURFACE_G, SURFACE_B, SURFACE_A)
}
// ── End of the shared readability block ─────────────────────────────────────

// ── The four position colors ────────────────────────────────────────────────
// Duplicated from DraftDayCardUI's colorQB/colorRB/colorWR/colorTE @input
// defaults so a zone panel's edge bar is the same color as the edge bar on the
// cards that belong in it. Change one, change the other.
//
// This deliberately takes precedence over the `accentColor` @input for the
// four known position labels: accentColor is authored per zone panel in the
// scene and still holds the pre-readability-pass pastels, which no longer
// match the cards. accentColor remains the color for any other label.
//
// Returns a fresh vec3 per call (rather than handing out one shared instance
// that a caller could mutate), and null for any label that is not one of the
// four positions.
function positionColor(label: string): vec3 | null {
  switch (label) {
    case "QB": return new vec3(0.55, 0.16, 0.82)
    case "RB": return new vec3(0.05, 0.62, 0.28)
    case "WR": return new vec3(0.08, 0.42, 0.96)
    case "TE": return new vec3(0.98, 0.68, 0.04)
    default: return null
  }
}

// Left-edge position bar (this module only). Widened alongside the card's, so
// the same color block reads at the same weight in both places; the panel's
// flex paddingLeft is derived from it below, which is what keeps the header
// label clear of it. BAR_Z matches DraftDayCardUI's bar: in front of the
// plate's face, behind the text.
const BAR_WIDTH_CM = 2.0
const BAR_INSET_CM = 0.2
const BAR_Z = 0.55
const BAR_CLEARANCE_CM = 0.6

// ── Roster requirements ─────────────────────────────────────────────────────
// A standard lineup: one QB, two RBs, two WRs, one TE. The panel states its
// count against this ("1 / 2") and says what is still missing, so "what does
// this board still need" is answerable without knowing any fantasy rules.
//
// Lives here rather than in DraftDayState because nothing behavioral reads it:
// no routing, no custody, no cap. It is presentation — a target the panel
// describes itself against — and keeping it here means zone custody code did
// not have to be touched to add it.
function rosterRequirement(label: string): number {
  switch (label) {
    case "QB": return 1
    case "RB": return 2
    case "WR": return 2
    case "TE": return 1
    default: return 0
  }
}

// An empty zone sits at lower plate alpha than a filled one, so a half-built
// roster is legible as a pattern of light and faint panels from across the
// room, before any count is readable.
const EMPTY_SURFACE_A = 0.70

// ── Drop-target highlight ───────────────────────────────────────────────────
// Auto-routing sends a card to the zone matching its own position, which is
// correct but invisible: to anyone who does not already know the rule, a card
// jumping to a panel they were not aiming at reads as a bug. So while a card
// is held inside the acceptance region, the zone it WILL land in brightens and
// takes a border in its own position color, and the other three dim.
//
// Painted onto the panel's own plate rectangle. Cards are separate objects
// parented under StackRoot, so none of this touches a card — a bye-clash card
// sitting in a highlighted or dimmed zone keeps pulsing exactly as before.
type ZoneHighlight = "normal" | "target" | "dimmed"

// Target: brighter and more opaque than the resting surface, so it reads as
// lit rather than merely less dim.
const TARGET_SURFACE_A = 0.97
const TARGET_BRIGHTEN = 0.10
const TARGET_BORDER_CM = 0.9

// Dimmed: a clear step down, but still legible — these panels keep their
// labels and counts readable while another zone is armed.
const DIM_SCALE = 0.80
const DIM_SURFACE_A = 0.62

// Land flash: a short bloom on the receiving panel when a card actually lands.
// Implemented as color + border rather than a scale pop because the panel's
// transform is authored (scale 1.09) and its children are the stacked cards —
// animating scale would jerk the cards and risk leaving the authored value
// wrong if a lens is interrupted mid-animation. This restores itself from the
// current highlight state every frame instead.
const POP_DURATION_S = 0.28
const POP_BORDER_CM = 2.2

// Content layout constants. The stack area's height is whatever is left over
// once the header, hint, gaps, and padding are subtracted from panelHeight —
// see buildContent(). Keeping this derived (rather than a magic "panelHeight
// − 8") is what lets panelHeight stay a live Inspector slider without the
// content overflowing its own backplate.
const PAD = 1.2
const ROW_GAP = 0.6
// The header band now has to hold a 120-size letter, so it is taller than the
// old 4.5; the hint band shrinks in step, since the hint is now a caption.
const HEADER_H = 6.5
const HINT_H = 1.6
const CONTENT_Z = 0.6
const STACK_ROOT_Z = 0.9

// ── Panel height ceiling ────────────────────────────────────────────────────
// The four panels are authored 24 x 30cm in Scene.scene, which made a zone the
// largest object in view while usually holding zero or one card — a lot of
// empty plate for a bin. A panel should read as roughly two stacked cards
// (a card is 11cm tall), so the authored height is treated as a MAXIMUM and
// clamped here.
//
// Why a clamp instead of just changing the @input default: panelHeight is
// authored per panel in the scene, so a new default would be overridden by the
// stored 30 and nothing would visibly change. Lower authored values are still
// honored — this only pulls the ceiling down. Once the four panels are set to
// 22 in the Inspector, this clamp becomes a no-op and can be deleted.
const MAX_PANEL_HEIGHT_CM = 22

@component
export class DraftDayZoneUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">DraftDayZoneUI – One tier drop-zone panel: position label, stack count, card mount point</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Position label shown in this zone's header (QB / RB / WR / TE)")
  zoneLabel: string = "QB"

  @input('vec3', '{0.9,0.45,0.45}')
  @widget(new ColorWidget())
  @hint("Header label tint; match the matching position badge color on the cards")
  accentColor: vec3 = new vec3(0.9, 0.45, 0.45)

  @input
  @widget(new SliderWidget(16, 36, 0.5))
  @hint("Zone panel width in centimeters")
  panelWidth: number = 24

  @input
  @widget(new SliderWidget(18, 44, 0.5))
  @hint("Zone panel height in centimeters")
  panelHeight: number = 30

  @input
  @hint("Caption shown inside the zone while its stack is empty")
  emptyHintText: string = "drop cards here"
  @ui.group_end

  private labelText!: Text
  private countText!: Text
  private hintText!: Text
  private stackRoot!: SceneObject
  private positionBar: RoundedRectangle | null = null
  private plateRect: RoundedRectangle | null = null

  // View flags only, pushed in from outside: this panel never works out
  // whether it is the drop target.
  private highlight: ZoneHighlight = "normal"
  private popEndTime: number = -1
  private filled: boolean = false

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    backPlate.size = new vec2(this.panelWidth, this.effectiveHeight())
    // "simple" is the one flat, un-gradiented style; its own color is a dark
    // grey, which applyLightSurface() then overrides once BackPlate has built
    // its rounded rectangle (onInitialized fires from BackPlate's OnStartEvent,
    // and is a ReplayEvent, so a late subscribe still runs).
    backPlate.style = "simple"
    backPlate.onInitialized.add(() => {
      applyLightSurface(this.sceneObject)
      this.plateRect = this.sceneObject.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    })
    // Drives the highlight and the land flash. Four panels, one boolean-ish
    // computation each — and it is what makes the flash self-restoring: every
    // frame repaints from (highlight state + how much flash is left), so there
    // is no animation that can be interrupted into a wrong resting value.
    this.createEvent("UpdateEvent").bind(() => this.updatePlate())

    // Content sits +0.6 in front of the plate to break the depth-buffer tie
    // with the plate's front face; hierarchy order (Content created AFTER the
    // BackPlate) is what makes it paint on top.
    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, CONTENT_Z))

    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.width = this.panelWidth
    flex.height = this.effectiveHeight()
    flex.direction = FlexDirection.Column
    flex.alignItems = FlexAlign.Stretch
    flex.justifyContent = FlexJustify.Start
    flex.rowGap = ROW_GAP
    flex.paddingTop = PAD
    flex.paddingBottom = PAD
    flex.paddingLeft = PAD
    flex.paddingRight = PAD

    // Left padding clears the color bar; the other three stay at PAD.
    const gutterLeft = BAR_INSET_CM + BAR_WIDTH_CM + BAR_CLEARANCE_CM
    flex.paddingLeft = gutterLeft
    const innerW = this.panelWidth - gutterLeft - PAD

    const headerItem = this.buildHeader(content, innerW)
    const stackItem = this.buildStackSpacer(content)
    const hintItem = this.buildHint(content, innerW)
    this.buildPositionBar()
    // Created after Content so cards paint on top of the panel chrome.
    this.buildStackMount()

    flex.onInitialized.add(() => {
      flex.addItems([headerItem, stackItem, hintItem])
    })

    this.setZoneLabel(this.zoneLabel)
    this.setCount(0)
  }

  // ── Header: dominant position letter, stack count beside it ───────────────
  private buildHeader(parent: SceneObject, innerW: number): FlexItem {
    const row = global.scene.createSceneObject("Header")
    row.setParent(parent)
    const rowFlex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    rowFlex.direction = FlexDirection.Row
    // Start, not SpaceBetween: the count belongs next to the letter as its
    // companion, not pinned to the far edge where it reads as a separate
    // element competing with it.
    rowFlex.justifyContent = FlexJustify.Start
    rowFlex.alignItems = FlexAlign.Center
    rowFlex.columnGap = 1.2
    rowFlex.width = -1
    rowFlex.height = HEADER_H
    const rowItem = row.createComponent(FlexItem.getTypeName()) as FlexItem
    rowItem.overrideHeight = HEADER_H

    const a = this.headerColor()
    // Row-direction parent → explicit width rects sized to the longest
    // expected string ("QB" / "12"), never a 1x1 Stretch placeholder.
    const labelRef = this.addRowText(row, this.zoneLabel, LETTER_SIZE, LETTER_WEIGHT, innerW * 0.55, new vec4(a.x, a.y, a.z, 1), "left")
    const countRef = this.addRowText(row, "0", COUNT_SIZE, COUNT_WEIGHT, innerW * 0.35, ink(), "left")
    this.labelText = labelRef.text
    this.countText = countRef.text

    rowFlex.onInitialized.add(() => {
      rowFlex.addItems([labelRef.item, countRef.item])
    })
    return rowItem
  }

  // ── Stack band: a spacer inside the layout, a mount point outside it ──────
  /**
   * Reserves the stack band's vertical space in the flex column and nothing
   * else. Cards are deliberately NOT parented here.
   *
   * A bare SceneObject carrying only a FlexItem has nothing FlexLayout can
   * size (no Text layoutRect, no Image), so a Stretch column writes the
   * panel's inner width into the item's transform SCALE instead — localScale.x
   * becomes innerW (21.6 at the default 24cm panel). Any child inherits that
   * as a ~21x horizontal stretch. Hence the split: this item only holds space
   * open, and buildStackMount() provides the actual, unscaled card parent.
   */
  private buildStackSpacer(parent: SceneObject): FlexItem {
    const so = global.scene.createSceneObject("StackSpacer")
    so.setParent(parent)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    item.overrideHeight = this.stackHeightCm()
    return item
  }

  /**
   * The object cards are actually parented under. Sits directly on the panel,
   * OUTSIDE the flex layout, so it inherits only the panel's own uniform scale
   * and cards keep their true proportions. Positioned to line up with the band
   * buildStackSpacer() holds open in the column.
   *
   * Intentionally childless here — cards are parented in and positioned by
   * DraftDayZoneController, which owns stack layout.
   */
  private buildStackMount(): void {
    const so = global.scene.createSceneObject("StackRoot")
    so.setParent(this.sceneObject)
    so.getTransform().setLocalPosition(
      new vec3(0, this.stackCenterYCm(), CONTENT_Z + STACK_ROOT_Z)
    )
    this.stackRoot = so
  }

  /**
   * Panel-local Y of the stack band's center. Mirrors how the flex column
   * stacks its items from the top: padding, header, gap, then the band.
   */
  private stackCenterYCm(): number {
    return this.effectiveHeight() / 2 - PAD - HEADER_H - ROW_GAP - this.stackHeightCm() / 2
  }

  // ── Position color bar ────────────────────────────────────────────────────
  /**
   * A solid, filled color bar down the panel's left edge, in the same color as
   * the bar on every card that belongs in this zone — so "which pile is this,
   * and does this card belong in it" is answerable from color alone, without
   * reading either label.
   *
   * Parented to the panel root, OUTSIDE the flex layout (same reasoning as
   * buildStackMount above), so it changes no panel dimension and shifts no
   * existing element: it occupies the panel's left padding margin only.
   */
  private buildPositionBar(): void {
    const so = global.scene.createSceneObject("PositionBar")
    so.setParent(this.sceneObject)
    so.getTransform().setLocalPosition(new vec3(
      -this.panelWidth / 2 + BAR_INSET_CM + BAR_WIDTH_CM / 2,
      0,
      BAR_Z
    ))
    const bar = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    bar.size = new vec2(BAR_WIDTH_CM, this.effectiveHeight() - 2 * BAR_INSET_CM)
    bar.cornerRadius = BAR_WIDTH_CM / 2
    const c = this.headerColor()
    bar.backgroundColor = new vec4(c.x, c.y, c.z, 1)
    bar.initialize()
    this.positionBar = bar
  }

  /**
   * This panel's position color: the shared palette for the four known
   * position labels, falling back to the authored accentColor @input for any
   * other label. See the positionColor() note at the top of the file for why
   * the palette wins over the authored value.
   */
  private headerColor(): vec3 {
    const c = positionColor(this.zoneLabel)
    return c === null ? this.accentColor : c
  }

  // ── Empty-state hint ──────────────────────────────────────────────────────
  private buildHint(parent: SceneObject, innerW: number): FlexItem {
    // A caption, deliberately: it is onboarding text that stops being useful
    // after the first drop, so it should never compete with the position
    // letter. Solid soft ink rather than a faded white — emphasis comes from
    // size here, not from alpha.
    const ref = this.addRowText(parent, this.emptyHintText, HINT_SIZE, HINT_WEIGHT, innerW, inkSoft(), "center")
    ref.item.overrideHeight = HINT_H
    this.hintText = ref.text
    return ref.item
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  /**
   * Sets the header label and re-tints both the label and the left-edge bar to
   * that position's color, so the panel's color always follows the label it is
   * actually showing rather than the label it was authored with.
   */
  setZoneLabel(label: string): void {
    if (!this.labelText) return
    this.labelText.text = label
    this.zoneLabel = label
    const c = this.headerColor()
    this.labelText.textFill.color = new vec4(c.x, c.y, c.z, 1)
    if (this.positionBar && !isNull(this.positionBar)) {
      this.positionBar.backgroundColor = new vec4(c.x, c.y, c.z, 1)
    }
  }

  /**
   * Sets the header count against this zone's roster requirement ("1 / 2") and
   * rewrites the hint to say what is still missing, or that the slot is done.
   *
   * Purely a rendering of the number it is handed — it does not read, cap, or
   * influence how many cards the zone actually holds.
   */
  setCount(n: number): void {
    if (!this.countText || !this.hintText) return
    this.filled = n > 0

    const required = rosterRequirement(this.zoneLabel)
    if (required <= 0) {
      // A label outside the standard lineup has no target to count against.
      this.countText.text = `${n}`
      this.hintText.text = n === 0 ? this.emptyHintText : ""
      this.hintText.textFill.color = inkSoft()
      return
    }

    this.countText.text = `${n} / ${required}`
    const missing = required - n
    if (missing <= 0) {
      // Complete: stated in the position's own color, so a finished slot reads
      // as finished at a glance. A word rather than a checkmark glyph — U+2713
      // is not guaranteed to exist in the runtime font, and a missing glyph
      // renders as tofu, which would look like a bug at exactly the moment the
      // panel is trying to say "done".
      // Neutral, not colored: hue is reserved for the position letter and for
      // warnings. "Complete" is distinguished from "2 needed" by weight — full
      // ink at 700 against soft ink at 400 — which reads at distance without
      // spending a color on it.
      this.hintText.text = "complete"
      this.hintText.textFill.color = ink()
      ;(this.hintText as Text & { weight?: number }).weight = 700
    } else {
      this.hintText.text = missing === 1 && n > 0 ? "1 more needed" : `${missing} needed`
      this.hintText.textFill.color = inkSoft()
      ;(this.hintText as Text & { weight?: number }).weight = HINT_WEIGHT
    }
  }

  /** The mount point external code parents card SceneObjects under. */
  getStackRoot(): SceneObject {
    return this.stackRoot
  }

  // ── Drop-target highlight ─────────────────────────────────────────────────
  /**
   * "target" while a held card would land here, "dimmed" while another zone is
   * armed, "normal" when nothing is being dragged into the row. Which one this
   * panel gets is decided by DraftDayMain from the card's own position — this
   * panel only renders the state it is handed.
   */
  setHighlight(mode: ZoneHighlight): void {
    this.highlight = mode
  }

  /** Fires the short landing flash. Safe to call repeatedly; it just restarts. */
  playLandPop(): void {
    this.popEndTime = getTime() + POP_DURATION_S
  }

  /**
   * Repaints the plate from the current highlight state, then blends the land
   * flash over the top of it. Runs every frame so the flash decays back into
   * whatever the highlight state has become in the meantime — including the
   * common case where a card lands and the preview clears in the same frame.
   */
  private updatePlate(): void {
    const rect = this.plateRect
    if (!rect || isNull(rect)) return

    const accent = this.headerColor()
    let r = SURFACE_R
    let g = SURFACE_G
    let b = SURFACE_B
    // Empty zones sit back; filled ones come forward.
    let a = this.filled ? SURFACE_A : EMPTY_SURFACE_A
    let borderSize = 0

    if (this.highlight === "target") {
      r = Math.min(1, SURFACE_R + TARGET_BRIGHTEN)
      g = Math.min(1, SURFACE_G + TARGET_BRIGHTEN)
      b = Math.min(1, SURFACE_B + TARGET_BRIGHTEN)
      a = TARGET_SURFACE_A
      borderSize = TARGET_BORDER_CM
    } else if (this.highlight === "dimmed") {
      r = SURFACE_R * DIM_SCALE
      g = SURFACE_G * DIM_SCALE
      b = SURFACE_B * DIM_SCALE
      a = DIM_SURFACE_A
    }

    if (this.popEndTime > 0) {
      const remaining = this.popEndTime - getTime()
      if (remaining <= 0) {
        this.popEndTime = -1
      } else {
        // 1 at the moment of landing, easing to 0 — a bloom that decays,
        // rather than a linear ramp that reads as a slow fade.
        const k = (remaining / POP_DURATION_S) * (remaining / POP_DURATION_S)
        r = r + (1 - r) * k
        g = g + (1 - g) * k
        b = b + (1 - b) * k
        a = a + (1 - a) * k
        borderSize = borderSize + (POP_BORDER_CM - borderSize) * k
      }
    }

    rect.backgroundColor = new vec4(r, g, b, a)
    if (borderSize > 0) {
      rect.border = true
      rect.borderSize = borderSize
      rect.borderColor = new vec4(accent.x, accent.y, accent.z, 1)
    } else {
      rect.border = false
    }
  }

  panelWidthCm(): number {
    return this.panelWidth
  }

  /**
   * The height this panel actually renders at: the authored panelHeight,
   * capped at MAX_PANEL_HEIGHT_CM. Everything that needs the panel's extent
   * goes through here — the backplate, the flex column, the color bar, the
   * stack band, and panelHeightCm() — so the visible panel and the region the
   * controller hit-tests can never disagree.
   */
  private effectiveHeight(): number {
    return Math.min(this.panelHeight, MAX_PANEL_HEIGHT_CM)
  }

  panelHeightCm(): number {
    return this.effectiveHeight()
  }

  /** Usable vertical extent of the stack area, in this panel's local cm. */
  stackHeightCm(): number {
    return this.effectiveHeight() - 2 * PAD - HEADER_H - HINT_H - 2 * ROW_GAP
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private addRowText(
    parent: SceneObject, text: string, size: number, weight: number, widthCM: number, color: vec4,
    align: "left" | "center" | "right" = "left"
  ): { text: Text; item: FlexItem } {
    const so = global.scene.createSceneObject("RowText")
    so.setParent(parent)
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyType(t, size, weight)
    t.textFill.color = color
    t.horizontalAlignment =
      align === "center" ? HorizontalAlignment.Center
        : align === "right" ? HorizontalAlignment.Right
          : HorizontalAlignment.Left
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    // Reserved row height scales with the type — see the note in
    // DraftDayCardUI.addRowText; the 120-size letter needs far more than the
    // fixed ±1.2cm the old shared ramp assumed.
    const halfH = size * LINE_HEIGHT_PER_SIZE
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -halfH, halfH)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    return { text: t, item }
  }
}
