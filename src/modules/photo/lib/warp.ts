/**
 * Draw an image into a quad with correct perspective. Why WebGL: 2D canvas `setTransform` is affine;
 * unequal opposite edges shift content and bend straight lines. Splitting into affine triangles still
 * ignores texture depth (the classic "PS1 texture" issue) and adds seams. Find the diagonal
 * intersection, derive each corner's q (homogeneous w), pass (u*q, v*q, q), and divide xy/z in the
 * shader. One seamless quad with exact perspective.
 */

export type P = { x: number; y: number };

function diagIntersect(p0: P, p1: P, p2: P, p3: P): P | null {
  const a1 = p2.y - p0.y, b1 = p0.x - p2.x;
  const c1 = a1 * p0.x + b1 * p0.y;
  const a2 = p3.y - p1.y, b2 = p1.x - p3.x;
  const c2 = a2 * p1.x + b2 * p1.y;
  const det = a1 * b2 - a2 * b1;
  if (Math.abs(det) < 1e-9) return null;
  return { x: (b2 * c1 - b1 * c2) / det, y: (a1 * c2 - a2 * c1) / det };
}

const VERT = `
attribute vec2 aPos;
attribute vec3 aUV;
varying vec3 vUV;
uniform vec2 uRes;
void main() {
  vUV = aUV;
  vec2 clip = (aPos / uRes) * 2.0 - 1.0;
  gl_Position = vec4(clip.x, -clip.y, 0.0, 1.0);
}`;

const FRAG = `
precision highp float;
varying vec3 vUV;
uniform sampler2D uTex;
void main() {
  vec2 uv = vUV.xy / vUV.z;
  if (uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  gl_FragColor = texture2D(uTex, uv);
}`;

function compile(gl: WebGLRenderingContext, type: number, src: string) {
  const s = gl.createShader(type)!;
  gl.shaderSource(s, src);
  gl.compileShader(s);
  if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) {
    throw new Error('shader: ' + gl.getShaderInfoLog(s));
  }
  return s;
}

/**
 * Share one context across calls. Creating a new `<canvas>` and `getContext('webgl')` per video frame
 * produces ~120 contexts in a 4-second export. Browsers allow ~16; after that `getContext` returns
 * `null`, warp throws, and export fails midway. Initialize the context, program, buffers, and texture
 * once at module scope; upload only data per frame. Reinitialize if `isContextLost`.
 */
type WarpCtx = {
  cv: HTMLCanvasElement;
  gl: WebGLRenderingContext;
  prog: WebGLProgram;
  buf: WebGLBuffer;
  tex: WebGLTexture;
  size: number;
};

let CTX: WarpCtx | null = null;

function warpCtx(size: number): WarpCtx {
  if (CTX && !CTX.gl.isContextLost()) {
    if (CTX.size !== size) {
      CTX.cv.width = size;
      CTX.cv.height = size;
      CTX.size = size;
    }
    return CTX;
  }

  const cv = document.createElement('canvas');
  cv.width = size;
  cv.height = size;
  const gl = cv.getContext('webgl', { premultipliedAlpha: false, antialias: true });
  if (!gl) throw new Error('WebGL yok');

  const prog = gl.createProgram()!;
  gl.attachShader(prog, compile(gl, gl.VERTEX_SHADER, VERT));
  gl.attachShader(prog, compile(gl, gl.FRAGMENT_SHADER, FRAG));
  gl.linkProgram(prog);

  const buf = gl.createBuffer()!;
  const tex = gl.createTexture()!;
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
  gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, 0);

  CTX = { cv, gl, prog, buf, tex, size };
  return CTX;
}

/**
 * Draw `source` into `quad01` on a transparent `size x size` canvas and return it. Note: the returned
 * canvas is shared and overwritten by the next call. Copy it immediately into the caller's canvas with
 * `drawImage`.
 */
export function warpToQuad(
  source: CanvasImageSource & { width?: number; height?: number },
  quad01: [P, P, P, P],
  size: number,
): HTMLCanvasElement {
  const { cv, gl, prog, buf, tex } = warpCtx(size);
  gl.useProgram(prog);

  const q = quad01.map((p) => ({ x: p.x * size, y: p.y * size })) as [P, P, P, P];
  const c = diagIntersect(q[0], q[1], q[2], q[3]);

  // Derive homogeneous w from diagonal distances; these four values encode the perspective.
  let qs = [1, 1, 1, 1];
  if (c) {
    const d = q.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
    if (d.every((v) => v > 1e-6)) {
      qs = [
        (d[0] + d[2]) / d[2],
        (d[1] + d[3]) / d[3],
        (d[2] + d[0]) / d[0],
        (d[3] + d[1]) / d[1],
      ];
    }
  }

  const uv = [
    [0, 0],
    [1, 0],
    [1, 1],
    [0, 1],
  ];
  const verts: number[] = [];
  for (const [a, b, cc] of [
    [0, 1, 2],
    [0, 2, 3],
  ]) {
    for (const i of [a, b, cc]) {
      verts.push(q[i].x, q[i].y, uv[i][0] * qs[i], uv[i][1] * qs[i], qs[i]);
    }
  }

  // The quad can change every frame, so use DYNAMIC_DRAW.
  gl.bindBuffer(gl.ARRAY_BUFFER, buf);
  gl.bufferData(gl.ARRAY_BUFFER, new Float32Array(verts), gl.DYNAMIC_DRAW);

  const aPos = gl.getAttribLocation(prog, 'aPos');
  const aUV = gl.getAttribLocation(prog, 'aUV');
  gl.enableVertexAttribArray(aPos);
  gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 20, 0);
  gl.enableVertexAttribArray(aUV);
  gl.vertexAttribPointer(aUV, 3, gl.FLOAT, false, 20, 8);

  gl.activeTexture(gl.TEXTURE0);
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, source as TexImageSource);

  gl.uniform2f(gl.getUniformLocation(prog, 'uRes'), size, size);
  gl.uniform1i(gl.getUniformLocation(prog, 'uTex'), 0);

  gl.viewport(0, 0, size, size);
  gl.clearColor(0, 0, 0, 0);
  gl.clear(gl.COLOR_BUFFER_BIT);
  gl.drawArrays(gl.TRIANGLES, 0, 6);

  return cv;
}
