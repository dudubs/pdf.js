/* Copyright 2022 Mozilla Foundation
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import {
  AnnotationEditorParamsType,
  AnnotationEditorType,
  shadow,
  Util,
} from "../../shared/util.js";
import { DrawingEditor, DrawingOptions } from "./draw.js";
import { InkDrawOutline, InkDrawOutliner } from "./drawers/inkdraw.js";
import { removeTouchedStrokes } from "./drawers/inkeraser.js";
import { AnnotationEditor } from "./editor.js";
import { BasicColorPicker } from "./color_picker.js";
import { InkAnnotationElement } from "../annotation_layer.js";

class InkDrawingOptions extends DrawingOptions {
  constructor(viewerParameters) {
    super();
    this._viewParameters = viewerParameters;

    super.updateProperties({
      fill: "none",
      stroke: AnnotationEditor._defaultLineColor,
      "stroke-opacity": 1,
      "stroke-width": 1,
      "stroke-linecap": "round",
      "stroke-linejoin": "round",
      "stroke-miterlimit": 10,
    });
  }

  updateSVGProperty(name, value) {
    if (name === "stroke-width") {
      value ??= this["stroke-width"];
      value *= this._viewParameters.realScale;
    }
    super.updateSVGProperty(name, value);
  }

  clone() {
    const clone = new InkDrawingOptions(this._viewParameters);
    clone.updateAll(this);
    return clone;
  }
}

/**
 * Basic draw editor in order to generate an Ink annotation.
 */
class InkEditor extends DrawingEditor {
  static _type = "ink";

  static _editorType = AnnotationEditorType.INK;

  static _defaultDrawingOptions = null;

  // Eraser state (local addition): `size` is the diameter in CSS pixels.
  static #eraser = { active: false, size: 24 };

  static #erasing = null;

  #removedByEraser = false;

  _hasBeenErased = false;

  constructor(params) {
    super({ ...params, name: "inkEditor" });
    this._willKeepAspectRatio = true;
    this.defaultL10nId = "pdfjs-editor-ink-editor";
  }

  /** @inheritdoc */
  static initialize(l10n, uiManager) {
    AnnotationEditor.initialize(l10n, uiManager);
    this._defaultDrawingOptions = new InkDrawingOptions(
      uiManager.viewParameters
    );
  }

  /** @inheritdoc */
  static getDefaultDrawingOptions(options) {
    const clone = this._defaultDrawingOptions.clone();
    clone.updateProperties(options);
    return clone;
  }

  static get supportsEraser() {
    return true;
  }

  /** @inheritdoc */
  static get supportMultipleDrawings() {
    return true;
  }

  /** @inheritdoc */
  static get typesMap() {
    return shadow(
      this,
      "typesMap",
      new Map([
        [AnnotationEditorParamsType.INK_THICKNESS, "stroke-width"],
        [AnnotationEditorParamsType.INK_COLOR, "stroke"],
        [AnnotationEditorParamsType.INK_OPACITY, "stroke-opacity"],
      ])
    );
  }

  /** @inheritdoc */
  static createDrawerInstance(x, y, parentWidth, parentHeight, rotation) {
    return new InkDrawOutliner(
      x,
      y,
      parentWidth,
      parentHeight,
      rotation,
      this._defaultDrawingOptions["stroke-width"]
    );
  }

  /** @inheritdoc */
  static deserializeDraw(
    pageX,
    pageY,
    pageWidth,
    pageHeight,
    innerMargin,
    data
  ) {
    return InkDrawOutline.deserialize(
      pageX,
      pageY,
      pageWidth,
      pageHeight,
      innerMargin,
      data
    );
  }

  /** @inheritdoc */
  static async deserialize(data, parent, uiManager) {
    let initialData = null;
    if (data instanceof InkAnnotationElement) {
      const {
        data: {
          inkLists,
          rect,
          rotation,
          id,
          color,
          opacity,
          borderStyle: { rawWidth: thickness },
          popupRef,
          richText,
          contentsObj,
          creationDate,
          modificationDate,
        },
        parent: {
          page: { pageNumber },
        },
      } = data;
      initialData = data = {
        annotationType: AnnotationEditorType.INK,
        color: Array.from(color),
        thickness,
        opacity,
        paths: { points: inkLists },
        boxes: null,
        pageIndex: pageNumber - 1,
        rect: rect.slice(0),
        rotation,
        annotationElementId: id,
        id,
        deleted: false,
        popupRef,
        richText,
        comment: contentsObj?.str || null,
        creationDate,
        modificationDate,
      };
    }

    const editor = await super.deserialize(data, parent, uiManager);
    editor._initialData = initialData;
    if (data.comment) {
      editor.setCommentData(data);
    }

    return editor;
  }

  /** @inheritdoc */
  get toolbarButtons() {
    this._colorPicker ||= new BasicColorPicker(this);
    return [["colorPicker", this._colorPicker]];
  }

  get colorType() {
    return AnnotationEditorParamsType.INK_COLOR;
  }

  get colorAndOpacityType() {
    return AnnotationEditorParamsType.INK_COLOR_AND_OPACITY;
  }

  get opacityType() {
    return AnnotationEditorParamsType.INK_OPACITY;
  }

  /** @inheritdoc */
  updateParams(type, value) {
    if (type === AnnotationEditorParamsType.INK_COLOR_AND_OPACITY) {
      this._updateColorAndOpacity(value.color, value.opacity);
      return;
    }
    super.updateParams(type, value);
  }

  /** @inheritdoc */
  static updateDefaultParams(type, value) {
    if (type === AnnotationEditorParamsType.INK_ERASER) {
      InkEditor.#eraser.active = !!value;
      return;
    }
    if (type === AnnotationEditorParamsType.INK_ERASER_SIZE) {
      InkEditor.#eraser.size = Math.max(2, +value || 0);
      return;
    }
    if (type === AnnotationEditorParamsType.INK_COLOR_AND_OPACITY) {
      super.updateDefaultParams(
        AnnotationEditorParamsType.INK_COLOR,
        value.color
      );
      super.updateDefaultParams(
        AnnotationEditorParamsType.INK_OPACITY,
        value.opacity
      );
      return;
    }
    super.updateDefaultParams(type, value);
  }

  get color() {
    return this._drawingOptions.stroke;
  }

  get opacity() {
    return this._drawingOptions["stroke-opacity"];
  }

  /** @inheritdoc */
  onScaleChanging() {
    if (!this.parent) {
      return;
    }
    super.onScaleChanging();
    const { _drawId, _drawingOptions, parent } = this;
    _drawingOptions.updateSVGProperty("stroke-width");
    parent.drawLayer.updateProperties(
      _drawId,
      _drawingOptions.toSVGProperties()
    );
  }

  static onScaleChangingWhenDrawing() {
    const parent = this._currentParent;
    if (!parent) {
      return;
    }
    super.onScaleChangingWhenDrawing();
    this._defaultDrawingOptions.updateSVGProperty("stroke-width");
    parent.drawLayer.updateProperties(
      this._currentDrawId,
      this._defaultDrawingOptions.toSVGProperties()
    );
  }

  /** @inheritdoc */
  createDrawingOptions({ color, thickness, opacity }) {
    this._drawingOptions = InkEditor.getDefaultDrawingOptions({
      stroke: Util.makeHexColor(...color),
      "stroke-width": thickness,
      "stroke-opacity": opacity,
    });
  }

  /** @inheritdoc */
  serialize(isForCopying = false) {
    if (this.isEmpty()) {
      return null;
    }

    if (this.deleted) {
      return this.serializeDeleted();
    }

    const { lines, points } = this.serializeDraw(isForCopying);
    const {
      _drawingOptions: {
        stroke,
        "stroke-opacity": opacity,
        "stroke-width": thickness,
      },
    } = this;
    const serialized = Object.assign(super.serialize(isForCopying), {
      color: AnnotationEditor._colorManager.convert(stroke),
      opacity,
      thickness,
      paths: {
        lines,
        points,
      },
    });
    this.addComment(serialized);

    if (isForCopying) {
      serialized.isCopy = true;
      return serialized;
    }

    if (this.annotationElementId && !this.#hasElementChanged(serialized)) {
      return null;
    }

    serialized.id = this.annotationElementId;
    return serialized;
  }

  #hasElementChanged(serialized) {
    const { color, thickness, opacity, pageIndex } = this._initialData;
    return (
      this.hasEditedComment ||
      this._hasBeenMoved ||
      this._hasBeenResized ||
      this._hasBeenErased ||
      serialized.color.some((c, i) => c !== color[i]) ||
      serialized.thickness !== thickness ||
      serialized.opacity !== opacity ||
      serialized.pageIndex !== pageIndex
    );
  }


  // ---------------------------------------------------------------------
  // Eraser (local addition).
  //
  // While the eraser is active, a pointer gesture on a page removes every
  // stroke (one continuous line) of the ink editors of that page that the
  // pointer touches. A touched stroke is removed entirely; the whole gesture
  // is a single undoable command. (drawers/inkeraser.js also
  // has eraseStrokes() to only cut the touched part of a stroke.)
  // ---------------------------------------------------------------------

  /** @inheritdoc */
  static startDrawing(parent, uiManager, isLTR, event) {
    if (!InkEditor.#eraser.active) {
      super.startDrawing(parent, uiManager, isLTR, event);
      return;
    }
    InkEditor.#startErasing(parent, uiManager, event);
  }

  /** @inheritdoc */
  static endDrawing(isAborted) {
    if (InkEditor.#erasing) {
      InkEditor.#stopErasing();
      return null;
    }
    return super.endDrawing(isAborted);
  }

  static #startErasing(parent, uiManager, event) {
    if (InkEditor.#erasing) {
      // A second pointer: ignore it.
      return;
    }
    const { pointerId } = event;
    const ac = new AbortController();
    const signal = parent.combinedSignal(ac);
    const state = (InkEditor.#erasing = {
      parent,
      uiManager,
      ac,
      pointerId,
      last: null,
      touched: new Map(),
    });

    const onEnd = e => {
      if (e.pointerId === pointerId) {
        InkEditor.#stopErasing();
      }
    };
    window.addEventListener("pointerup", onEnd, { signal });
    window.addEventListener("pointercancel", onEnd, { signal });
    parent.div.addEventListener(
      "pointermove",
      e => {
        if (e.pointerId === pointerId) {
          InkEditor.#eraseTo(state, e.clientX, e.clientY);
          e.preventDefault();
        }
      },
      { signal }
    );
    uiManager._editorUndoBar?.hide();
    InkEditor.#eraseTo(state, event.clientX, event.clientY);
  }

  static #stopErasing() {
    const state = InkEditor.#erasing;
    if (!state) {
      return;
    }
    InkEditor.#erasing = null;
    state.ac.abort();

    if (state.touched.size === 0) {
      return;
    }
    const entries = [];
    for (const [editor, before] of state.touched) {
      entries.push({ editor, before, after: editor._getStrokes() });
    }
    state.parent.addCommands({
      cmd: () => {
        for (const { editor, after } of entries) {
          editor._applyStrokes(after);
        }
      },
      undo: () => {
        for (const { editor, before } of entries) {
          editor._applyStrokes(before);
        }
      },
      mustExec: false,
      type: AnnotationEditorParamsType.INK_ERASER,
    });
  }

  static #eraseTo(state, clientX, clientY) {
    const { parent, last } = state;
    const rect = parent.div.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) {
      return;
    }
    const x = clientX - rect.left;
    const y = clientY - rect.top;
    state.last = [x, y];

    const radius = InkEditor.#eraser.size / 2;
    // Walk along the pointer path so that fast moves don't leave holes.
    let steps = 1;
    if (last) {
      steps = Math.max(1, Math.ceil(Math.hypot(x - last[0], y - last[1]) / (radius / 2)));
    }
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const px = last ? last[0] + (x - last[0]) * t : x;
      const py = last ? last[1] + (y - last[1]) * t : y;
      InkEditor.#eraseAt(state, px / rect.width, py / rect.height, radius, rect);
    }
  }

  static #eraseAt(state, nx, ny, radius, rect) {
    const { parent, uiManager, touched } = state;
    const {
      viewport: {
        rotation,
        rawDims: { pageX, pageY, pageWidth, pageHeight },
      },
    } = parent;

    // Same mapping as InkDrawOutline.serialize (page rotation aware).
    let cx, cy;
    switch (rotation) {
      case 90:
        cx = pageX + ny * pageWidth;
        cy = pageY + nx * pageHeight;
        break;
      case 180:
        cx = pageX + (1 - nx) * pageWidth;
        cy = pageY + ny * pageHeight;
        break;
      case 270:
        cx = pageX + (1 - ny) * pageWidth;
        cy = pageY + (1 - nx) * pageHeight;
        break;
      default:
        cx = pageX + nx * pageWidth;
        cy = pageY + (1 - ny) * pageHeight;
    }
    const r = radius / parent.scale;
    const mx = radius / rect.width;
    const my = radius / rect.height;

    for (const editor of uiManager.getEditors(parent.pageIndex)) {
      if (
        !(editor instanceof InkEditor) ||
        editor.parent !== parent ||
        editor.#removedByEraser
      ) {
        continue;
      }
      // Cheap rejection using the editor box (parent coordinates).
      if (
        nx < editor.x - mx ||
        nx > editor.x + editor.width + mx ||
        ny < editor.y - my ||
        ny > editor.y + editor.height + my
      ) {
        continue;
      }
      editor._erase(cx, cy, r, touched);
    }
  }

  _erase(cx, cy, r, touched) {
    const before = this._getStrokes();
    // The stroke has a width: erase everything the eraser visually touches.
    const halfWidth = this._drawingOptions["stroke-width"] / 2;
    const after = removeTouchedStrokes(before, cx, cy, r + halfWidth);
    if (!after) {
      return;
    }
    if (!touched.has(this)) {
      touched.set(this, before);
    }
    this._applyStrokes(after);
  }

  /**
   * @returns {Array<Float32Array>} The strokes as flat polylines in PDF page
   *   coordinates.
   */
  _getStrokes() {
    return this.#removedByEraser ? [] : this.serializeDraw(false).points;
  }

  /**
   * Replace the strokes of this editor (no undo command is created).
   * @param {Array<Float32Array>} strokes - Empty to remove the editor.
   */
  _applyStrokes(strokes) {
    if (strokes.length === 0) {
      if (!this.#removedByEraser) {
        this.#removedByEraser = true;
        this.remove();
        this._uiManager.markModified();
      }
      return;
    }
    if (this.#removedByEraser) {
      this.#removedByEraser = false;
      // The editor has been detached from its layer when it was removed.
      (this.parent || this._uiManager.getLayer(this.pageIndex)).addOrRebuild(
        this
      );
    }
    const { rotation, thickness } = this._drawOutlines;
    const [pageX, pageY] = this.pageTranslation;
    const [pageWidth, pageHeight] = this.pageDimensions;
    this._replaceOutlines(
      InkDrawOutline.deserialize(
        pageX,
        pageY,
        pageWidth,
        pageHeight,
        InkEditor._INNER_MARGIN,
        { paths: { points: strokes }, rotation, thickness }
      )
    );
    this._hasBeenErased = true;
    this._uiManager.markModified();
  }

  /** @inheritdoc */
  renderAnnotationElement(annotation) {
    if (this.deleted) {
      annotation.hide();
      return null;
    }
    const { points, rect } = this.serializeDraw(/* isForCopying = */ false);
    annotation.updateEdited({
      rect,
      thickness: this._drawingOptions["stroke-width"],
      points,
      popup: this.comment,
    });

    return null;
  }
}

export { InkDrawingOptions, InkEditor };
