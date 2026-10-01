"use strict";

type HslKey = "h" | "s" | "l";
type RgbKey = "r" | "g" | "b";
type ColorSide = "start" | "end";
type FitMethod = "piecewise-quadratic" | "adaptive-quadratic" | "adaptive-linear";

type Point = {
  x: number;
  y: number;
};

type HslColor = Record<HslKey, number>;
type RgbColor = Record<RgbKey, number>;

type CubicCurve = {
  p1: Point;
  p2: Point;
};

type QuadraticCurve = {
  p0: number;
  p1: number;
  p2: number;
};

type QuadraticSegment = {
  startFrame: number;
  endFrame: number;
  curves: Record<RgbKey, QuadraticCurve>;
};

type QuantizedFrame = {
  frame: number;
  swatch: string;
  srgb: RgbColor;
  hex: string;
};

type FitFrame = {
  frame: number;
  targetHex: string;
  fitHex: string;
  targetSrgb: RgbColor;
  fitSrgb: RgbColor;
  error: number;
};

type FitMetrics = {
  rmseChannel: number;
  rmseRgbDistance: number;
  maxRgbDistance: number;
  maxChannelError: number;
};

type QuadraticFitModel = {
  method: "piecewise-quadratic" | "adaptive-quadratic";
  threshold?: number;
  segments: number;
  knots: number[];
  curves: QuadraticSegment[];
};

type LinearFitModel = {
  method: "adaptive-linear";
  threshold: number;
  segments: number;
  knots: number[];
};

type FitModel = QuadraticFitModel | LinearFitModel;

type CurveEditor = {
  svg: SVGSVGElement;
  dragging: "p1" | "p2" | null;
};

type ChannelConfig = {
  key: HslKey;
  label: string;
  unit: string;
  min: number;
  max: number;
};

type RgbChannelConfig = {
  key: RgbKey;
  color: string;
  label: string;
};

type GraphPadding = {
  left: number;
  right: number;
  top: number;
  bottom: number;
};

type SideElements = {
  picker: HTMLInputElement;
} & Record<HslKey, HTMLInputElement> & Record<`${HslKey}Value`, HTMLOutputElement>;

type AppElements = {
  controls: HTMLFormElement;
  frameCount: HTMLInputElement;
  fitMethod: HTMLSelectElement;
  segmentCount: HTMLInputElement;
  segmentCountRow: HTMLElement;
  linearThreshold: HTMLInputElement;
  linearThresholdRow: HTMLElement;
  resetCurves: HTMLButtonElement;
  curveEditors: HTMLElement;
  componentGraph: HTMLCanvasElement;
  frameReadout: HTMLOutputElement;
  fitMetrics: HTMLDListElement;
  gradientPreview: HTMLDivElement;
  quantizedJson: HTMLTextAreaElement;
  fitJson: HTMLTextAreaElement;
  copyQuantized: HTMLButtonElement;
  copyFit: HTMLButtonElement;
  frameTableBody: HTMLTableSectionElement;
  start: SideElements;
  end: SideElements;
};

type AppState = {
  colors: Record<ColorSide, HslColor>;
  curves: Record<HslKey, CubicCurve>;
  frameCount: number;
  fitMethod: FitMethod;
  segmentCount: number;
  linearThreshold: number;
  quantized: QuantizedFrame[];
  fit: FitFrame[];
  fitModel: FitModel | null;
  fitMetrics: FitMetrics | null;
  activeFrame: number | null;
};

const CHANNELS: ChannelConfig[] = [
  { key: "h", label: "Hue", unit: "deg", min: 0, max: 360 },
  { key: "s", label: "Saturation", unit: "%", min: 0, max: 100 },
  { key: "l", label: "Lightness", unit: "%", min: 0, max: 100 }
] as const;

const RGB_CHANNELS: RgbChannelConfig[] = [
  { key: "r", color: "#d43c32", label: "R" },
  { key: "g", color: "#238b45", label: "G" },
  { key: "b", color: "#2667d8", label: "B" }
] as const;

const COLOR_SIDES: ColorSide[] = ["start", "end"] as const;

const state: AppState = {
  colors: {
    start: { h: 220, s: 60, l: 50 },
    end: { h: 48, s: 88, l: 57 }
  },
  curves: {
    h: createLinearCurve(),
    s: createLinearCurve(),
    l: createLinearCurve()
  },
  frameCount: 256,
  fitMethod: "piecewise-quadratic",
  segmentCount: 12,
  linearThreshold: 3,
  quantized: [],
  fit: [],
  fitModel: null,
  fitMetrics: null,
  activeFrame: null
};

let elements: AppElements;
const curveEditors = new Map<HslKey, CurveEditor>();

document.addEventListener("DOMContentLoaded", init);

function init() {
  bindElements();
  buildCurveEditors();
  bindInputs();
  syncAllColorControls();
  recalculate();
}

function bindElements() {
  elements = {
    controls: queryElement("#controls", HTMLFormElement),
    frameCount: queryElement("#frameCount", HTMLInputElement),
    fitMethod: queryElement("#fitMethod", HTMLSelectElement),
    segmentCount: queryElement("#segmentCount", HTMLInputElement),
    segmentCountRow: queryElement("#segmentCountRow", HTMLElement),
    linearThreshold: queryElement("#linearThreshold", HTMLInputElement),
    linearThresholdRow: queryElement("#linearThresholdRow", HTMLElement),
    resetCurves: queryElement("#resetCurves", HTMLButtonElement),
    curveEditors: queryElement("#curveEditors", HTMLElement),
    componentGraph: queryElement("#componentGraph", HTMLCanvasElement),
    frameReadout: queryElement("#frameReadout", HTMLOutputElement),
    fitMetrics: queryElement("#fitMetrics", HTMLDListElement),
    gradientPreview: queryElement("#gradientPreview", HTMLDivElement),
    quantizedJson: queryElement("#quantizedJson", HTMLTextAreaElement),
    fitJson: queryElement("#fitJson", HTMLTextAreaElement),
    copyQuantized: queryElement("#copyQuantized", HTMLButtonElement),
    copyFit: queryElement("#copyFit", HTMLButtonElement),
    frameTableBody: queryElement("#frameTableBody", HTMLTableSectionElement),
    start: createSideElements("start"),
    end: createSideElements("end")
  };
}

function queryElement<T extends Element>(selector: string, constructor: { new (): T }): T {
  const element = document.querySelector(selector);
  if (!(element instanceof constructor)) {
    throw new Error(`Missing expected element: ${selector}`);
  }
  return element;
}

function createSideElements(side: ColorSide): SideElements {
  return {
    picker: queryElement(`#${side}Color`, HTMLInputElement),
    h: queryElement(`#${side}H`, HTMLInputElement),
    s: queryElement(`#${side}S`, HTMLInputElement),
    l: queryElement(`#${side}L`, HTMLInputElement),
    hValue: queryElement(`#${side}HValue`, HTMLOutputElement),
    sValue: queryElement(`#${side}SValue`, HTMLOutputElement),
    lValue: queryElement(`#${side}LValue`, HTMLOutputElement)
  };
}

function bindInputs() {
  for (const side of COLOR_SIDES) {
    elements[side].picker.addEventListener("input", () => {
      state.colors[side] = rgbToHsl(hexToRgb(elements[side].picker.value));
      syncColorSliders(side);
      recalculate();
    });

    for (const channel of CHANNELS) {
      elements[side][channel.key].addEventListener("input", () => {
        state.colors[side][channel.key] = Number(elements[side][channel.key].value);
        syncColorPicker(side);
        syncColorOutput(side, channel.key);
        recalculate();
      });
    }
  }

  elements.frameCount.addEventListener("input", () => {
    const next = Math.max(2, Math.round(Number(elements.frameCount.value) || 2));
    state.frameCount = next;
    if (String(next) !== elements.frameCount.value) {
      elements.frameCount.value = String(next);
    }
    recalculate();
  });

  elements.fitMethod.addEventListener("change", () => {
    state.fitMethod = parseFitMethod(elements.fitMethod.value);
    syncFitControls();
    recalculate();
  });

  elements.segmentCount.addEventListener("input", () => {
    const next = clamp(Math.round(Number(elements.segmentCount.value) || 1), 1, 32);
    state.segmentCount = next;
    elements.segmentCount.value = String(next);
    recalculate();
  });

  elements.linearThreshold.addEventListener("input", () => {
    const next = clamp(Number(elements.linearThreshold.value) || 0.5, 0.5, 64);
    state.linearThreshold = next;
    elements.linearThreshold.value = String(next);
    recalculate();
  });

  elements.resetCurves.addEventListener("click", () => {
    for (const channel of CHANNELS) {
      state.curves[channel.key] = createLinearCurve();
      renderCurveEditor(channel.key);
    }
    recalculate();
  });

  elements.copyQuantized.addEventListener("click", () => copyText(elements.quantizedJson.value, elements.copyQuantized));
  elements.copyFit.addEventListener("click", () => copyText(elements.fitJson.value, elements.copyFit));

  elements.componentGraph.addEventListener("pointermove", handleGraphPointer);
  elements.gradientPreview.addEventListener("pointermove", handleGradientPointer);
  elements.componentGraph.addEventListener("pointerleave", clearActiveFrame);
  elements.gradientPreview.addEventListener("pointerleave", clearActiveFrame);
}

function syncFitControls() {
  elements.segmentCountRow.hidden = state.fitMethod !== "piecewise-quadratic";
  elements.linearThresholdRow.hidden = !["adaptive-quadratic", "adaptive-linear"].includes(state.fitMethod);
}

function syncAllColorControls() {
  for (const side of COLOR_SIDES) {
    syncColorPicker(side);
    syncColorSliders(side);
  }
}

function syncColorSliders(side: ColorSide): void {
  for (const channel of CHANNELS) {
    elements[side][channel.key].value = String(Math.round(state.colors[side][channel.key]));
    syncColorOutput(side, channel.key);
  }
}

function syncColorPicker(side: ColorSide): void {
  elements[side].picker.value = rgbToHex(hslToRgb(state.colors[side]));
}

function syncColorOutput(side: ColorSide, key: HslKey): void {
  const channel = CHANNELS.find((item) => item.key === key);
  if (!channel) {
    throw new Error(`Unknown HSL channel: ${key}`);
  }
  elements[side][`${key}Value`].textContent = `${Math.round(state.colors[side][key])}${channel.unit}`;
}

function buildCurveEditors(): void {
  elements.curveEditors.replaceChildren();
  for (const channel of CHANNELS) {
    const article = document.createElement("article");
    article.className = "curve-card";

    const heading = document.createElement("h3");
    heading.textContent = channel.label;

    const svg = createSvgElement("svg");
    svg.classList.add("curve-editor");
    svg.setAttribute("viewBox", "0 0 320 220");
    svg.setAttribute("role", "img");
    svg.setAttribute("aria-label", `${channel.label} interpolation curve editor`);
    svg.dataset.channel = channel.key;

    article.append(heading, svg);
    elements.curveEditors.append(article);
    curveEditors.set(channel.key, { svg, dragging: null });
    bindCurveEditor(channel.key);
    renderCurveEditor(channel.key);
  }
}

function bindCurveEditor(key: HslKey): void {
  const editor = getCurveEditor(key);
  editor.svg.addEventListener("pointerdown", (event) => {
    const point = pointerToCurvePoint(editor.svg, event);
    const curve = state.curves[key];
    const distanceToP1 = squaredDistance(point, curve.p1);
    const distanceToP2 = squaredDistance(point, curve.p2);
    editor.dragging = distanceToP1 <= distanceToP2 ? "p1" : "p2";
    editor.svg.setPointerCapture(event.pointerId);
    moveCurvePoint(key, editor.dragging, point);
  });

  editor.svg.addEventListener("pointermove", (event) => {
    if (!editor.dragging) return;
    moveCurvePoint(key, editor.dragging, pointerToCurvePoint(editor.svg, event));
  });

  editor.svg.addEventListener("pointerup", (event) => {
    editor.dragging = null;
    editor.svg.releasePointerCapture(event.pointerId);
  });

  editor.svg.addEventListener("pointercancel", () => {
    editor.dragging = null;
  });
}

function moveCurvePoint(key: HslKey, pointKey: "p1" | "p2", point: Point): void {
  state.curves[key][pointKey] = {
    x: clamp(point.x, 0, 1),
    y: clamp(point.y, 0, 1)
  };
  renderCurveEditor(key);
  recalculate();
}

function renderCurveEditor(key: HslKey): void {
  const editor = getCurveEditor(key);
  const svg = editor.svg;
  svg.replaceChildren();

  const padding = 28;
  const width = 320;
  const height = 220;
  const plotWidth = width - padding * 2;
  const plotHeight = height - padding * 2;
  const curve = state.curves[key];
  const toSvg = (point: Point): Point => ({
    x: padding + point.x * plotWidth,
    y: padding + (1 - point.y) * plotHeight
  });
  const p0 = toSvg({ x: 0, y: 0 });
  const p1 = toSvg(curve.p1);
  const p2 = toSvg(curve.p2);
  const p3 = toSvg({ x: 1, y: 1 });

  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    svg.append(createLine(padding + ratio * plotWidth, padding, padding + ratio * plotWidth, height - padding, "curve-grid-line"));
    svg.append(createLine(padding, padding + ratio * plotHeight, width - padding, padding + ratio * plotHeight, "curve-grid-line"));
  }

  svg.append(createLine(padding, height - padding, width - padding, height - padding, "curve-axis"));
  svg.append(createLine(padding, padding, padding, height - padding, "curve-axis"));
  svg.append(createLine(p0.x, p0.y, p1.x, p1.y, "curve-handle-line"));
  svg.append(createLine(p3.x, p3.y, p2.x, p2.y, "curve-handle-line"));

  const path = createSvgElement("path");
  path.classList.add("curve-path");
  path.setAttribute("d", `M ${p0.x} ${p0.y} C ${p1.x} ${p1.y}, ${p2.x} ${p2.y}, ${p3.x} ${p3.y}`);
  svg.append(path);
  svg.append(createCircle(p1.x, p1.y, 7, "curve-point"));
  svg.append(createCircle(p2.x, p2.y, 7, "curve-point"));
}

function getCurveEditor(key: HslKey): CurveEditor {
  const editor = curveEditors.get(key);
  if (!editor) {
    throw new Error(`Missing curve editor: ${key}`);
  }
  return editor;
}

function recalculate() {
  state.frameCount = Math.max(2, Math.round(Number(elements.frameCount.value) || 2));
  elements.frameCount.value = String(state.frameCount);
  state.fitMethod = parseFitMethod(elements.fitMethod.value);
  state.segmentCount = clamp(Math.round(Number(elements.segmentCount.value) || 1), 1, 32);
  state.linearThreshold = clamp(Number(elements.linearThreshold.value) || 0.5, 0.5, 64);
  elements.segmentCount.value = String(state.segmentCount);
  elements.linearThreshold.value = String(state.linearThreshold);
  syncFitControls();
  state.quantized = buildQuantizedFrames();
  state.fitModel = buildFitModel(state.quantized);
  state.fit = buildFitFrames(state.quantized, state.fitModel);
  state.fitMetrics = calculateFitMetrics(state.quantized, state.fit);
  renderOutputs();
}

function parseFitMethod(value: string): FitMethod {
  if (value === "adaptive-quadratic" || value === "adaptive-linear" || value === "piecewise-quadratic") {
    return value;
  }
  return "piecewise-quadratic";
}

function buildQuantizedFrames(): QuantizedFrame[] {
  const frames: QuantizedFrame[] = [];
  const last = state.frameCount - 1;
  for (let frame = 0; frame < state.frameCount; frame += 1) {
    const t = last === 0 ? 0 : frame / last;
    const hProgress = bezierYForX(state.curves.h, t);
    const sProgress = bezierYForX(state.curves.s, t);
    const lProgress = bezierYForX(state.curves.l, t);
    const h = normalizeHue(state.colors.start.h + hueDeltaShortest(state.colors.start.h, state.colors.end.h) * hProgress);
    const s = lerp(state.colors.start.s, state.colors.end.s, sProgress);
    const l = lerp(state.colors.start.l, state.colors.end.l, lProgress);
    const rgb = hslToRgb({ h, s, l });
    const hex = rgbToHex(rgb);
    frames.push({
      frame,
      swatch: hex,
      srgb: rgb,
      hex
    });
  }
  return frames;
}

function assertExhaustivenessOrUndefinedBehavior(n: never): never {
  return n;
}

function buildFitModel(frames: QuantizedFrame[]): FitModel {
  const { fitMethod } = state;

  if (fitMethod === "piecewise-quadratic") {
    return fitPiecewiseQuadraticModel(frames, state.segmentCount);
  }
  if (fitMethod === "adaptive-quadratic") {
    return fitAdaptiveQuadraticModel(frames, state.linearThreshold);
  }
  if (fitMethod === "adaptive-linear") {
    return fitAdaptiveLinearModel(frames, state.linearThreshold);
  }

  return assertExhaustivenessOrUndefinedBehavior(fitMethod);
}

function fitPiecewiseQuadraticModel(frames: QuantizedFrame[], segmentCount: number): QuadraticFitModel {
  const knots = buildEvenKnots(frames.length, segmentCount);
  const segments: QuadraticSegment[] = [];
  for (let index = 0; index < knots.length - 1; index += 1) {
    const startFrame = knots[index];
    const endFrame = knots[index + 1];
    const curves = {} as Record<RgbKey, QuadraticCurve>;
    for (const channel of RGB_CHANNELS) {
      curves[channel.key] = fitQuadraticChannel(frames, channel.key, startFrame, endFrame);
    }
    segments.push({ startFrame, endFrame, curves });
  }
  return {
    method: "piecewise-quadratic",
    segments: segments.length,
    knots,
    curves: segments
  };
}

function fitAdaptiveQuadraticModel(frames: QuantizedFrame[], threshold: number): QuadraticFitModel {
  const segments: QuadraticSegment[] = [];
  collectQuadraticSegments(frames, 0, frames.length - 1, threshold, segments);
  segments.sort((a, b) => a.startFrame - b.startFrame);
  const knots = [segments[0].startFrame];
  for (const segment of segments) {
    if (knots[knots.length - 1] !== segment.endFrame) {
      knots.push(segment.endFrame);
    }
  }
  return {
    method: "adaptive-quadratic",
    threshold,
    segments: segments.length,
    knots,
    curves: segments
  };
}

function fitAdaptiveLinearModel(frames: QuantizedFrame[], threshold: number): LinearFitModel {
  const knots = [0];
  collectLinearKnots(frames, 0, frames.length - 1, threshold, knots);
  knots.push(frames.length - 1);
  knots.sort((a, b) => a - b);
  return {
    method: "adaptive-linear",
    threshold,
    segments: knots.length - 1,
    knots
  };
}

function buildEvenKnots(frameCount: number, segmentCount: number): number[] {
  const last = frameCount - 1;
  const cappedSegments = clamp(segmentCount, 1, Math.max(1, last));
  const knots: number[] = [];
  for (let index = 0; index <= cappedSegments; index += 1) {
    const frame = Math.round((index * last) / cappedSegments);
    if (knots[knots.length - 1] !== frame) {
      knots.push(frame);
    }
  }
  if (knots[0] !== 0) knots.unshift(0);
  if (knots[knots.length - 1] !== last) knots.push(last);
  return knots;
}

function fitQuadraticChannel(frames: QuantizedFrame[], channel: RgbKey, startFrame: number, endFrame: number): QuadraticCurve {
  const p0 = frames[startFrame].srgb[channel];
  const p2 = frames[endFrame].srgb[channel];
  const span = endFrame - startFrame;
  if (span <= 0) return { p0, p1: p0, p2 };
  let denominator = 0;
  let numerator = 0;
  for (let frame = startFrame; frame <= endFrame; frame += 1) {
    const t = (frame - startFrame) / span;
    const mt = 1 - t;
    const weight = 2 * mt * t;
    const base = mt * mt * p0 + t * t * p2;
    denominator += weight * weight;
    numerator += weight * (frames[frame].srgb[channel] - base);
  }
  const p1 = denominator > 1e-9 ? numerator / denominator : (p0 + p2) / 2;
  return {
    p0,
    p1: clamp(p1, 0, 255),
    p2
  };
}

function collectQuadraticSegments(
  frames: QuantizedFrame[],
  startFrame: number,
  endFrame: number,
  threshold: number,
  segments: QuadraticSegment[]
): void {
  const segment = fitQuadraticSegment(frames, startFrame, endFrame);
  const split = findMaxQuadraticError(frames, segment);
  if (split.error > threshold && split.frame > startFrame && split.frame < endFrame) {
    collectQuadraticSegments(frames, startFrame, split.frame, threshold, segments);
    collectQuadraticSegments(frames, split.frame, endFrame, threshold, segments);
    return;
  }
  segments.push(segment);
}

function fitQuadraticSegment(frames: QuantizedFrame[], startFrame: number, endFrame: number): QuadraticSegment {
  const curves = {} as Record<RgbKey, QuadraticCurve>;
  for (const channel of RGB_CHANNELS) {
    curves[channel.key] = fitQuadraticChannel(frames, channel.key, startFrame, endFrame);
  }
  return { startFrame, endFrame, curves };
}

function findMaxQuadraticError(frames: QuantizedFrame[], segment: QuadraticSegment): { frame: number; error: number } {
  const span = segment.endFrame - segment.startFrame;
  let maxError = 0;
  let splitFrame = -1;
  for (let frame = segment.startFrame + 1; frame < segment.endFrame; frame += 1) {
    const t = span === 0 ? 0 : (frame - segment.startFrame) / span;
    let errorSquared = 0;
    for (const channel of RGB_CHANNELS) {
      const key = channel.key;
      const predicted = clampByte(quadraticValue(segment.curves[key], t));
      errorSquared += (frames[frame].srgb[key] - predicted) ** 2;
    }
    const error = Math.sqrt(errorSquared);
    if (error > maxError) {
      maxError = error;
      splitFrame = frame;
    }
  }
  return { frame: splitFrame, error: maxError };
}

function collectLinearKnots(
  frames: QuantizedFrame[],
  startFrame: number,
  endFrame: number,
  threshold: number,
  knots: number[]
): void {
  let maxError = 0;
  let splitFrame = -1;
  for (let frame = startFrame + 1; frame < endFrame; frame += 1) {
    const error = linearFrameError(frames, frame, startFrame, endFrame);
    if (error > maxError) {
      maxError = error;
      splitFrame = frame;
    }
  }
  if (maxError > threshold && splitFrame > startFrame && splitFrame < endFrame) {
    collectLinearKnots(frames, startFrame, splitFrame, threshold, knots);
    knots.push(splitFrame);
    collectLinearKnots(frames, splitFrame, endFrame, threshold, knots);
  }
}

function linearFrameError(frames: QuantizedFrame[], frame: number, startFrame: number, endFrame: number): number {
  const span = endFrame - startFrame;
  const t = span === 0 ? 0 : (frame - startFrame) / span;
  let errorSquared = 0;
  for (const channel of RGB_CHANNELS) {
    const key = channel.key;
    const predicted = lerp(frames[startFrame].srgb[key], frames[endFrame].srgb[key], t);
    errorSquared += (frames[frame].srgb[key] - predicted) ** 2;
  }
  return Math.sqrt(errorSquared);
}

function buildFitFrames(targetFrames: QuantizedFrame[], model: FitModel): FitFrame[] {
  const frames: FitFrame[] = [];
  for (const target of targetFrames) {
    const srgb = evaluateFitModel(targetFrames, model, target.frame);
    const hex = rgbToHex(srgb);
    const error = Math.sqrt(
      (target.srgb.r - srgb.r) ** 2 +
      (target.srgb.g - srgb.g) ** 2 +
      (target.srgb.b - srgb.b) ** 2
    );
    frames.push({
      frame: target.frame,
      targetHex: target.hex,
      fitHex: hex,
      targetSrgb: target.srgb,
      fitSrgb: srgb,
      error: Number(error.toFixed(4))
    });
  }
  return frames;
}

function evaluateFitModel(targetFrames: QuantizedFrame[], model: FitModel, frame: number): RgbColor {
  if (model.method === "piecewise-quadratic" || model.method === "adaptive-quadratic") {
    return evaluatePiecewiseQuadratic(model, frame);
  }
  if (model.method === "adaptive-linear") {
    return evaluateAdaptiveLinear(targetFrames, model, frame);
  }
  return evaluatePiecewiseQuadratic(model as QuadraticFitModel, frame);
}

function evaluatePiecewiseQuadratic(model: QuadraticFitModel, frame: number): RgbColor {
  const segment = findSegment(model.curves, frame);
  const span = segment.endFrame - segment.startFrame;
  const t = span === 0 ? 0 : (frame - segment.startFrame) / span;
  return {
    r: clampByte(quadraticValue(segment.curves.r, t)),
    g: clampByte(quadraticValue(segment.curves.g, t)),
    b: clampByte(quadraticValue(segment.curves.b, t))
  };
}

function evaluateAdaptiveLinear(targetFrames: QuantizedFrame[], model: LinearFitModel, frame: number): RgbColor {
  const knots = model.knots;
  let index = 0;
  while (index < knots.length - 2 && frame > knots[index + 1]) {
    index += 1;
  }
  const startFrame = knots[index];
  const endFrame = knots[index + 1];
  const span = endFrame - startFrame;
  const t = span === 0 ? 0 : (frame - startFrame) / span;
  return {
    r: clampByte(lerp(targetFrames[startFrame].srgb.r, targetFrames[endFrame].srgb.r, t)),
    g: clampByte(lerp(targetFrames[startFrame].srgb.g, targetFrames[endFrame].srgb.g, t)),
    b: clampByte(lerp(targetFrames[startFrame].srgb.b, targetFrames[endFrame].srgb.b, t))
  };
}

function findSegment(segments: QuadraticSegment[], frame: number): QuadraticSegment {
  return segments.find((segment) => frame >= segment.startFrame && frame <= segment.endFrame) || segments[segments.length - 1];
}

function calculateFitMetrics(targetFrames: QuantizedFrame[], fitFrames: FitFrame[]): FitMetrics {
  let sumChannelSquared = 0;
  let sumRgbSquared = 0;
  let maxRgbDistance = 0;
  let maxChannelError = 0;
  for (let index = 0; index < targetFrames.length; index += 1) {
    let rgbSquared = 0;
    for (const channel of RGB_CHANNELS) {
      const key = channel.key;
      const error = targetFrames[index].srgb[key] - fitFrames[index].fitSrgb[key];
      const squared = error * error;
      sumChannelSquared += squared;
      rgbSquared += squared;
      maxChannelError = Math.max(maxChannelError, Math.abs(error));
    }
    sumRgbSquared += rgbSquared;
    maxRgbDistance = Math.max(maxRgbDistance, Math.sqrt(rgbSquared));
  }
  return {
    rmseChannel: Math.sqrt(sumChannelSquared / (targetFrames.length * RGB_CHANNELS.length)),
    rmseRgbDistance: Math.sqrt(sumRgbSquared / targetFrames.length),
    maxRgbDistance,
    maxChannelError
  };
}

function renderOutputs(): void {
  renderGradientPreview();
  renderJson();
  renderMetrics();
  renderTable();
  drawComponentGraph();
}

function renderGradientPreview(): void {
  const lastFrame = Math.max(1, state.quantized.length - 1);
  const stops = state.quantized.map((item) => {
    const position = (item.frame / lastFrame) * 100;
    return `${item.hex} ${position.toFixed(3)}%`;
  });
  const first = state.quantized[0];
  const last = state.quantized[state.quantized.length - 1];

  elements.gradientPreview.style.backgroundImage = `linear-gradient(90deg, ${stops.join(", ")})`;
  elements.gradientPreview.setAttribute(
    "aria-label",
    `量子化された${state.quantized.length}フレームのグラデーション。開始色 ${first?.hex ?? ""}、終了色 ${last?.hex ?? ""}。`
  );
  updateGradientGuide();
}

function renderJson(): void {
  const fitModel = requireFitModel();
  const fitMetrics = requireFitMetrics();
  elements.quantizedJson.value = JSON.stringify(state.quantized, null, 2);
  elements.fitJson.value = JSON.stringify({
    method: fitModel.method,
    segments: fitModel.segments || 1,
    knots: fitModel.knots,
    model: fitModel,
    metrics: formatMetrics(fitMetrics),
    frames: state.fit
  }, null, 2);
}

function renderMetrics(): void {
  const fitModel = requireFitModel();
  const metrics = formatMetrics(requireFitMetrics());
  const entries = [
    ["Method", fitModel.method],
    ["Segments", String(fitModel.segments || 1)],
    ["RMSE/channel", metrics.rmseChannel],
    ["Max RGB distance", metrics.maxRgbDistance],
    ["RGB distance RMSE", metrics.rmseRgbDistance],
    ["Max channel error", metrics.maxChannelError]
  ];
  elements.fitMetrics.replaceChildren();
  for (const [label, value] of entries) {
    const item = document.createElement("div");
    const term = document.createElement("dt");
    const detail = document.createElement("dd");
    item.className = "metric-item";
    term.className = "metric-label";
    detail.className = "metric-value";
    term.textContent = label;
    detail.textContent = value;
    item.append(term, detail);
    elements.fitMetrics.append(item);
  }
}

function formatMetrics(metrics: FitMetrics): Record<keyof FitMetrics, string> {
  return {
    rmseChannel: metrics.rmseChannel.toFixed(4),
    rmseRgbDistance: metrics.rmseRgbDistance.toFixed(4),
    maxRgbDistance: metrics.maxRgbDistance.toFixed(4),
    maxChannelError: String(metrics.maxChannelError)
  };
}

function requireFitModel(): FitModel {
  if (!state.fitModel) {
    throw new Error("Fit model has not been calculated.");
  }
  return state.fitModel;
}

function requireFitMetrics(): FitMetrics {
  if (!state.fitMetrics) {
    throw new Error("Fit metrics have not been calculated.");
  }
  return state.fitMetrics;
}

function renderTable(): void {
  elements.frameTableBody.replaceChildren();
  const fragment = document.createDocumentFragment();

  for (const item of state.quantized) {
    const row = document.createElement("tr");
    const frame = document.createElement("td");
    const color = document.createElement("td");
    const srgb = document.createElement("td");
    const hex = document.createElement("td");
    const swatch = document.createElement("canvas");

    frame.textContent = String(item.frame);
    swatch.className = "color-swatch";
    swatch.width = 30;
    swatch.height = 22;
    swatch.setAttribute("role", "img");
    swatch.setAttribute("aria-label", item.hex);
    drawSwatch(swatch, item.hex);
    color.append(swatch);
    srgb.textContent = `rgb(${item.srgb.r}, ${item.srgb.g}, ${item.srgb.b})`;
    hex.textContent = item.hex;
    row.append(frame, color, srgb, hex);
    fragment.append(row);
  }

  elements.frameTableBody.append(fragment);
}

function drawSwatch(canvas: HTMLCanvasElement, color: string): void {
  const context = getCanvasContext(canvas);
  context.fillStyle = color;
  context.fillRect(0, 0, canvas.width, canvas.height);
}

function getCanvasContext(canvas: HTMLCanvasElement): CanvasRenderingContext2D {
  const context = canvas.getContext("2d");
  if (!context) {
    throw new Error("2D canvas context is unavailable.");
  }
  return context;
}

function drawComponentGraph(): void {
  const canvas = elements.componentGraph;
  const context = getCanvasContext(canvas);
  const fitModel = requireFitModel();
  const rect = canvas.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(640, Math.round(rect.width * dpr));
  const height = Math.max(300, Math.round(rect.height * dpr));
  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }

  context.clearRect(0, 0, width, height);
  const padding: GraphPadding = { left: 48 * dpr, right: 20 * dpr, top: 20 * dpr, bottom: 36 * dpr };
  elements.gradientPreview.style.setProperty("--graph-axis-left", `${padding.left / dpr}px`);
  elements.gradientPreview.style.setProperty("--graph-axis-right", `${padding.right / dpr}px`);
  const plotWidth = width - padding.left - padding.right;
  const plotHeight = height - padding.top - padding.bottom;
  const xForFrame = (frame: number): number => padding.left + (frame / Math.max(1, state.frameCount - 1)) * plotWidth;
  const yForValue = (value: number): number => padding.top + (1 - value / 255) * plotHeight;

  context.fillStyle = "#fbfbf8";
  context.fillRect(0, 0, width, height);
  drawGrid(context, width, height, padding, plotWidth, plotHeight, dpr);
  drawKnots(context, fitModel.knots, padding, plotHeight, xForFrame, dpr);

  for (const channel of RGB_CHANNELS) {
    drawSeries(context, state.quantized, (item) => item.srgb[channel.key], channel.color, false, xForFrame, yForValue, dpr);
    drawSeries(context, state.fit, (item) => item.fitSrgb[channel.key], channel.color, true, xForFrame, yForValue, dpr);
  }

  drawLegend(context, width, padding, dpr);

  if (state.activeFrame !== null && state.quantized[state.activeFrame]) {
    const x = xForFrame(state.activeFrame);
    context.save();
    context.strokeStyle = "#22252a";
    context.lineWidth = dpr;
    context.setLineDash([4 * dpr, 4 * dpr]);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, height - padding.bottom);
    context.stroke();
    context.restore();
  }
}

function drawKnots(
  context: CanvasRenderingContext2D,
  knots: number[],
  padding: GraphPadding,
  plotHeight: number,
  xForFrame: (frame: number) => number,
  dpr: number
): void {
  context.save();
  context.strokeStyle = "rgba(32, 33, 36, 0.38)";
  context.lineWidth = dpr;
  context.setLineDash([2 * dpr, 6 * dpr]);
  for (const knot of knots) {
    const x = xForFrame(knot);
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, padding.top + plotHeight);
    context.stroke();
  }
  context.restore();
}

function drawGrid(
  context: CanvasRenderingContext2D,
  width: number,
  height: number,
  padding: GraphPadding,
  plotWidth: number,
  plotHeight: number,
  dpr: number
): void {
  context.save();
  context.strokeStyle = "#dedfd9";
  context.lineWidth = dpr;
  context.fillStyle = "#686a70";
  context.font = `${12 * dpr}px ui-sans-serif, system-ui`;
  context.textAlign = "right";
  context.textBaseline = "middle";

  for (let i = 0; i <= 5; i += 1) {
    const value = i * 51;
    const y = padding.top + (1 - value / 255) * plotHeight;
    context.beginPath();
    context.moveTo(padding.left, y);
    context.lineTo(width - padding.right, y);
    context.stroke();
    context.fillText(String(value), padding.left - 8 * dpr, y);
  }

  context.textAlign = "center";
  context.textBaseline = "top";
  for (let i = 0; i <= 4; i += 1) {
    const ratio = i / 4;
    const x = padding.left + ratio * plotWidth;
    const frame = Math.round(ratio * Math.max(0, state.frameCount - 1));
    context.beginPath();
    context.moveTo(x, padding.top);
    context.lineTo(x, height - padding.bottom);
    context.stroke();
    context.fillText(String(frame), x, height - padding.bottom + 10 * dpr);
  }
  context.restore();
}

function drawSeries<T extends { frame: number }>(
  context: CanvasRenderingContext2D,
  frames: T[],
  valueGetter: (item: T) => number,
  color: string,
  dashed: boolean,
  xForFrame: (frame: number) => number,
  yForValue: (value: number) => number,
  dpr: number
): void {
  context.save();
  context.strokeStyle = color;
  context.lineWidth = dashed ? 2 * dpr : 2.7 * dpr;
  context.setLineDash(dashed ? [7 * dpr, 5 * dpr] : []);
  context.beginPath();
  frames.forEach((item, index) => {
    const x = xForFrame(item.frame);
    const y = yForValue(valueGetter(item));
    if (index === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  });
  context.stroke();
  context.restore();
}

function drawLegend(context: CanvasRenderingContext2D, width: number, padding: GraphPadding, dpr: number): void {
  context.save();
  context.font = `${12 * dpr}px ui-sans-serif, system-ui`;
  context.textBaseline = "middle";
  let x = padding.left;
  const y = padding.top - 8 * dpr;
  for (const channel of RGB_CHANNELS) {
    context.strokeStyle = channel.color;
    context.lineWidth = 3 * dpr;
    context.setLineDash([]);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 20 * dpr, y);
    context.stroke();
    context.fillStyle = "#202124";
    context.fillText(`${channel.label} target`, x + 26 * dpr, y);
    x += 86 * dpr;
    context.setLineDash([7 * dpr, 5 * dpr]);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x + 20 * dpr, y);
    context.stroke();
    context.setLineDash([]);
    context.fillText(`${channel.label} fit`, x + 26 * dpr, y);
    x += 62 * dpr;
    if (x > width - padding.right - 120 * dpr) break;
  }
  context.restore();
}

function handleGraphPointer(event: PointerEvent): void {
  const rect = elements.componentGraph.getBoundingClientRect();
  setActiveFrameFromPointer(event.clientX, rect);
}

function handleGradientPointer(event: PointerEvent): void {
  const rect = elements.gradientPreview.getBoundingClientRect();
  setActiveFrameFromPointer(event.clientX, rect);
}

function setActiveFrameFromPointer(clientX: number, rect: DOMRect): void {
  const ratio = clamp((clientX - rect.left) / rect.width, 0, 1);
  const frame = Math.round(ratio * (state.frameCount - 1));
  state.activeFrame = frame;
  const target = state.quantized[frame];
  const fit = state.fit[frame];
  if (target && fit) {
    elements.frameReadout.textContent =
      `Frame ${frame}: target ${target.hex} rgb(${target.srgb.r}, ${target.srgb.g}, ${target.srgb.b}) / ` +
      `fit ${fit.fitHex} rgb(${fit.fitSrgb.r}, ${fit.fitSrgb.g}, ${fit.fitSrgb.b}) / error ${fit.error}`;
  }
  updateGradientGuide();
  drawComponentGraph();
}

function clearActiveFrame(): void {
  state.activeFrame = null;
  elements.frameReadout.textContent = "グラフまたはグラデーション上にポインターを置くとフレームの値を表示します。";
  updateGradientGuide();
  drawComponentGraph();
}

function updateGradientGuide(): void {
  const frame = state.activeFrame;
  const isActive = frame !== null && Boolean(state.quantized[frame]);
  const position = isActive ? (frame / Math.max(1, state.frameCount - 1)) * 100 : 0;
  elements.gradientPreview.style.setProperty("--gradient-guide-position", `${position}%`);
  elements.gradientPreview.classList.toggle("has-active-frame", isActive);
}

async function copyText(text: string, button: HTMLButtonElement): Promise<void> {
  const original = button.textContent;
  try {
    await navigator.clipboard.writeText(text);
    button.textContent = "コピー済み";
    button.classList.add("copy-status");
  } catch (error) {
    button.textContent = "コピー失敗";
    button.classList.add("error-text");
  }
  window.setTimeout(() => {
    button.textContent = original;
    button.classList.remove("copy-status", "error-text");
  }, 1400);
}

function createLinearCurve(): CubicCurve {
  return {
    p1: { x: 1 / 3, y: 1 / 3 },
    p2: { x: 2 / 3, y: 2 / 3 }
  };
}

function bezierYForX(curve: CubicCurve, x: number): number {
  let low = 0;
  let high = 1;
  for (let i = 0; i < 24; i += 1) {
    const mid = (low + high) / 2;
    if (bezierPoint(curve, mid).x < x) low = mid;
    else high = mid;
  }
  return bezierPoint(curve, (low + high) / 2).y;
}

function bezierPoint(curve: CubicCurve, t: number): Point {
  const mt = 1 - t;
  const c1 = 3 * mt * mt * t;
  const c2 = 3 * mt * t * t;
  const c3 = t * t * t;
  return {
    x: c1 * curve.p1.x + c2 * curve.p2.x + c3,
    y: c1 * curve.p1.y + c2 * curve.p2.y + c3
  };
}

function quadraticValue(curve: QuadraticCurve, t: number): number {
  const mt = 1 - t;
  return mt * mt * curve.p0 + 2 * mt * t * curve.p1 + t * t * curve.p2;
}

function pointerToCurvePoint(svg: SVGSVGElement, event: PointerEvent): Point {
  const rect = svg.getBoundingClientRect();
  const padding = 28;
  const width = rect.width;
  const height = rect.height;
  const plotWidth = width - padding * 2 * (width / 320);
  const plotHeight = height - padding * 2 * (height / 220);
  const padX = padding * (width / 320);
  const padY = padding * (height / 220);
  return {
    x: (event.clientX - rect.left - padX) / plotWidth,
    y: 1 - (event.clientY - rect.top - padY) / plotHeight
  };
}

function createSvgElement<K extends keyof SVGElementTagNameMap>(name: K): SVGElementTagNameMap[K] {
  return document.createElementNS("http://www.w3.org/2000/svg", name);
}

function createLine(x1: number, y1: number, x2: number, y2: number, className: string): SVGLineElement {
  const line = createSvgElement("line");
  line.classList.add(className);
  line.setAttribute("x1", String(x1));
  line.setAttribute("y1", String(y1));
  line.setAttribute("x2", String(x2));
  line.setAttribute("y2", String(y2));
  return line;
}

function createCircle(cx: number, cy: number, radius: number, className: string): SVGCircleElement {
  const circle = createSvgElement("circle");
  circle.classList.add(className);
  circle.setAttribute("cx", String(cx));
  circle.setAttribute("cy", String(cy));
  circle.setAttribute("r", String(radius));
  return circle;
}

function hslToRgb({ h, s, l }: HslColor): RgbColor {
  const hue = normalizeHue(h) / 360;
  const sat = clamp(s, 0, 100) / 100;
  const light = clamp(l, 0, 100) / 100;
  let r;
  let g;
  let b;

  if (sat === 0) {
    r = light;
    g = light;
    b = light;
  } else {
    const q = light < 0.5 ? light * (1 + sat) : light + sat - light * sat;
    const p = 2 * light - q;
    r = hueToRgb(p, q, hue + 1 / 3);
    g = hueToRgb(p, q, hue);
    b = hueToRgb(p, q, hue - 1 / 3);
  }

  return {
    r: clampByte(r * 255),
    g: clampByte(g * 255),
    b: clampByte(b * 255)
  };
}

function hueToRgb(p: number, q: number, t: number): number {
  let value = t;
  if (value < 0) value += 1;
  if (value > 1) value -= 1;
  if (value < 1 / 6) return p + (q - p) * 6 * value;
  if (value < 1 / 2) return q;
  if (value < 2 / 3) return p + (q - p) * (2 / 3 - value) * 6;
  return p;
}

function rgbToHsl({ r, g, b }: RgbColor): HslColor {
  const red = r / 255;
  const green = g / 255;
  const blue = b / 255;
  const max = Math.max(red, green, blue);
  const min = Math.min(red, green, blue);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;

  if (max !== min) {
    const delta = max - min;
    s = l > 0.5 ? delta / (2 - max - min) : delta / (max + min);
    if (max === red) h = (green - blue) / delta + (green < blue ? 6 : 0);
    else if (max === green) h = (blue - red) / delta + 2;
    else h = (red - green) / delta + 4;
    h *= 60;
  }

  return {
    h: Math.round(normalizeHue(h)),
    s: Math.round(s * 100),
    l: Math.round(l * 100)
  };
}

function hexToRgb(hex: string): RgbColor {
  const normalized = hex.replace("#", "");
  return {
    r: parseInt(normalized.slice(0, 2), 16),
    g: parseInt(normalized.slice(2, 4), 16),
    b: parseInt(normalized.slice(4, 6), 16)
  };
}

function rgbToHex({ r, g, b }: RgbColor): string {
  return `#${[r, g, b].map((value) => clampByte(value).toString(16).padStart(2, "0")).join("")}`;
}

function hueDeltaShortest(start: number, end: number): number {
  return ((end - start + 540) % 360) - 180;
}

function normalizeHue(value: number): number {
  return ((value % 360) + 360) % 360;
}

function lerp(start: number, end: number, amount: number): number {
  return start + (end - start) * amount;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function clampByte(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function squaredDistance(a: Point, b: Point): number {
  return (a.x - b.x) ** 2 + (a.y - b.y) ** 2;
}
