/* Copyright 2025
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

/**
 * Geometry used by the ink eraser (local addition to the upstream sources).
 *
 * A stroke is a flat polyline `[x0, y0, x1, y1, ...]`. Erasing removes the part
 * of the stroke that lies inside a disk, splitting the stroke in several ones
 * when the disk cuts it in the middle. Cuts are computed exactly on the
 * segments (no sampling), so the new ends lie on the circle.
 */

/**
 * Parameters t in [0, 1] where the segment a + t * (b - a) crosses the circle
 * of center (cx, cy) and radius r, or null if the line doesn't cross it.
 * @returns {[number, number] | null} [tEnter, tExit] with tEnter <= tExit.
 */
function circleSegmentIntersection(ax, ay, bx, by, cx, cy, r) {
  const dx = bx - ax;
  const dy = by - ay;
  const fx = ax - cx;
  const fy = ay - cy;
  const a = dx * dx + dy * dy;
  if (a === 0) {
    return null;
  }
  const b = 2 * (fx * dx + fy * dy);
  const c = fx * fx + fy * fy - r * r;
  const disc = b * b - 4 * a * c;
  if (disc <= 0) {
    return null;
  }
  const sqrt = Math.sqrt(disc);
  return [(-b - sqrt) / (2 * a), (-b + sqrt) / (2 * a)];
}

/**
 * Remove from a polyline the parts inside the given disk.
 * @param {Float32Array|Array<number>} points - Flat polyline.
 * @param {number} cx
 * @param {number} cy
 * @param {number} r
 * @returns {Array<Float32Array> | null} The remaining strokes (possibly none),
 *   or null if the disk doesn't touch the polyline (nothing changed).
 */
function erasePolyline(points, cx, cy, r) {
  const len = points.length;
  const r2 = r * r;
  const inside = (x, y) => (x - cx) ** 2 + (y - cy) ** 2 < r2;

  if (len === 2) {
    // A dot.
    return inside(points[0], points[1]) ? [] : null;
  }

  const result = [];
  let current = null;
  let changed = false;

  const flush = () => {
    // A stroke needs two distinct points to be drawable.
    if (current && current.length >= 4) {
      const n = current.length;
      if (current[0] !== current[n - 2] || current[1] !== current[n - 1]) {
        result.push(Float32Array.from(current));
      }
    }
    current = null;
  };

  let ax = points[0];
  let ay = points[1];
  let aInside = inside(ax, ay);
  if (aInside) {
    changed = true;
  } else {
    current = [ax, ay];
  }

  for (let i = 2; i < len; i += 2) {
    const bx = points[i];
    const by = points[i + 1];
    const bInside = inside(bx, by);

    if (aInside && bInside) {
      // Entirely erased.
    } else if (!aInside && !bInside) {
      const hit = circleSegmentIntersection(ax, ay, bx, by, cx, cy, r);
      if (hit && hit[0] > 0 && hit[1] < 1) {
        // The disk cuts the segment in the middle.
        changed = true;
        const [t1, t2] = hit;
        current.push(ax + (bx - ax) * t1, ay + (by - ay) * t1);
        flush();
        current = [ax + (bx - ax) * t2, ay + (by - ay) * t2, bx, by];
      } else {
        current.push(bx, by);
      }
    } else if (!aInside && bInside) {
      changed = true;
      const hit = circleSegmentIntersection(ax, ay, bx, by, cx, cy, r);
      const t = hit ? Math.min(Math.max(hit[0], 0), 1) : 0;
      current.push(ax + (bx - ax) * t, ay + (by - ay) * t);
      flush();
    } else {
      // aInside && !bInside: leaving the disk.
      changed = true;
      const hit = circleSegmentIntersection(ax, ay, bx, by, cx, cy, r);
      const t = hit ? Math.min(Math.max(hit[1], 0), 1) : 1;
      current = [ax + (bx - ax) * t, ay + (by - ay) * t, bx, by];
    }

    ax = bx;
    ay = by;
    aInside = bInside;
  }
  flush();

  return changed ? result : null;
}

/**
 * Erase a disk from several strokes.
 * @param {Array<Float32Array>} strokes
 * @returns {Array<Float32Array> | null} The new strokes, or null if nothing
 *   has been erased.
 */
function eraseStrokes(strokes, cx, cy, r) {
  let out = null;
  for (let i = 0, ii = strokes.length; i < ii; i++) {
    const res = erasePolyline(strokes[i], cx, cy, r);
    if (res === null) {
      out?.push(strokes[i]);
      continue;
    }
    out ||= strokes.slice(0, i);
    out.push(...res);
  }
  return out;
}

/**
 * Whether a polyline passes within r of (cx, cy).
 */
function polylineTouchesDisk(points, cx, cy, r) {
  const r2 = r * r;
  const len = points.length;
  if (len === 2) {
    return (points[0] - cx) ** 2 + (points[1] - cy) ** 2 < r2;
  }
  for (let i = 0; i + 3 < len; i += 2) {
    const ax = points[i];
    const ay = points[i + 1];
    const dx = points[i + 2] - ax;
    const dy = points[i + 3] - ay;
    const l2 = dx * dx + dy * dy;
    const t = l2 === 0 ? 0 : Math.min(1, Math.max(0, ((cx - ax) * dx + (cy - ay) * dy) / l2));
    if ((ax + t * dx - cx) ** 2 + (ay + t * dy - cy) ** 2 < r2) {
      return true;
    }
  }
  return false;
}

/**
 * Remove every whole stroke touched by the disk.
 * @param {Array<Float32Array>} strokes
 * @returns {Array<Float32Array> | null} The remaining strokes, or null if
 *   no stroke is touched.
 */
function removeTouchedStrokes(strokes, cx, cy, r) {
  const kept = strokes.filter(stroke => !polylineTouchesDisk(stroke, cx, cy, r));
  return kept.length === strokes.length ? null : kept;
}

export { eraseStrokes, erasePolyline, removeTouchedStrokes };
