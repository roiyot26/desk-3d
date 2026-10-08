// GLSL for the rain. Written for this project; hashes are Dave Hoskins' "Hash without Sine" (MIT).

const HASH = /* glsl */ `
float hash12(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * 0.1031);
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.x + p3.y) * p3.z);
}
vec2 hash22(vec2 p) {
  vec3 p3 = fract(vec3(p.xyx) * vec3(0.1031, 0.1030, 0.0973));
  p3 += dot(p3, p3.yzx + 33.33);
  return fract((p3.xx + p3.yz) * p3.zy);
}
`

export const glassVertex = /* glsl */ `
uniform vec3 uOrigin;
uniform vec3 uRight;
uniform vec3 uUp;
varying vec2 vPane;   // position on the pane in metres (x right, y up)
void main() {
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vec3 d = wp.xyz - uOrigin;
  vPane = vec2(dot(d, uRight), dot(d, uUp));
  gl_Position = projectionMatrix * viewMatrix * wp;
}
`

export const glassFragment = /* glsl */ `
uniform sampler2D uScene;   // what is behind the glass (city + rain), rendered from this camera
uniform vec2 uRes;          // drawing-buffer size of the pass the glass is drawn in
uniform float uTime;
uniform float uRain;        // 0..1 amount of water on the glass
uniform float uFog;         // 0..1 how misty the dry glass is
uniform float uLens;        // refraction strength of drops, in pixels
uniform vec3 uRoomTint;     // warm interior light caught by the glass and drop highlights
uniform vec2 uPaneSize;
varying vec2 vPane;
${HASH}

// Small static beads that appear, sit, and evaporate. x = lens height, y = how much they clear the mist.
vec2 beads(vec2 p, float cell, float t) {
  vec2 g = p / cell;
  vec2 id = floor(g);
  vec2 f = fract(g) - 0.5;
  vec2 r = hash22(id);
  float on = step(0.6, r.x);
  vec2 c = (hash22(id + 11.3) - 0.5) * 0.55;
  float rad = mix(0.10, 0.30, hash12(id + 7.1));
  float life = fract(t * mix(0.02, 0.06, r.y) + r.x * 3.7);
  float vis = smoothstep(0.0, 0.1, life) * (1.0 - smoothstep(0.75, 1.0, life)) * on;
  float d = length((f - c) * vec2(1.0, 0.85)) / rad;
  float h = sqrt(clamp(1.0 - d * d, 0.0, 1.0)) * vis;
  return vec2(h, (1.0 - smoothstep(0.6, 1.0, d)) * vis);
}

float meander(float y, float seed) {
  return 0.22 * sin(y * 9.0 + seed * 6.283) + 0.08 * sin(y * 23.0 + seed * 17.0);
}

// Running drops: one drop per column cell, stick-slip slide with a trail of beads that clears the mist.
vec2 runners(vec2 p, float cw, float ch, float t, float seed) {
  float col = floor(p.x / cw);
  float rc = hash12(vec2(col, seed));
  float gy = p.y / ch + rc * 7.0;
  float row = floor(gy);
  float fy = fract(gy);                       // 0 = bottom of cell, 1 = top
  float rr = hash12(vec2(col, row) + seed);
  float alive = step(0.35, rr);
  float speed = mix(0.10, 0.22, rr);
  float ph = fract(t * speed + rr * 5.0);
  ph = ph + 0.045 * sin(ph * 6.2831 * 3.0);  // stick-slip: pauses then quick slides
  float yd = 0.95 - 0.9 * ph;                 // drop height in the cell
  float lx = p.x / cw - col - 0.5;            // -0.5..0.5 across the column
  float R = mix(0.0050, 0.0090, rr);          // drop radius in metres (a touch large so it reads on screen)
  // drop
  vec2 dd = vec2((lx - meander(yd, rr)) * cw, (fy - yd) * ch);
  dd.y *= dd.y > 0.0 ? 0.85 : 1.15;           // slightly heavier bottom
  float d = length(dd) / R;
  float h = sqrt(clamp(1.0 - d * d, 0.0, 1.0));
  // trail above the drop, fading with age (distance above it)
  float above = (fy - yd) * ch;
  float trailLen = mix(0.06, 0.16, rr);
  float onTrail = step(0.0, above) * (1.0 - smoothstep(0.0, trailLen, above));
  float tx = abs((lx - meander(fy, rr)) * cw);
  float w = R * mix(0.75, 0.35, clamp(above / trailLen, 0.0, 1.0));
  float trail = onTrail * (1.0 - smoothstep(w * 0.6, w, tx));
  // little beads left behind in the trail
  float seg = 0.016;
  float sy = above / seg;
  float bid = floor(sy);
  float bOn = step(0.45, hash12(vec2(col * 3.1 + bid, row + seed)));
  vec2 bd = vec2(tx, (fract(sy) - 0.5) * seg);
  float bR = R * mix(0.25, 0.45, hash12(vec2(bid, col)));
  float bdist = length(bd) / bR;
  float bh = sqrt(clamp(1.0 - bdist * bdist, 0.0, 1.0)) * bOn * onTrail * step(0.012, above);
  return vec2(max(h, bh) * alive, max(trail, max(1.0 - smoothstep(0.7, 1.0, d), 0.0) * step(d, 1.0)) * alive);
}

void main() {
  vec2 p = vPane;
  float t = uTime;
  vec2 b1 = beads(p, 0.016, t);
  vec2 b2 = beads(p + vec2(3.17, 1.3), 0.026, t * 0.8);
  vec2 r1 = runners(p, 0.06, 0.6, t, 1.0);
  vec2 r2 = runners(p + vec2(0.027, 0.0), 0.1, 0.9, t * 0.9, 2.0);

  float h = max(max(b1.x * 0.6, b2.x * 0.9), max(r1.x, r2.x)) * uRain;
  float clear = clamp(max(r1.y, r2.y) + max(b1.y, b2.y) * 0.5, 0.0, 1.0) * uRain;

  // surface slope from screen derivatives of the lens height
  vec2 n = vec2(dFdx(h), dFdy(h));
  vec2 suv = gl_FragCoord.xy / uRes;

  // misty glass is blurred via the mip chain; drops and trails are clear lenses
  float edge = smoothstep(0.0, 0.06, min(min(p.x, uPaneSize.x - p.x), min(p.y, uPaneSize.y - p.y)));
  float fog = uFog * (1.0 - clear) * mix(1.0, 0.75, edge);
  // fog thicker near the bottom of the pane (condensation pools there)
  fog = clamp(fog * mix(1.25, 0.85, clamp(p.y / max(uPaneSize.y, 0.001), 0.0, 1.0)), 0.0, 1.0);

  vec2 ruv = suv - n * uLens / uRes;   // drops invert and magnify what is behind them
  float lod = fog * 2.6;
  vec3 col = textureLod(uScene, ruv, lod).rgb;

  // mist scatters a little interior light; it lifts the glass rather than blacking it out
  col = mix(col, col * 0.75 + uRoomTint * 0.025, fog * 0.6);

  // drop shading: darker rim, small warm highlight from the room lamps
  float rim = smoothstep(0.0, 0.35, h) * (1.0 - smoothstep(0.35, 0.9, h));
  col *= (1.0 - 0.2 * rim) * (1.0 + 0.25 * step(0.02, h));   // drops gather a little light
  vec3 nn = normalize(vec3(-n * 2.5, 1.0));
  float spec = pow(max(dot(nn, normalize(vec3(-0.45, 0.55, 0.7))), 0.0), 60.0) * step(0.02, h);
  col += uRoomTint * spec * 0.12;

  // faint room reflection on the glass itself
  col += uRoomTint * 0.006;

  gl_FragColor = vec4(col, 1.0);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`

export const streakVertex = /* glsl */ `
attribute vec3 aSeed;
uniform float uTime;
uniform vec3 uBoxMin;
uniform vec3 uBoxSize;
uniform vec2 uWind;     // horizontal drift in m/s (x, z)
uniform float uLen;     // streak length (motion blur), metres
uniform float uWidth;   // streak width, metres
varying vec2 vQuad;
varying float vFade;
void main() {
  float speed = mix(6.5, 9.5, fract(aSeed.x * 13.7 + aSeed.z * 7.1));
  vec3 p = uBoxMin + aSeed * uBoxSize;
  p.y = uBoxMin.y + mod(p.y - uBoxMin.y - uTime * speed, uBoxSize.y);
  float fallen = (uBoxMin.y + uBoxSize.y - p.y) / speed;
  p.xz += uWind * fallen;
  vec3 vel = normalize(vec3(uWind.x, -speed, uWind.y));
  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  vec3 dirV = normalize((viewMatrix * vec4(vel, 0.0)).xyz);
  vec3 sideV = normalize(cross(dirV, vec3(0.0, 0.0, 1.0)));
  float dist = -mv.z;
  float len = uLen * mix(0.6, 1.3, aSeed.z);
  // widen far streaks a little so they never go sub-pixel and shimmer
  float wid = uWidth * (1.0 + dist * 0.08);
  mv.xyz += dirV * position.y * len + sideV * position.x * wid;
  vQuad = position.xy * 2.0;
  vFade = smoothstep(1.5, 4.0, dist) * (1.0 - smoothstep(9.0, 16.0, dist)) * mix(0.35, 1.0, aSeed.y);
  gl_Position = projectionMatrix * mv;
}
`

export const streakFragment = /* glsl */ `
uniform vec3 uColor;
uniform float uOpacity;
varying vec2 vQuad;
varying float vFade;
void main() {
  float across = 1.0 - abs(vQuad.x);
  across *= across;
  float along = smoothstep(-1.0, -0.1, vQuad.y) * (1.0 - smoothstep(0.4, 1.0, vQuad.y));
  float a = across * along * vFade * uOpacity;
  gl_FragColor = vec4(uColor, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
}
`
