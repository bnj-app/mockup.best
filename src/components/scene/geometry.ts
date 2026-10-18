import * as THREE from 'three';

/** Centered rounded-rectangle profile. */
function roundedRectShape(width: number, height: number, radius: number): THREE.Shape {
  const w = width;
  const h = height;
  const r = Math.max(0.0001, Math.min(radius, Math.min(w, h) / 2 - 0.0001));
  const x = -w / 2;
  const y = -h / 2;

  const s = new THREE.Shape();
  s.moveTo(x + r, y);
  s.lineTo(x + w - r, y);
  s.quadraticCurveTo(x + w, y, x + w, y + r);
  s.lineTo(x + w, y + h - r);
  s.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  s.lineTo(x + r, y + h);
  s.quadraticCurveTo(x, y + h, x, y + h - r);
  s.lineTo(x, y + r);
  s.quadraticCurveTo(x, y, x + r, y);
  return s;
}

/**
 * Screen surface: a plane with rounded corners.
 * A plain `planeGeometry` leaves sharp corners protruding beyond the rounded body. Use a surface
 * cut to the same radius.
 * `ShapeGeometry` derives UVs from shape coordinates without normalizing to 0–1, shifting the
 * texture unless UVs are recalculated manually.
 */
export function roundedScreenGeometry(
  width: number,
  height: number,
  radius: number,
): THREE.ShapeGeometry {
  const geo = new THREE.ShapeGeometry(roundedRectShape(width, height, radius), 24);

  const pos = geo.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i += 1) {
    uv[i * 2] = (pos.getX(i) + width / 2) / width;
    uv[i * 2 + 1] = (pos.getY(i) + height / 2) / height;
  }
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

/**
 * THIN rounded ring: the edge of the screen glass.
 * The hairline highlight where glass meets the black bezel is a small detail that makes the
 * result feel like a product photo. The outer contour is the given rectangle; inset the inner
 * contour by `thickness`, using Shape + hole in one mesh.
 */
export function roundedRingGeometry(
  width: number,
  height: number,
  radius: number,
  thickness: number,
): THREE.ShapeGeometry {
  const outer = roundedRectShape(width, height, radius);
  const inner = roundedRectShape(
    Math.max(0.1, width - 2 * thickness),
    Math.max(0.1, height - 2 * thickness),
    Math.max(0.0001, radius - thickness),
  );
  /* The hole must wind in the opposite direction; copy the shape's Path points and reverse them. */
  const hole = new THREE.Path(inner.getPoints(48).reverse());
  outer.holes.push(hole);
  return new THREE.ShapeGeometry(outer, 24);
}

/**
 * Rounded, beveled slab.
 * Why `RoundedBox` is insufficient: its radius is limited to half the shortest edge. Thin glass
 * clamps the corner radius below a millimeter, removing rounded corners and reflective edge
 * surfaces, losing the glass appearance.
 * Here corner radius is independent of thickness. Front and back bevels catch light to create the
 * thin, long edge highlights seen in product renders.
 */
export function roundedPlateGeometry(
  width: number,
  height: number,
  cornerRadius: number,
  depth: number,
  bevel: number,
): THREE.ExtrudeGeometry {
  const w = width - bevel * 2;
  const h = height - bevel * 2;
  const r = Math.max(0.001, Math.min(cornerRadius - bevel, Math.min(w, h) / 2 - 0.001));

  const geo = new THREE.ExtrudeGeometry(roundedRectShape(w, h, r), {
    depth: Math.max(0.0001, depth - bevel * 2),
    bevelEnabled: true,
    bevelThickness: bevel,
    bevelSize: bevel,
    bevelOffset: 0,
    bevelSegments: 8,
    curveSegments: 32,
  });

  geo.center();
  geo.computeVertexNormals();
  return geo;
}
