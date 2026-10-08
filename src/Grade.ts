import { BlendFunction, Effect } from 'postprocessing'
import { Color, Uniform } from 'three'

// Split-tone grade: teal in the shadows, warm in the highlights, a small black lift so the
// darks stay readable. Runs after tone mapping (values are display-referred 0..1).
const fragment = /* glsl */ `
uniform vec3 shadowTint;
uniform vec3 highlightTint;
uniform float amount;
uniform float lift;
void mainImage(const in vec4 inputColor, const in vec2 uv, out vec4 outputColor) {
  vec3 c = pow(max(inputColor.rgb, 0.0), vec3(1.0 / 2.2));   // grade in a perceptual space
  float l = dot(c, vec3(0.2126, 0.7152, 0.0722));
  float sh = 1.0 - smoothstep(0.05, 0.45, l);
  float hi = smoothstep(0.35, 0.9, l);
  c += amount * (shadowTint * sh + highlightTint * hi);
  c = c * (1.0 - lift) + lift;
  outputColor = vec4(pow(clamp(c, 0.0, 1.0), vec3(2.2)), inputColor.a);
}
`

export class SplitToneEffect extends Effect {
  constructor({
    shadowTint = new Color(-0.04, 0.012, 0.03),
    highlightTint = new Color(0.035, 0.012, -0.03),
    amount = 1,
    lift = 0.018,
  } = {}) {
    super('SplitToneEffect', fragment, {
      blendFunction: BlendFunction.NORMAL,
      uniforms: new Map<string, Uniform>([
        ['shadowTint', new Uniform(shadowTint)],
        ['highlightTint', new Uniform(highlightTint)],
        ['amount', new Uniform(amount)],
        ['lift', new Uniform(lift)],
      ]),
    })
  }
}
