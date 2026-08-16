/**
 * DraftDayControlsUI — top control bar for the Draft Day player-card browser.
 *
 * Owns: title + football icon, live/offline status pill (icon + text),
 * refresh button, the 5-way position filter tab row (All/QB/RB/WR/TE), and the
 * bar's own light readability backplate.
 *
 * Public API (Channel A — event bus):
 * - setStatus(text, isLive)      — main script pushes data-source state in
 * - setActiveFilter(filter)      — main script pushes which tab reads active
 * - onRefresh: Event<void>       — user tapped the refresh button
 * - onFilterChanged: Event<string> — user tapped a filter tab ("ALL"|"QB"|"RB"|"WR"|"TE")
 *
 * This module holds no domain state — it is a passive view.
 */
import { FlexLayout } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexLayout"
import { FlexItem } from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexItem"
import {
  FlexAlign, FlexDirection, FlexJustify,
} from "SpectaclesUIKit.lspkg/Scripts/Components/Layout2D/Flex/FlexTypes"
import { BackPlate } from "SpectaclesUIKit.lspkg/Scripts/BackPlate"
import { Button } from "SpectaclesUIKit.lspkg/Scripts/Components/Button/Button"
import { ElementContent } from "SpectaclesUIKit.lspkg/Scripts/Components/Content/ElementContent"
import { RoundedRectangle } from "SpectaclesUIKit.lspkg/Scripts/Visuals/RoundedRectangle/RoundedRectangle"
import Event, { PublicApi } from "SpectaclesInteractionKit.lspkg/Utils/Event"

// ── Icons (imported from Phase 2a manifest icon entries) ────────────────────
const ICON_FOOTBALL: Texture = requireAsset("../Icons/sports_football.png") as Texture
const ICON_REFRESH: Texture = requireAsset("../Icons/refresh.png") as Texture
const ICON_WIFI: Texture = requireAsset("../Icons/wifi.png") as Texture
const ICON_CLOUD_OFF: Texture = requireAsset("../Icons/cloud_off.png") as Texture

// ── Image material (premultiplied-alpha correct for icon PNGs) ──────────────
const imageMaterial = requireAsset("../Materials/ImageMaterial.mat") as Material

// ── Control bar type hierarchy ──────────────────────────────────────────────
// The bar is chrome: it should be legible and then get out of the way, so it
// sits below the card's name in the visual order. The title is the anchor, the
// status line and tab labels are equals beneath it.
const TITLE_SIZE = 62
const TITLE_WEIGHT = 700
const STATUS_SIZE = 42
const STATUS_WEIGHT = 500
const TAB_SIZE = 46
const TAB_WEIGHT = 600
const TAB_ACTIVE_WEIGHT = 700

// ── Tab faces ───────────────────────────────────────────────────────────────
// The UIKit Button's own visual is theme-driven and paints a dark fill that
// swallowed the labels. Rather than fight the theme (its style colors are not
// part of Button's public surface), each tab gets an opaque face rectangle
// drawn over that visual and under the label — so the tab's appearance is
// fully ours while the Button underneath keeps owning the collider, the
// interactable, and the trigger event. No interaction is changed.
//
// Faces are sized slightly larger than the Button so the theme visual's own
// rounded corners cannot peek out around them.
const TAB_FACE_W_CM = 5.7
const TAB_FACE_H_CM = 2.8
const TAB_FACE_RADIUS_CM = 0.6
const TAB_FACE_Z = 0.04

// Inactive: light face, near-black label, subtle border — a readable, unlit
// key. Active: near-black face with a white label, which is unmistakable at
// distance and costs no hue (color stays reserved for position bars and
// warnings). Alpha is not used anywhere here: a standalone RoundedRectangle
// renders opaque, see the note in DraftDayCardUI's bye chip.
const TAB_IDLE_FILL_R = 0.97
const TAB_IDLE_FILL_G = 0.97
const TAB_IDLE_FILL_B = 0.99
const TAB_IDLE_BORDER_R = 0.55
const TAB_IDLE_BORDER_G = 0.58
const TAB_IDLE_BORDER_B = 0.64
const TAB_ACTIVE_FILL_R = 0.09
const TAB_ACTIVE_FILL_G = 0.10
const TAB_ACTIVE_FILL_B = 0.13
const TAB_BORDER_CM = 0.12

// ── Chalk rule ──────────────────────────────────────────────────────────────
// A field marking, built only from rectangles: one long sideline with short
// yard ticks rising from it, run along the bottom of the control bar. It is
// placed from the layout's own reported container size, so it tracks the bar
// rather than assuming its height.
const CHALK_TICKS = 9
const CHALK_LINE_H_CM = 0.14
const CHALK_TICK_W_CM = 0.14
const CHALK_TICK_H_CM = 0.55
const CHALK_INSET_CM = 1.4
const CHALK_MARGIN_CM = 0.55
const CHALK_Z = 0.62
const CHALK_R = 0.42
const CHALK_G = 0.46
const CHALK_B = 0.52
const ATTRIBUTION_SIZE = 26
const ATTRIBUTION_WEIGHT = 400
const ATTRIBUTION_H = 1.4
const ATTRIBUTION_TEXT = "ADP data via Fantasy Football Calculator (fantasyfootballcalculator.com)"

// Half-height, in cm, that one line of text reserves per unit of font size.
// Same ratio as DraftDayCardUI's.
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

const BUTTON_LABEL_Z = 0.08
const FILTER_KEYS = ["ALL", "QB", "RB", "WR", "TE"] as const
const FILTER_LABELS = ["All", "QB", "RB", "WR", "TE"]

const PANEL_W = 48
const PAD = 1.0

@component
export class DraftDayControlsUI extends BaseScriptComponent {
  @ui.label('<span style="color: #60A5FA;">DraftDayControlsUI – Top bar: title, live/offline status, refresh, position filters</span>')
  @ui.separator

  @ui.label('<span style="color: #60A5FA;">Settings</span>')
  @ui.group_start("Settings")
  @input
  @hint("Panel title text shown next to the football icon")
  titleText: string = "Draft Day"

  @input('vec3', '{0.45,0.9,0.55}')
  @widget(new ColorWidget())
  @hint("Authored live-source tint. Currently unused: the status line runs in neutral ink and the wifi / cloud-off icon carries the distinction, so no hue is spent on it.")
  liveColor: vec3 = new vec3(0.45, 0.9, 0.55)

  @input('vec3', '{0.95,0.75,0.3}')
  @widget(new ColorWidget())
  @hint("Authored fallback tint. Currently unused — see the live tint above.")
  offlineColor: vec3 = new vec3(0.95, 0.75, 0.3)

  @input('vec4', '{1,0.85,0.3,1}')
  @widget(new ColorWidget())
  @hint("Authored active-tab color. Currently unused: the active tab is a dark face with a white label, which reads at distance without spending a hue.")
  activeFilterColor: vec4 = new vec4(1, 0.85, 0.3, 1)
  @ui.group_end

  private statusText!: Text
  private statusIconMat!: Material
  private filterLabels: Text[] = []
  private filterFaces: RoundedRectangle[] = []
  private chalkParts: RoundedRectangle[] = []

  private _onRefresh = new Event<void>()
  private _onFilterChanged = new Event<string>()

  get onRefresh(): PublicApi<void> { return this._onRefresh.publicApi() }
  get onFilterChanged(): PublicApi<string> { return this._onFilterChanged.publicApi() }

  onAwake() {
    this.sceneObject.createComponent("Component.Canvas")
    const backPlate = this.sceneObject.createComponent(BackPlate.getTypeName()) as BackPlate
    // "simple" is the one flat, un-gradiented style; its own color is a dark
    // grey, which applyLightSurface() then overrides once BackPlate has built
    // its rounded rectangle (onInitialized fires from BackPlate's OnStartEvent,
    // and is a ReplayEvent, so a late subscribe still runs).
    backPlate.style = "simple"
    backPlate.onInitialized.add(() => applyLightSurface(this.sceneObject))

    const content = global.scene.createSceneObject("Content")
    content.setParent(this.sceneObject)
    content.getTransform().setLocalPosition(new vec3(0, 0, 0.6))

    const flex = content.createComponent(FlexLayout.getTypeName()) as FlexLayout
    flex.width = PANEL_W
    flex.height = -1
    flex.direction = FlexDirection.Column
    flex.alignItems = FlexAlign.Stretch
    flex.rowGap = 0.6
    flex.paddingTop = PAD
    flex.paddingBottom = PAD
    flex.paddingLeft = PAD
    flex.paddingRight = PAD
    flex.onLayoutComplete.add((r) => {
      backPlate.size = new vec2(r.containerWidth, r.containerHeight)
      this.layoutChalkRule(r.containerWidth, r.containerHeight)
    })
    this.buildChalkRule()

    const topRowItem = this.buildTopRow(content)
    const filterRowItem = this.buildFilterRow(content)
    const attributionItem = this.buildAttribution(content)
    flex.onInitialized.add(() => {
      flex.addItems([topRowItem, filterRowItem, attributionItem])
    })

    this.setActiveFilter("ALL")
  }

  // ── Row 1: icon+title (left) / status pill + refresh (right) ─────────────
  private buildTopRow(parent: SceneObject): FlexItem {
    const row = global.scene.createSceneObject("TopRow")
    row.setParent(parent)
    const rowFlex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    rowFlex.direction = FlexDirection.Row
    rowFlex.justifyContent = FlexJustify.SpaceBetween
    rowFlex.alignItems = FlexAlign.Center
    rowFlex.columnGap = 1.2
    rowFlex.width = -1
    rowFlex.height = 4.0
    const rowItem = row.createComponent(FlexItem.getTypeName()) as FlexItem
    rowItem.overrideHeight = 4.0

    // Title group: football icon + title text
    const titleGroup = global.scene.createSceneObject("TitleGroup")
    titleGroup.setParent(row)
    const tgFlex = titleGroup.createComponent(FlexLayout.getTypeName()) as FlexLayout
    tgFlex.direction = FlexDirection.Row
    tgFlex.alignItems = FlexAlign.Center
    tgFlex.columnGap = 0.6
    tgFlex.width = -1
    tgFlex.height = -1
    const titleGroupItem = titleGroup.createComponent(FlexItem.getTypeName()) as FlexItem

    const titleIcon = this.addImage(titleGroup, ICON_FOOTBALL, 2.2)
    // Upper-cased in code so the bar reads as a wordmark rather than a label.
    // The authored titleText @input is left alone; only its presentation changes.
    const titleLabel = this.addRowText(titleGroup, this.titleText.toUpperCase(), TITLE_SIZE, TITLE_WEIGHT, 11.0, ink(), "left")
    tgFlex.onInitialized.add(() => {
      tgFlex.addItems([titleIcon.item, titleLabel.item])
    })

    // Status group: status icon + status text
    const statusGroup = global.scene.createSceneObject("StatusGroup")
    statusGroup.setParent(row)
    const sgFlex = statusGroup.createComponent(FlexLayout.getTypeName()) as FlexLayout
    sgFlex.direction = FlexDirection.Row
    sgFlex.alignItems = FlexAlign.Center
    sgFlex.columnGap = 0.6
    sgFlex.width = -1
    sgFlex.height = -1
    const statusGroupItem = statusGroup.createComponent(FlexItem.getTypeName()) as FlexItem

    const statusIconRef = this.addImage(statusGroup, ICON_WIFI, 2.0)
    // Was 0.8 alpha; the status pill is the smallest text in the bar and the
    // first casualty of a bright background, so it now runs fully opaque.
    const statusTextRef = this.addRowText(statusGroup, "Connecting...", STATUS_SIZE, STATUS_WEIGHT, 14.0, ink(), "left")
    sgFlex.onInitialized.add(() => {
      sgFlex.addItems([statusIconRef.item, statusTextRef.item])
    })
    this.statusIconMat = statusIconRef.material
    this.statusText = statusTextRef.text

    // Refresh icon button
    const refreshItem = this.addIconButton(row, ICON_REFRESH, 3.6, () => this._onRefresh.invoke())

    rowFlex.onInitialized.add(() => {
      rowFlex.addItems([titleGroupItem, statusGroupItem, refreshItem])
    })
    return rowItem
  }

  // ── Row 2: position filter tabs ───────────────────────────────────────────
  private buildFilterRow(parent: SceneObject): FlexItem {
    const row = global.scene.createSceneObject("FilterRow")
    row.setParent(parent)
    const rowFlex = row.createComponent(FlexLayout.getTypeName()) as FlexLayout
    rowFlex.direction = FlexDirection.Row
    rowFlex.justifyContent = FlexJustify.Start
    rowFlex.alignItems = FlexAlign.Center
    rowFlex.columnGap = 0.6
    rowFlex.width = -1
    rowFlex.height = 3.0
    const rowItem = row.createComponent(FlexItem.getTypeName()) as FlexItem
    rowItem.overrideHeight = 3.0

    const items: FlexItem[] = []
    for (let i = 0; i < FILTER_KEYS.length; i++) {
      const key = FILTER_KEYS[i]
      const r = this.addButton(row, FILTER_LABELS[i], 5.5, 2.6, () => {
        this._onFilterChanged.invoke(key)
        this.setActiveFilter(key)
      })
      this.filterLabels.push(r.label)
      this.filterFaces.push(r.face)
      items.push(r.item)
    }
    rowFlex.onInitialized.add(() => {
      rowFlex.addItems(items)
    })
    return rowItem
  }

  // ── Chalk rule ────────────────────────────────────────────────────────────
  /**
   * A sideline with yard ticks along the bottom of the bar — the one piece of
   * sport identity in the build, and the cheapest possible one: N+1 plain
   * rectangles, no texture, no asset, no collider, nothing interactive.
   *
   * Created once here and positioned in layoutChalkRule() from the container
   * size the flex layout reports, so it tracks the bar's real dimensions
   * rather than assuming them. It sits outside the flex column entirely, so it
   * reserves no row and cannot move any content.
   */
  private buildChalkRule(): void {
    const line = this.makeChalkPart("ChalkLine")
    this.chalkParts.push(line)
    for (let i = 0; i < CHALK_TICKS; i++) {
      this.chalkParts.push(this.makeChalkPart(`ChalkTick_${i}`))
    }
  }

  private makeChalkPart(name: string): RoundedRectangle {
    const so = global.scene.createSceneObject(name)
    so.setParent(this.sceneObject)
    so.getTransform().setLocalPosition(new vec3(0, 0, CHALK_Z))
    const rect = so.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    rect.size = new vec2(1, CHALK_LINE_H_CM)
    rect.cornerRadius = 0
    // Opaque: a standalone RoundedRectangle discards alpha (see the bye-chip
    // note in DraftDayCardUI), so the chalk is a solid mid-grey rather than a
    // faint wash. Muted enough to sit under the text without competing.
    rect.backgroundColor = new vec4(CHALK_R, CHALK_G, CHALK_B, 1)
    rect.initialize()
    return rect
  }

  /** Fits the sideline and its ticks to the bar's actual laid-out size. */
  private layoutChalkRule(containerWidth: number, containerHeight: number): void {
    if (this.chalkParts.length < 1) return
    const lineW = containerWidth - 2 * CHALK_INSET_CM
    const baseY = -containerHeight / 2 + CHALK_MARGIN_CM

    const line = this.chalkParts[0]
    if (line && !isNull(line)) {
      line.size = new vec2(lineW, CHALK_LINE_H_CM)
      line.sceneObject.getTransform().setLocalPosition(new vec3(0, baseY, CHALK_Z))
    }

    // Ticks rise from the sideline at even intervals, like yard marks.
    const step = CHALK_TICKS > 1 ? lineW / (CHALK_TICKS - 1) : 0
    for (let i = 1; i < this.chalkParts.length; i++) {
      const tick = this.chalkParts[i]
      if (!tick || isNull(tick)) continue
      tick.size = new vec2(CHALK_TICK_W_CM, CHALK_TICK_H_CM)
      const x = -lineW / 2 + step * (i - 1)
      tick.sceneObject.getTransform().setLocalPosition(
        new vec3(x, baseY + CHALK_TICK_H_CM / 2, CHALK_Z)
      )
    }
  }

  // ── Row 3: data attribution ───────────────────────────────────────────────
  /**
   * Always on screen, never toggled: the source has to be credited whether the
   * app is on the live feed or the embedded snapshot, so this is a static row
   * rather than something setStatus() maintains. Deliberately the smallest,
   * lowest-contrast text in the build — present and readable, but never
   * competing with the player cards.
   */
  private buildAttribution(parent: SceneObject): FlexItem {
    const ref = this.addRowText(
      parent, ATTRIBUTION_TEXT, ATTRIBUTION_SIZE, ATTRIBUTION_WEIGHT,
      PANEL_W - 2 * PAD, inkSoft(), "left"
    )
    ref.item.overrideHeight = ATTRIBUTION_H
    return ref.item
  }

  // ── Public API ─────────────────────────────────────────────────────────────
  setStatus(text: string, isLive: boolean): void {
    if (!this.statusText || !this.statusIconMat) return
    this.statusText.text = text
    // Neutral ink, not the authored live/offline hue: color is reserved for
    // position bars and warnings, and the wifi / cloud-off icon beside this
    // string already carries the live-vs-snapshot distinction without it.
    this.statusText.textFill.color = ink()
    this.statusIconMat.mainPass.baseTex = isLive ? ICON_WIFI : ICON_CLOUD_OFF
  }

  setActiveFilter(filter: string): void {
    for (let i = 0; i < FILTER_KEYS.length; i++) {
      const t = this.filterLabels[i]
      if (!t) continue
      // Selection is carried by INVERSION — dark face, white label — never by
      // hue and never by fading a tab out. A faded tab reads as "not there"
      // rather than "not selected", and on a light plate it is the first thing
      // to disappear; hue is reserved for position bars and warnings.
      const active = FILTER_KEYS[i] === filter
      t.textFill.color = active ? new vec4(1, 1, 1, 1) : ink()
      ;(t as Text & { weight?: number }).weight = active ? TAB_ACTIVE_WEIGHT : TAB_WEIGHT

      const face = this.filterFaces[i]
      if (!face || isNull(face)) continue
      if (active) {
        face.backgroundColor = new vec4(TAB_ACTIVE_FILL_R, TAB_ACTIVE_FILL_G, TAB_ACTIVE_FILL_B, 1)
        face.border = false
      } else {
        face.backgroundColor = new vec4(TAB_IDLE_FILL_R, TAB_IDLE_FILL_G, TAB_IDLE_FILL_B, 1)
        face.border = true
        face.borderSize = TAB_BORDER_CM
        face.borderColor = new vec4(TAB_IDLE_BORDER_R, TAB_IDLE_BORDER_G, TAB_IDLE_BORDER_B, 1)
      }
    }
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
    // Reserved row height scales with the type — see DraftDayCardUI.addRowText.
    const halfH = size * LINE_HEIGHT_PER_SIZE
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -halfH, halfH)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    return { text: t, item }
  }

  private addButtonLabel(parent: SceneObject, text: string, widthCM: number, size: number = TAB_SIZE, weight: number = TAB_WEIGHT): Text {
    const so = global.scene.createSceneObject("ButtonLabel")
    so.setParent(parent)
    so.getTransform().setLocalPosition(new vec3(0, 0, BUTTON_LABEL_Z))
    const t = so.createComponent("Component.Text") as Text
    t.text = text
    t.depthTest = true
    applyType(t, size, weight)
    t.horizontalAlignment = HorizontalAlignment.Center
    t.verticalAlignment = VerticalAlignment.Center
    t.horizontalOverflow = HorizontalOverflow.Overflow
    t.verticalOverflow = VerticalOverflow.Overflow
    const halfH = size * LINE_HEIGHT_PER_SIZE
    t.layoutRect = Rect.create(-widthCM / 2, widthCM / 2, -halfH, halfH)
    return t
  }

  private addButton(
    parent: SceneObject, text: string, sizeXCM: number, sizeYCM: number, onClick: () => void
  ): { item: FlexItem; label: Text; face: RoundedRectangle } {
    const so = global.scene.createSceneObject(`Btn-${text}`)
    so.setParent(parent)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(sizeXCM, sizeYCM, 1)

    // Face first, then label: hierarchy order is paint order, so the face
    // covers the Button's themed visual and the label lands on top of both.
    // The Button keeps its collider, its interactable and its onTriggerUp —
    // this is a repaint of the tab, not a replacement of the control.
    const faceObj = global.scene.createSceneObject("TabFace")
    faceObj.setParent(so)
    faceObj.getTransform().setLocalPosition(new vec3(0, 0, TAB_FACE_Z))
    const face = faceObj.createComponent(RoundedRectangle.getTypeName()) as RoundedRectangle
    face.size = new vec2(TAB_FACE_W_CM, TAB_FACE_H_CM)
    face.cornerRadius = TAB_FACE_RADIUS_CM
    face.backgroundColor = new vec4(TAB_IDLE_FILL_R, TAB_IDLE_FILL_G, TAB_IDLE_FILL_B, 1)
    face.initialize()

    const label = this.addButtonLabel(so, text, sizeXCM - 0.5)
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    btn.onTriggerUp.add(onClick)
    return { item, label, face }
  }

  private addIconButton(parent: SceneObject, icon: Texture, sizeCM: number, onClick: () => void): FlexItem {
    const so = global.scene.createSceneObject("IconButton")
    so.setParent(parent)
    const btn = so.createComponent(Button.getTypeName()) as Button
    btn.size = new vec3(sizeCM, sizeCM, 1)
    const ec = so.createComponent(ElementContent.getTypeName()) as ElementContent
    ec.leadingIcon = icon
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    btn.onTriggerUp.add(onClick)
    return item
  }

  private addImage(parent: SceneObject, texture: Texture, sizeCM: number): { image: Image; material: Material; item: FlexItem } {
    const so = global.scene.createSceneObject("Icon")
    so.setParent(parent)
    const img = so.createComponent("Component.Image") as Image
    const mat = imageMaterial.clone()
    mat.mainPass.baseTex = texture
    mat.mainPass.depthTest = true
    mat.mainPass.depthWrite = false
    img.clearMaterials()
    img.addMaterial(mat)
    so.getTransform().setLocalScale(new vec3(sizeCM, sizeCM, 1))
    const item = so.createComponent(FlexItem.getTypeName()) as FlexItem
    return { image: img, material: mat, item }
  }
}
