/**
 * DraftDayCardUI — a single floating player card.
 *
 * Spawned at runtime by DraftDayCardFieldController, one per arc-pool slot.
 * A card may later be handed to DraftDayZoneController and re-parented into a
 * tier zone's stack; it does not change behavior when that happens, and it
 * never learns which zone (if any) it is sitting in.
 *
 * Owns: name, position (accent-colored), team, bye week, ADP caption, the
 * left-edge position color bar, the card's light readability surface, and
 * pinch-grab-and-move (see setupGrabAndMove()) — pinch a card, drag it
 * anywhere in free 3D space, release and it stays exactly where it was let
 * go (no spring-back, no snap-to-arc). This component never re-asserts its
 * own position, so it never fights whoever placed it (the field controller at
 * arc spawn, or the zone controller at stack layout).
 *
 * Public API (Channel A — event bus):
 * - setPlayer(player)          — push the model to render
 * - getPlayer() / getPlayerId() — view identity of what's rendered
 * - getWorldPosition()          — where the card currently is
 * - setVisible(visible)
 * - setClashWarning(active)     — push the bye-clash flag in; card renders it
 * - onReleased: Event<DraftDayCardUI> — user finished a pinch-drag
 * - onGrabStart / onGrabMove: Event<DraftDayCardUI> — drag began / is moving
 *
 * Holds no domain state: it does not know about filters, zones, tiers, or
 * drafted marks, and it makes no placement decisions.
 */
import { FlexLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import { FlexItem } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import { FlexAlign, FlexDirection, FlexJustify } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import { InteractableManipulation } from "SpectaclesInteractionKit.lspkg/Components/Interaction/InteractableManipulation/InteractableManipulation"
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event"
import { Player, playerId } from "./DraftDayDataService"

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

// ── Card layout (this module only) ──────────────────────────────────────────
// Read at ~3m by someone who may not know what ADP or a bye week is. One
// color-bar gutter, then three lines spread across the FULL plate height —
// the previous pass centered a short stack of rows and left the bottom third
// of every card empty.
//
//   ┌──┬──────────────────────────────┐
//   │▐ │ #3  Puka Nacua               │  rank is a small index before the name
//   │▐ │ WR · LAR                     │
//   │▐ │ ADP 2.7           ( BYE 11 ) │  bottom band, previously dead
//   └──┴──────────────────────────────┘
//
// justifyContent = SpaceBetween is what fills the plate: the three rows are
// pinned to top, middle and bottom rather than clustered in the middle.
const GUTTER_LEFT_CM = 3.9
const PAD_SIDE_CM = 1.2
const PAD_TOP_CM = 1.1

// Rank: a subordinate index, not a headline. At 26 against the name's 45 it is
// ~58% of the name and cannot be mistaken for the primary element. Prefixed
// "#" so it reads as a rank rather than as a stray number — a bare "3" beside
// a player name could be a jersey number, a tier, or a bye week.
const RANK_SIZE = 26
const RANK_WEIGHT = 700
const RANK_W_CM = 2.2
const RANK_GAP_CM = 0.4

// Name: the dominant element, on its own line with the full remaining width.
// Sized so the longest name in the static dataset ("Jaxon Smith-Njigba", 18
// characters) just fills its column — 62 filled 19.6cm, so 14.3cm wants
// 62 × 14.3 / 19.6 ≈ 45. Longer names ellipsise rather than shrink or wrap.
const NAME_SIZE = 45
const NAME_WEIGHT = 700
const NAME_W_CM = 14.3

// Position: larger and heavier than the team beside it, in the position color.
const POS_SIZE = 36
const POS_WEIGHT = 700
const POS_W_CM = 5.5
const TEAM_SIZE = 30
const TEAM_WEIGHT = 500
const TEAM_W_CM = 7.0

// ADP shares the bottom line with the bye chip, and stays the quietest thing
// on the card — the rank already says what ADP says, without a decimal.
const ADP_SIZE = 26
const ADP_WEIGHT = 400
const ADP_W_CM = 11.0

// Half-height, in cm, that one line of text reserves per unit of font size.
const LINE_HEIGHT_PER_SIZE = 1.2 / 48

function applyType(t: Text, size: number, weight: number): void {
  t.size = size
  ;(t as Text & { weight?: number }).weight = weight
}

// ── Position color bar ──────────────────────────────────────────────────────
// Tripled from the original 1.0cm: at 3m a 1cm stripe on a 22cm card is a
// hairline, and the bar has to be identifiable before any text resolves.
const BAR_WIDTH_CM = 3.0
const BAR_INSET_CM = 0.5
const BAR_Z = 0.55

// ── Plate ───────────────────────────────────────────────────────────────────
// The card plate is card-local rather than the shared surface, for two reasons
// that both come from wide shots in a bright room:
//
//  - Fully opaque. Any transparency lets a white wall through, and a white
//    wall behind a near-white plate erases the plate's edge entirely.
//  - Slightly darker than the shared surface (0.86/0.88/0.93 vs 0.90/0.92/
//    0.96). Against white passthrough, value is what separates the card from
//    the wall — a near-white plate on a white wall has no boundary no matter
//    how opaque it is. Ink at 0.08 still clears 9:1 on the darkest tint.
const CARD_SURFACE_R = 0.86
const CARD_SURFACE_G = 0.88
const CARD_SURFACE_B = 0.93
const CARD_SURFACE_A = 1.0

// Plate pulled toward the position hue, raised from 0.10 to 0.18 now that the
// plate is opaque and darker. At 0.18 an RB plate lands near (0.73, 0.83,
// 0.83) and a WR plate near (0.73, 0.80, 0.92) — separable as warm-green vs
// blue at distance, with the darkest channel still at ~9:1 against the 0.08
// ink. The tint is REINFORCEMENT, though: the 3cm fully-saturated color bar is
// what actually carries position identity across a room, and pushing the tint
// far enough to carry it alone would eat the text contrast.
const PLATE_TINT = 0.18

// ── Bye chip ────────────────────────────────────────────────────────────────
// ⚠ Standalone RoundedRectangles are OPAQUE by default. RoundedRectangle's
// _blendMode initialises to RoundedRectBlendMode.Disabled, which maps to
// BlendMode.Disabled, so the alpha channel of backgroundColor is DISCARDED —
// BackPlate only gets alpha because it explicitly sets PremultipliedAlphaAuto
// on its mainPass after initialize(). The first version of this chip asked for
// ink at 0.12 alpha and got solid near-black, then drew ink-colored text on
// top of it: a filled dark rectangle with invisible text.
//
// So the chip is now specified to need no alpha at all — an opaque light fill
// with dark text and a mid-grey border. It renders identically whether or not
// the blend mode is ever changed, which is the property that makes it safe.
const CHIP_W_CM = 5.4
const CHIP_H_CM = 1.9
const CHIP_X_CM = 7.1
const CHIP_Z = 0.55
const CHIP_TEXT_Z = 0.15
const CHIP_FILL_R = 0.97
const CHIP_FILL_G = 0.97
const CHIP_FILL_B = 0.99
const CHIP_BORDER_CM = 0.2
const CHIP_BORDER_R = 0.42
const CHIP_BORDER_G = 0.45
const CHIP_BORDER_B = 0.52
const CHIP_SIZE = 30
const CHIP_WEIGHT = 700

// ── Bye-clash warning treatment ─────────────────────────────────────────────
// A pulsing border around the whole card, drawn by the plate's own rounded
// rectangle (RoundedRectangle supports an inset border, so this needs no extra
// geometry and cannot disturb the layout).
//
// Red, and red is now reserved: the position palette was deliberately moved
// off red (QB went crimson -> violet) so that nothing except a warning is ever
// this hue. A warning must not be mistakable for a position, and the earlier
// palette made a QB card and an alarmed card the same color. On top of the
// exclusive hue it wraps the whole card rather than one edge, and it moves.
//
// The pulse is deliberately coarse. It has to survive a compressed screen
// recording, where a subtle 10% alpha breath disappears into compression
// artifacts, so both the thickness and the opacity swing hard: the border more
// than triples in width across the cycle.
const CLASH_R = 0.95
const CLASH_G = 0.12
const CLASH_B = 0.12
const CLASH_BORDER_MIN_CM = 0.3
const CLASH_BORDER_MAX_CM = 1.1
const CLASH_ALPHA_MIN = 0.6
const CLASH_ALPHA_MAX = 1.0
// Cycles per second. Slow enough to read as a deliberate pulse rather than a
// flicker (~1.8s per cycle), fast enough that a short clip catches a full one.
const CLASH_PULSE_HZ = 0.55

@component
export class DraftDayCardUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">DraftDayCardUI – One player card: name, position, team, bye, ADP</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  // ── The four position colors ─────────────────────────────────────────────
  // Duplicated in DraftDayZoneUI's positionColor(). Change one, change both.
  //
  // Broadcast palette, not pastel: fully saturated, mid-to-deep, the kind of
  // color a score bug uses. Two constraints drove the specific hues.
  //
  // QB moved OFF red entirely. It was (0.86, 0.2, 0.24) crimson, which sat
  // right on top of the bye-clash warning red — a QB card and an alarmed card
  // were the same color, which is the one collision a warning system cannot
  // afford. Violet is as far from the warning as the wheel allows while
  // staying distinct from WR blue.
  //
  // The four are separated by hue family (violet / green / blue / gold) rather
  // than by lightness, so they survive both distance and the plate tint that
  // samples them at 18%.
  @input('vec3', '{0.55,0.16,0.82}')
  @widget(new ColorWidget())
  @hint("Position color for QB — the card's left-edge bar")
  colorQB: vec3 = new vec3(0.55, 0.16, 0.82)

  @input('vec3', '{0.05,0.62,0.28}')
  @widget(new ColorWidget())
  @hint("Position color for RB — the card's left-edge bar")
  colorRB: vec3 = new vec3(0.05, 0.62, 0.28)

  @input('vec3', '{0.08,0.42,0.96}')
  @widget(new ColorWidget())
  @hint("Position color for WR — the card's left-edge bar")
  colorWR: vec3 = new vec3(0.08, 0.42, 0.96)

  @input('vec3', '{0.98,0.68,0.04}')
  @widget(new ColorWidget())
  @hint("Position color for TE — the card's left-edge bar")
  colorTE: vec3 = new vec3(0.98, 0.68, 0.04)

  @input
  @widget(new SliderWidget(10, 30, 0.5))
  @hint("Card panel width in centimeters")
  cardWidth: number = 22

  @input
  @widget(new SliderWidget(6, 18, 0.5))
  @hint("Card panel height in centimeters")
  cardHeight: number = 11
  @ui.group_end

  private nameText!: Text
  private rankText!: Text
  private positionText!: Text
  private teamText!: Text
  private byeText!: Text
  private adpText!: Text
  private byeChip: RoundedRectangle | null = null
  private positionBar: RoundedRectangle | null = null
  private plateRect: RoundedRectangle | null = null

  // View flag only: WHETHER this card is in a bye clash is decided by
  // DraftDayState/DraftDayMain and pushed in. The card never works it out.
  private clashActive: boolean = false

  // The player this card is currently rendering. This is view identity — WHAT
  // is being displayed — not domain state: the card never decides anything
  // about zones, filters or drafting. Zone membership lives in DraftDayState.
  private player: Player | null = null

  private _onReleased = new Event<DraftDayCardUI>()
  private _onGrabStart = new Event<DraftDayCardUI>()
  private _onGrabMove = new Event<DraftDayCardUI>()

  /**
   * Fires once each time the user finishes a pinch-drag of this card, with
   * the card itself as the payload. The card does NOT interpret the drop —
   * DraftDayMain reads the released world position and decides whether it
   * lands in a tier zone, leaves one, or stays loose.
   */
  get onReleased(): PublicApi<DraftDayCardUI> { return this._onReleased.publicApi() }

  /**
   * Fires once when the user starts a pinch-drag, and again on every frame the
   * card is being dragged. Like onReleased, the payload is the card itself and
   * the card draws no conclusion from it — DraftDayMain reads the live world
   * position to decide which zone (if any) the card would currently land in.
   */
  get onGrabStart(): PublicApi<DraftDayCardUI> { return this._onGrabStart.publicApi() }
  get onGrabMove(): PublicApi<DraftDayCardUI> { return this._onGrabMove.publicApi() }

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    backPlate.size = new vec2(this.cardWidth, this.cardHeight)
    // "simple" is the one flat, un-gradiented style; its own color is a dark
    // grey, which applyLightSurface() then overrides once BackPlate has built
    // its rounded rectangle (onInitialized fires from BackPlate's OnStartEvent,
    // and is a ReplayEvent, so a late subscribe still runs).
    backPlate.style = "simple"
    backPlate.onInitialized.add(() => {
      applyLightSurface(this.sceneObject)
      // Same rounded rectangle the light surface was just painted onto; kept
      // so the clash border can be driven every frame without a component
      // lookup. Re-asserted here because setClashWarning() may have been
      // called before the plate finished building.
      this.plateRect = this.sceneObject.getComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
      this.refreshPlateTint()
      this.refreshClashBorder()
    })
    this.setupGrabAndMove(backPlate)

    // Bound unconditionally, and cheap: it returns immediately unless this
    // card is currently flagged. Binding on demand instead would mean creating
    // and destroying an event every time a clash appears or clears.
    this.createEvent("UpdateEvent").bind(() => this.updateClashPulse())

    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.width = this.cardWidth
    flex.height = this.cardHeight
    flex.direction = FlexDirection.Column
    // Start, not Center: every row begins at the same left edge, so the card
    // has one clean text margin instead of three ragged ones.
    flex.alignItems = FlexAlign.Start
    // SpaceBetween, not Center: pins the three rows to top / middle / bottom so
    // they occupy the whole plate. Centering them is what left the bottom third
    // of the card empty.
    flex.justifyContent = FlexJustify.SpaceBetween
    flex.paddingTop = PAD_TOP_CM
    flex.paddingBottom = PAD_TOP_CM
    // The left gutter is padding, so no row can ever collide with the bar.
    flex.paddingLeft = GUTTER_LEFT_CM
    flex.paddingRight = PAD_SIDE_CM

    // Row 1: "#3" then the name. A nested row flex rather than manual offsets,
    // so the index can never overlap the name however long the name is.
    const nameRow = global.scene.createSceneObject("NameRow")
    nameRow.setParent(content)
    const nameFlex = nameRow.createComponent(FlexLayout.getTypeName()) as FlexLayout
    nameFlex.direction = FlexDirection.Row
    nameFlex.justifyContent = FlexJustify.Start
    nameFlex.alignItems = FlexAlign.Center
    nameFlex.columnGap = RANK_GAP_CM
    nameFlex.width = -1
    nameFlex.height = -1
    const nameRowItem = nameRow.createComponent(FlexItem.getTypeName()) as FlexItem

    const rankRef = this.addRowText(nameRow, "#--", RANK_SIZE, RANK_WEIGHT, RANK_W_CM, inkSoft(), "left")
    const nameRef = this.addRowText(nameRow, "—", NAME_SIZE, NAME_WEIGHT, NAME_W_CM, ink(), "left")
    nameRef.text.horizontalOverflow = HorizontalOverflow.Ellipsis
    nameFlex.onInitialized.add(() => {
      nameFlex.addItems([rankRef.item, nameRef.item])
    })
    this.rankText = rankRef.text
    this.nameText = nameRef.text

    // Row 2: position (large, colored) + team.
    const ptRow = global.scene.createSceneObject("PosTeamRow")
    ptRow.setParent(content)
    const ptFlex = ptRow.createComponent(FlexLayout.getTypeName()) as FlexLayout
    ptFlex.direction = FlexDirection.Row
    ptFlex.justifyContent = FlexJustify.Start
    ptFlex.alignItems = FlexAlign.Center
    ptFlex.columnGap = 0.8
    ptFlex.width = -1
    ptFlex.height = -1
    const ptRowItem = ptRow.createComponent(FlexItem.getTypeName()) as FlexItem

    const posRef = this.addRowText(ptRow, "--", POS_SIZE, POS_WEIGHT, POS_W_CM, ink(), "left")
    const teamRef = this.addRowText(ptRow, "---", TEAM_SIZE, TEAM_WEIGHT, TEAM_W_CM, inkSoft(), "left")
    ptFlex.onInitialized.add(() => {
      ptFlex.addItems([posRef.item, teamRef.item])
    })
    this.positionText = posRef.text
    this.teamText = teamRef.text

    // Row 3: ADP on the left of the bottom band. The bye chip occupies the
    // right of the same band, placed manually — see buildByeChip().
    const adpRef = this.addRowText(content, "ADP --", ADP_SIZE, ADP_WEIGHT, ADP_W_CM, inkSoft(), "left")
    this.adpText = adpRef.text

    flex.onInitialized.add(() => {
      flex.addItems([nameRowItem, ptRowItem, adpRef.item])
    })

    this.buildByeChip()

    // Built last so it paints over the plate (hierarchy order = paint order).
    this.buildPositionBar()
  }

  // ── Position color bar ────────────────────────────────────────────────────
  /**
   * A solid, filled color bar down the card's left edge — the card's position
   * indicator. It replaces tint-only accenting (a thin colored string), which
   * is exactly the kind of hairline cue an additive display loses against a
   * busy background: a filled block of color survives where a thin one does not.
   *
   * Parented to the card root, OUTSIDE the flex Content, so it cannot change
   * the card's layout: it occupies the plate's left padding margin, and every
   * text row keeps the width, position and alignment it already had. The card's
   * own width/height are likewise untouched.
   */
  private buildPositionBar(): void {
    const so = global.scene.createSceneObject("PositionBar")
    so.setParent(this.sceneObject)
    so.getTransform().setLocalPosition(new vec3(
      -this.cardWidth / 2 + BAR_INSET_CM + BAR_WIDTH_CM / 2,
      0,
      BAR_Z
    ))
    const bar = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    bar.size = new vec2(BAR_WIDTH_CM, this.cardHeight - 2 * BAR_INSET_CM)
    bar.cornerRadius = BAR_WIDTH_CM / 2
    // Neutral until setPlayer() supplies the position; a card with no player
    // yet should not flash one position's color.
    bar.backgroundColor = new vec4(1, 1, 1, 0.9)
    bar.initialize()
    this.positionBar = bar
  }

  // ── Bye chip ──────────────────────────────────────────────────────────────
  /**
   * A filled, rounded chip in the card's top-right corner carrying "BYE 11".
   *
   * Built from a RoundedRectangle plus a Text, both parented to the card root
   * OUTSIDE the flex column — so it reserves no row, shifts nothing, and the
   * three text rows keep the full width they were sized for. RoundedRectangle
   * creates a RenderMeshVisual and nothing else: no collider, no Interactable,
   * so this cannot intercept a pinch or interfere with the card's grab.
   *
   * Independent of the clash treatment by construction: the chip is its own
   * object with a neutral fill, while the clash pulse lives on the card plate's
   * border. A card can be flagged and its chip is untouched, and vice versa.
   */
  private buildByeChip(): void {
    // Vertically aligned with the ADP row: both sit on the bottom band, which
    // is derived from the same padding the flex column uses, so the chip
    // tracks the row rather than guessing at it.
    // Exactly the center of the ADP row: bottom padding edge, plus that row's
    // own half-height. Derived from the same constants the flex column uses,
    // so the chip and the ADP text share one baseline rather than drifting.
    const bandY = -(this.cardHeight / 2 - PAD_TOP_CM) + ADP_SIZE * LINE_HEIGHT_PER_SIZE
    const so = global.scene.createSceneObject("ByeChip")
    so.setParent(this.sceneObject)
    so.getTransform().setLocalPosition(new vec3(CHIP_X_CM, bandY, CHIP_Z))

    const chip = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    chip.size = new vec2(CHIP_W_CM, CHIP_H_CM)
    chip.cornerRadius = CHIP_H_CM / 2
    // Opaque and LIGHT — see the blend-mode warning above. Alpha here would be
    // silently discarded, so the fill must be legible at full opacity.
    chip.backgroundColor = new vec4(CHIP_FILL_R, CHIP_FILL_G, CHIP_FILL_B, 1)
    chip.border = true
    chip.borderSize = CHIP_BORDER_CM
    chip.borderColor = new vec4(CHIP_BORDER_R, CHIP_BORDER_G, CHIP_BORDER_B, 1)
    chip.initialize()
    this.byeChip = chip

    // Created after the chip so it paints on top of it, and in ink — which now
    // contrasts with the fill instead of matching it.
    const labelObj = global.scene.createSceneObject("ByeChipLabel")
    labelObj.setParent(so)
    labelObj.getTransform().setLocalPosition(new vec3(0, 0, CHIP_TEXT_Z))
    const t = labelObj.createComponent("Component.Text") as Text
    t.text = "BYE --"
    t.depthTest = true
    applyType(t, CHIP_SIZE, CHIP_WEIGHT)
    t.textFill.color = ink()
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const halfH = CHIP_SIZE * LINE_HEIGHT_PER_SIZE
    t.layoutRect = Rect.create(-CHIP_W_CM / 2, CHIP_W_CM / 2, -halfH, halfH)
    this.byeText = t
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  setPlayer(p: Player): void {
    this.player = p
    if (!this.nameText) return
    this.nameText.text = p.name
    this.rankText.text = p.rank === undefined ? "" : `#${p.rank}`
    this.positionText.text = p.position
    this.teamText.text = p.team
    this.byeText.text = `BYE ${p.bye}`
    this.adpText.text = `ADP ${p.adp.toFixed(1)}`

    // Color lives on the bar and on the plate tint ONLY. Every string on this
    // card is ink or soft ink: tinted text was costing contrast for a cue the
    // 3cm bar already delivers, and hierarchy here is carried by size and
    // weight instead (name 45/700 > position 36/700 > team 30/500 > rank
    // 26/700 in soft ink > ADP 26/400).
    const c = this.colorForPosition(p.position)
    if (this.positionBar && !isNull(this.positionBar)) {
      this.positionBar.backgroundColor = new vec4(c.x, c.y, c.z, 1)
    }
    this.refreshPlateTint()
  }

  /**
   * Pulls the plate 10% toward the position hue. Writes ONLY backgroundColor;
   * the clash treatment owns border/borderSize/borderColor on this same
   * rectangle, so the two never touch the same property.
   *
   * Re-applied when the plate reports in, because a card is constructed and
   * given its player before BackPlate has finished building.
   */
  private refreshPlateTint(): void {
    const rect = this.plateRect
    if (!rect || isNull(rect) || !this.player) return
    const c = this.colorForPosition(this.player.position)
    rect.backgroundColor = new vec4(
      CARD_SURFACE_R + (c.x - CARD_SURFACE_R) * PLATE_TINT,
      CARD_SURFACE_G + (c.y - CARD_SURFACE_G) * PLATE_TINT,
      CARD_SURFACE_B + (c.z - CARD_SURFACE_B) * PLATE_TINT,
      CARD_SURFACE_A
    )
  }

  getPlayer(): Player | null {
    return this.player
  }

  /** Stable identity of the rendered player; "" before setPlayer() is called. */
  getPlayerId(): string {
    return this.player ? playerId(this.player) : ""
  }

  getWorldPosition(): vec3 {
    return this.sceneObject.getTransform().getWorldPosition()
  }

  setVisible(visible: boolean): void {
    this.sceneObject.enabled = visible
  }

  // ── Bye-clash warning ─────────────────────────────────────────────────────
  /**
   * Turns the pulsing warning border on or off. Idempotent, and safe to call
   * before the plate has finished building — the state is stored and applied
   * when the plate reports in.
   *
   * The card does not know what a bye week is, which other card it clashes
   * with, or that zones exist: it renders the flag it is given, exactly like
   * setPlayer(). DraftDayMain owns the decision.
   */
  setClashWarning(active: boolean): void {
    if (this.clashActive === active) return
    this.clashActive = active
    this.refreshClashBorder()
  }

  /** Applies (or removes) the border in its resting state. */
  private refreshClashBorder(): void {
    const rect = this.plateRect
    if (!rect || isNull(rect)) return
    if (!this.clashActive) {
      // Order matters: border=false zeroes borderSize internally, so nothing
      // is left behind for the next enable to inherit.
      rect.border = false
      return
    }
    rect.border = true
    rect.borderSize = CLASH_BORDER_MIN_CM
    rect.borderColor = new vec4(CLASH_R, CLASH_G, CLASH_B, CLASH_ALPHA_MAX)
  }

  /**
   * Drives the pulse. Runs every frame for every card, so the not-flagged path
   * is a single boolean test and a return.
   */
  private updateClashPulse(): void {
    if (!this.clashActive) return
    const rect = this.plateRect
    if (!rect || isNull(rect)) return
    // (sin + 1) / 2 → a 0..1 breath; getTime() is seconds since lens start, so
    // every flagged card pulses in phase, which reads as one alarm rather than
    // several unrelated ones.
    const wave = (Math.sin(getTime() * CLASH_PULSE_HZ * 2 * Math.PI) + 1) / 2
    rect.borderSize = CLASH_BORDER_MIN_CM + (CLASH_BORDER_MAX_CM - CLASH_BORDER_MIN_CM) * wave
    rect.borderColor = new vec4(
      CLASH_R, CLASH_G, CLASH_B,
      CLASH_ALPHA_MIN + (CLASH_ALPHA_MAX - CLASH_ALPHA_MIN) * wave
    )
  }

  private colorForPosition(position: string): vec3 {
    switch (position) {
      case "QB": return this.colorQB
      case "RB": return this.colorRB
      case "WR": return this.colorWR
      case "TE": return this.colorTE
      default: return new vec3(1, 1, 1)
    }
  }

  // ── Grab-and-move ────────────────────────────────────────────────────────
  //
  // BackPlate (created above) already creates, on this same SceneObject: a
  // real 3D box ColliderComponent sized to the card (fitVisual=false, shape
  // = cardWidth x cardHeight x depth — not a flat plane), an Interactable
  // (default targetingMode = Direct|Indirect, no Poke — pinch-touch up close
  // or ray-pinch at range, both fine for free-space grab), and an
  // InteractionPlane. InteractionPlane only adds a near-field cursor/ray
  // precision assist around the card — it does not confine dragging to a
  // plane. That existing setup (inherited from the old flat-panel build) is
  // already correct for a freestanding 3D card and needs no replacement.
  //
  // What's missing is the actual grab-and-move behavior, so we layer
  // InteractableManipulation on the same SceneObject: pinch, drag anywhere
  // in 3D, release and it stays exactly where it was let go. It writes the
  // object's transform only while a drag is Active and touches nothing at
  // rest, so it never fights DraftDayCardFieldController, which writes a
  // card's transform exactly once, at spawn. There is no spring-back by
  // design — InteractableManipulation simply stops writing the transform on
  // release, so the last written pose sticks; a card only returns to its arc
  // slot when the whole set is torn down and respawned on the next filter
  // change. Rotation and scale are explicitly disabled: a rotated card would
  // break the arc's "face the pivot" invariant, and a rescaled card would
  // fight the field controller's radiusCm/110 distance-compensation scale —
  // only translation is a requested, user-facing feature here.
  //
  // InteractableManipulation is created lazily inside BackPlate's
  // onInitialized (a ReplayEvent, so this still fires correctly even if
  // BackPlate already finished by the time this subscribes) rather than
  // eagerly here in onAwake, and wired via the public setNewInteractable()
  // API rather than relying on its own internal auto-lookup. BackPlate's
  // Interactable is itself created inside BackPlate's OWN OnStartEvent
  // handler, so creating InteractableManipulation up front and hoping two
  // independently-registered OnStartEvent handlers fire in the right order
  // is a race; waiting for onInitialized (which fires right after BackPlate
  // finishes creating its Interactable) makes the ordering deterministic.
  private setupGrabAndMove(backPlate: BackPlate): void {
    backPlate.onInitialized.add(() => {
      const manipulation = this.sceneObject.createComponent(
        InteractableManipulation.getTypeName()
      ) as InteractableManipulation
      manipulation.setCanRotate(false)
      manipulation.setCanScale(false)
      manipulation.setNewInteractable(backPlate.interactable)
      // Report the drop; DraftDayMain owns what it means. Re-broadcasting the
      // card (not a position) keeps this module free of any zone knowledge.
      manipulation.onManipulationEnd.add(() => this._onReleased.invoke(this))
      // Start and per-frame drag, reported the same way and for the same
      // reason: the drop-target preview has to be driven by the card's live
      // position, and this module must not be the thing that knows what a
      // zone is. Start is forwarded separately from update so a grab that
      // never moves still previews immediately.
      manipulation.onManipulationStart.add(() => this._onGrabStart.invoke(this))
      manipulation.onManipulationUpdate.add(() => this._onGrabMove.invoke(this))
    })
  }

  // ── Helpers ──────────────────────────────────────────────────────────────
  private addRowText(
    parent: SceneObject, text: string, size: number, weight: number, widthCM: number, color: vec4,
    align: "left" | "center" = "left"
  ): { text: Text; item: FlexItem } {
    const so = global.scene.createSceneObject("RowText")
    so.setParent(parent)
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyType(t, size, weight)
    t.textFill.color = color
    t.horizontalAlignment = align === "center" ? HorizontalAlignment.Center : HorizontalAlignment.Left
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    // The rect's height is what the flex column reserves for this row, so it
    // scales strictly with the type: the larger name needs more than the old
    // fixed 2.4cm slot, and the smaller ADP line needs less. Holding a floor
    // here instead would over-reserve for the small rows — with one, the four
    // rows ask for 11.8cm inside a 9cm content box; proportional, they ask for
    // 9.8cm. LINE_HEIGHT_PER_SIZE is the second value to sanity-check in
    // Preview, alongside NAME_SIZE.
    const halfH = size * LINE_HEIGHT_PER_SIZE
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -halfH, halfH)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    return { text: t, item }
  }
}
