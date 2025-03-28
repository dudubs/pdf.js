/* Copyright 2021 Mozilla Foundation
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

import { MathClamp, shadow } from "../../shared/util.js";

const dimConverters = {
  pt: x => x,
  cm: x => (x / 2.54) * 72,
  mm: x => (x / (10 * 2.54)) * 72,
  in: x => x * 72,
  px: x => x,
};
const measurementPattern = /([+-]?\d+\.?\d*)(.*)/;

function stripQuotes(str) {
  if (str.startsWith("'") || str.startsWith('"')) {
    return str.slice(1, -1);
  }
  return str;
}

function getInteger({ data, defaultValue, validate }) {
  if (!data) {
    return defaultValue;
  }
  data = data.trim();
  const n = parseInt(data, 10);
  if (!isNaN(n) && validate(n)) {
    return n;
  }
  return defaultValue;
}

function getFloat({ data, defaultValue, validate }) {
  if (!data) {
    return defaultValue;
  }
  data = data.trim();
  const n = parseFloat(data);
  if (!isNaN(n) && validate(n)) {
    return n;
  }
  return defaultValue;
}

function getKeyword({ data, defaultValue, validate }) {
  if (!data) {
    return defaultValue;
  }
  data = data.trim();
  if (validate(data)) {
    return data;
  }
  return defaultValue;
}

function getStringOption(data, options) {
  return getKeyword({
    data,
    defaultValue: options[0],
    validate: k => options.includes(k),
  });
}

function getMeasurement(str, def = "0") {
  def ||= "0";
  if (!str) {
    return getMeasurement(def);
  }
  const match = str.trim().match(measurementPattern);
  if (!match) {
    return getMeasurement(def);
  }
  const [, valueStr, unit] = match;
  const value = parseFloat(valueStr);
  if (isNaN(value)) {
    return getMeasurement(def);
  }

  if (value === 0) {
    return 0;
  }

  const conv = dimConverters[unit];
  if (conv) {
    return conv(value);
  }

  return value;
}

function getRatio(data) {
  if (!data) {
    return { num: 1, den: 1 };
  }
  const ratio = data
    .split(":", 2)
    .map(x => parseFloat(x.trim()))
    .filter(x => !isNaN(x));
  if (ratio.length === 1) {
    ratio.push(1);
  }

  if (ratio.length === 0) {
    return { num: 1, den: 1 };
  }

  const [num, den] = ratio;
  return { num, den };
}

function getRelevant(data) {
  if (!data) {
    return [];
  }
  return data
    .trim()
    .split(/\s+/)
    .map(e => ({
      excluded: e[0] === "-",
      viewname: e.substring(1),
    }));
}

function getColor(data, def = [0, 0, 0]) {
  let [r, g, b] = def;
  if (!data) {
    return { r, g, b };
  }
  const color = data
    .split(",", 3)
    .map(c => MathClamp(parseInt(c.trim(), 10), 0, 255))
    .map(c => (isNaN(c) ? 0 : c));

  if (color.length < 3) {
    return { r, g, b };
  }

  [r, g, b] = color;
  return { r, g, b };
}

function getBBox(data) {
  const def = -1;
  if (!data) {
    return { x: def, y: def, width: def, height: def };
  }
  const bbox = data.split(",", 4).map(m => getMeasurement(m.trim(), "-1"));

  if (bbox.length < 4 || bbox[2] < 0 || bbox[3] < 0) {
    return { x: def, y: def, width: def, height: def };
  }

  const [x, y, width, height] = bbox;
  return { x, y, width, height };
}

class HTMLResult {
  static get FAILURE() {
    return shadow(this, "FAILURE", new HTMLResult(false, null, null, null));
  }

  static get EMPTY() {
    return shadow(this, "EMPTY", new HTMLResult(true, null, null, null));
  }

  constructor(success, html, bbox, breakNode) {
    this.success = success;
    this.html = html;
    this.bbox = bbox;
    this.breakNode = breakNode;
  }

  isBreak() {
    return !!this.breakNode;
  }

  static breakNode(node) {
    return new HTMLResult(false, null, null, node);
  }

  static success(html, bbox = null) {
    return new HTMLResult(true, html, bbox, null);
  }
}

export {
  getBBox,
  getColor,
  getFloat,
  getInteger,
  getKeyword,
  getMeasurement,
  getRatio,
  getRelevant,
  getStringOption,
  HTMLResult,
  stripQuotes,
};
