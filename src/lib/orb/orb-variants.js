// Orbkit Variants (SHDR-01 to SHDR-33)
// WebGL 1.0 / GLSL ES 1.0 Fragment Shaders & Schema from Orbkit

export const ORB_GLSL_HELPERS = `
precision highp float;
uniform vec2 uRes;
uniform float uTime;   // slow ambient clock (half real-time)
uniform float uAnim;   // flow clock - its speed follows the output volume
uniform float uInput;  // input volume 0..1: user speech energy
uniform float uOutput; // output volume 0..1: agent speech energy

float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453123); }
float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  f = f * f * (3.0 - 2.0 * f);
  return mix(
    mix(hash(i), hash(i + vec2(1.0, 0.0)), f.x),
    mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), f.x),
    f.y
  );
}
float fbm(vec2 p) {
  float v = 0.0;
  float a = 0.5;
  for (int i = 0; i < 5; i++) {
    v += a * noise(p);
    p = p * 2.03 + vec2(11.7, 7.3);
    a *= 0.5;
  }
  return v;
}
vec2 orbUV() { return (2.0 * gl_FragCoord.xy - uRes) / min(uRes.x, uRes.y); }

vec3 tanh3(vec3 x) {
  x = clamp(x, -10.0, 10.0);
  vec3 e = exp(2.0 * x);
  return (e - 1.0) / (e + 1.0);
}
`;

export function paramUniformDecls(variant) {
  return [
    ...(variant.params || []).map((p) => `uniform float uP_${p.key};`),
    ...(variant.colors || []).map((c) => `uniform vec3 uC_${c.key};`)
  ].join("\n");
}

const KNOT_REST = {
  speed: 0.42,
  swirl: 0.075,
  drift: 0.18,
  bulge: 3.28,
  warp: 2,
  pole: 0.13,
  poleSoft: 0.001,
  pulse: 0.35,
  split: 0.045,
  sharp: 4.5,
  core: 2.235,
  floor: 0.26,
  gain: 1,
  contrast: 1.35,
  light: 0.705
};
const KNOT_PALETTE = {
  deep: "#111a2e",
  line: "#3fd2ff",
  hot: "#fff4d6",
  sheen: "#a9d8ff"
};

const HEAT_REST = {
  speed: 0.5,
  spin: 0.05,
  gain: 1,
  warp: 0.6,
  lo: 0.42,
  hi: 0.74,
  jitter: 0.015,
  banding: 0.85,
  grain: 0.35,
  contrast: 1
};
const HEAT_PALETTE = {
  cold: "#0b0a1e",
  cool: "#3b2a9a",
  warm: "#f05a28",
  hot: "#f6b53a",
  core: "#fff1e6"
};


export const ORB_VARIANTS = {
  "shdr-01": {
  key: "shdr-01",
  label: "SHDR-01",
  note: "cut-glass orb with a dispersive, turbulent interior",
  frag: "\n#define STEPS 60\n#define TURB 5\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat dispersionTurb;\nfloat dispersionExposure;\n\nmat2 rot2(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\nvec3 dispersionRender(vec2 fragCoord) {\n  float animTime = uP_speed; // integrated clock: turbulence + sheet drift\n  float spinAng = uP_spin;   // integrated clock: prism precession\n\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back, as in shdr-21 and the README's\n  // diffusion note \u2014 near sheets veil far ones, which is where the depth\n  // read comes from\n  float T = 1.0;\n\n  /*\n    March only the span that can contribute. The tube is infinite, so a ray\n    grazing its wall far in FRONT of the ball would otherwise stall there \u2014\n    small d, step after step \u2014 and exhaust STEPS before ever reaching the\n    envelope, leaving a dark notch across the orb. Start at the envelope's\n    near edge and break past its far edge; all 60 steps land where the\n    envelope is non-zero.\n  */\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 p = ro + rd * z;\n\n    // orient the prism: static tilt about x, then precession about y from\n    // the spin clock. Real rotations \u2014 see the header note.\n    vec3 q = p;\n    q.xz = rot2(spinAng) * q.xz;\n    q.yz = rot2(uP_tilt) * q.yz;\n\n    // turbulence in the prism's rotating frame; the +float(it) offset is the\n    // original's +i, decorrelating octaves per step for a smoky depth\n    vec3 a = q;\n    for (int j = 0; j < TURB; j++) {\n      float dj = float(j) + 3.0;\n      a -= dispersionTurb * sin(a * dj + animTime + float(it)).yzx / dj;\n    }\n\n    /*\n      The orb's own shell, in place of the original's square tube\n      (golfed there as max(p=abs(p),p.y).x \u2014 just max(|x|,|y|)). Evaluated\n      on the WARPED point, so the turbulence shimmers the surface itself\n      like an oil film; at turb 0 it is a perfect glass shell. The cos\n      sheets fill the interior with the dispersive volume.\n    */\n    float wall = abs(length(a) - uP_envRadius);\n    float s = a.z + a.y - animTime;\n    float d = max(wall + abs(cos(s)) / uP_sheets, 1e-4);\n\n    /*\n      Per-channel palette: one cosine phase per channel, scaled by uP_disperse\n      (0 collapses to monochrome breathing, 1 is the original rainbow). The\n      -z term couples depth into the phase, which is what turns the sheets\n      into striations; uP_stria scales it.\n\n      The CLAMP is load-bearing, same as the other accumulators here: 1/d\n      spikes where a ray grazes the wall exactly where a sheet sits, and one\n      unclamped sample would own the whole 60-step sum at some phases.\n    */\n    vec3 w = (cos(s - z * uP_stria + vec3(0.0, 1.0, 8.0) * uP_disperse) + 1.0) / d;\n    w = min(w, vec3(uP_stepClamp));\n\n    /*\n      Envelope: bounds the sheet glow (the cos field lives EVERYWHERE in\n      space, not just inside the ball) and adds the uP_fill floor that\n      guarantees a body. The outer bound sits 12% PAST the radius on\n      purpose: the shell IS the radius now, the silhouette is cut\n      analytically in main(), and a hard cut only reads as a sharp edge if\n      there is still emission left at the boundary to cut. envCore is where\n      the plateau saturates \u2014 1 keeps the shell at full strength, lower\n      values pull the brightness into the core.\n    */\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    z += d;\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  dispersionTurb = uP_turb * (1.0 + 0.5 * uInput);\n  dispersionExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;\n      acc += dispersionRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = dispersionRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map, as in the original but per channel and with a tunable\n  // knee \u2014 the envelope and transmittance change the accumulator's scale\n  // completely, so the golfed /2e2 constant means nothing here\n  vec3 col = tanh3(acc / max(dispersionExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a saturated violet\n  // fringe has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  /*\n    Analytic silhouette: the perpendicular distance from the sphere's centre\n    to this pixel's ray, against the shell radius. Exact \u2014 not a fade of the\n    accumulated glow \u2014 which is what makes the edge read as cut glass.\n    uP_edge trades the transition band: 1 is a couple of pixels, 0 falls\n    back to a soft feather. Colour AND alpha, as always.\n  */\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // Fade colour as well as alpha \u2014 with premultiplied output, fading only\n  // alpha leaves the pixel emitting at full brightness up to the cutoff,\n  // which reads as a hard rim. With the analytic mask doing the real work\n  // this is only a safety taper at the frame boundary.\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 5, step: 0.03, default: 0.25, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.1, default: 2.25 },
    { key: "tilt", label: "Field tilt", min: 0, max: 4, step: 0.02, default: 0.5 },
    { key: "turb", label: "Turbulence", min: 0, max: 5, step: 0.03, default: 0.3 },
    { key: "sheets", label: "Sheet density", min: 1, max: 60, step: 0.5, default: 7 },
    { key: "disperse", label: "Dispersion", min: 0, max: 5, step: 0.03, default: 1 },
    { key: "stria", label: "Striation depth", min: 0, max: 10, step: 0.05, default: 1 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 1 },
    { key: "fill", label: "Body fill", min: 0, max: 100, step: 0.3, default: 1.5 },
    { key: "stepClamp", label: "Step clamp", min: 0.3, max: 300, step: 1.5, default: 20 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.02 },
    { key: "exposure", label: "Exposure", min: 1.5, max: 1500, step: 10, default: 60 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  statePresets: {
    idle: {
      speed: 0.5,
      spin: 0.25,
      turb: 0.3,
      disperse: 1,
      sheets: 7,
      exposure: 60,
      scatter: 0.02,
      alphaGain: 2
    },
    thinking: {
      speed: 0.6,
      spin: 0.5,
      turb: 0.35,
      disperse: 1.1,
      sheets: 7,
      exposure: 57,
      scatter: 0.019,
      alphaGain: 2.1
    },
    // loudest: fast drift, dense sheets, wide rainbow
    speaking: {
      speed: 1.2,
      spin: 0.7,
      turb: 0.55,
      disperse: 1.5,
      sheets: 5.5,
      exposure: 45,
      scatter: 0.015,
      alphaGain: 2.5
    }
  }
},
  "shdr-02": {
  key: "shdr-02",
  label: "SHDR-02",
  note: "ornate scrollwork on a rolling dome",
  frag: "\n#define LAYERS 10\n#define WARP 9\n\nvoid main() {\n  vec2 uv = orbUV();\n  float R = uP_radius + uP_swell * uInput;\n  float r2d = length(uv);\n  float mask = smoothstep(0.012, -0.012, r2d - R);\n  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);\n  float z = sqrt(max(1.0 - nr * nr, 0.0));\n\n  float animTime = uP_speed; // integrated clock\n\n  vec3 sp = vec3(uv / max(R, 0.001), z);\n\n  /*\n    Stereographic projection: sphere \u2192 plane. Equal steps in screen space map to\n    ever-larger steps in pattern space as the rim is approached, which is exactly\n    the foreshortening that sells a flat field as wrapped geometry. uP_bulge\n    softens the divisor \u2014 higher flattens it back toward a disc.\n\n    DO NOT rotate sp in 3D before this. Spinning the dome about Y mixes sp.x\n    into sp.z, so near the rim the divisor collapses toward zero, p explodes,\n    length(v) goes huge, and 1/length(v) leaves most of the sphere black. That\n    is what hollowed the orb out. The projection needs sp.z to stay the\n    view-facing component.\n\n    Motion comes from animTime inside the warp below instead, which changes the\n    scrollwork without ever touching the projection. If you want the pattern to\n    travel, rotate or translate p here in 2D \u2014 that is projection-safe.\n  */\n  vec2 p = sp.xy / (sp.z + 1.0 + uP_bulge) * uP_zoom;\n\n  // projection-safe 2D drift, in place of a dome spin\n  float sw = animTime * uP_swirl;\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n\n  // input volume tightens the warp; output volume brightens the layers\n  float warpFreq = uP_warpFreq * (1.0 + 0.35 * uInput);\n  float gain = uP_gain * (0.75 + 0.7 * uOutput);\n\n  vec4 acc = vec4(0.0);\n  for (int i = 1; i <= LAYERS; i++) {\n    float fi = float(i);\n    vec2 v = p;\n    for (int j = 1; j <= WARP; j++) {\n      float f = float(j);\n      v += sin(v.yx * f * warpFreq + fi + animTime) / f;\n    }\n    // uP_coreClamp guards the divide and doubles as the flare size \u2014 the\n    // original has no guard and relies on length(v) never hitting zero.\n    //\n    // uP_falloff is the FILL control. The original's plain 1/length(v) decays\n    // fast, so only the knots where the warp lands near the origin light up and\n    // the rest of the sphere stays near black. An exponent below 1 flattens the\n    // tail \u2014 at length(v)=10 a 0.6 power is ~4x brighter than 1/x \u2014 which lifts\n    // the filigree between the knots without blowing the knots themselves out.\n    float rad = pow(max(length(v), uP_coreClamp), uP_falloff);\n    acc += (cos(fi + vec4(0.0, 1.0, 2.0, 3.0) + uP_hueShift) + 1.0) / 6.0 / rad;\n  }\n\n  // the original squares before tone-mapping, which is what crushes the dim\n  // filigree and leaves the bright scrollwork\n  vec3 col = tanh3(acc.rgb * acc.rgb * gain);\n\n  // rim light, so the silhouette reads as a ball rather than a cut-out\n  float fresnel = pow(1.0 - z, uP_rimPow);\n  col += vec3(fresnel) * uP_rim;\n\n  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));\n  float visibility = clamp(lum * uP_alphaGain + uP_baseVis + fresnel * 0.25, 0.0, 1.0);\n\n  // Surface-lit and mask-bounded, so alpha is coverage: premultiply normally.\n  // (Unlike Corona and Nimbus, which are emissive and must not be.)\n  float a = mask * visibility;\n  gl_FragColor = vec4(col * a, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.06 },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "swell", label: "Input swell", min: 0, max: 1, step: 0.01, default: 0.06 },
    { key: "zoom", label: "Pattern zoom", min: 0.15, max: 40, step: 0.2, default: 4.4 },
    { key: "bulge", label: "Sphere bulge", min: 0, max: 10, step: 0.05, default: 0.35 },
    { key: "warpFreq", label: "Warp frequency", min: 0.05, max: 10, step: 0.05, default: 1.5 },
    { key: "hueShift", label: "Hue shift", min: 0, max: 6.283, step: 0.05, default: 0 },
    { key: "coreClamp", label: "Flare size", min: 0.003, max: 3, step: 0.015, default: 0.12 },
    { key: "falloff", label: "Fill", min: 0.05, max: 4, step: 0.05, default: 1 },
    { key: "gain", label: "Exposure", min: 0.015, max: 10, step: 0.05, default: 0.55 },
    { key: "rim", label: "Rim light", min: 0, max: 3, step: 0.015, default: 0.12 },
    { key: "rimPow", label: "Rim tightness", min: 0.15, max: 15, step: 0.1, default: 2.2 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2.4 },
    { key: "baseVis", label: "Base visibility", min: 0, max: 1.5, step: 0.01, default: 0.08 }
  ],
  colors: [],
  /*
   * No dome rotation in any state — see the projection note in the shader. The
   * states differ by how fast the scrollwork evolves and how dense it is.
   *
   * `swirl` is deliberately absent from every preset: the rotation angle is
   * animTime * swirl, so a per-state swirl value makes a state change sweep
   * the angle by (accumulated clock) x (delta) — the whole dome visibly spins
   * while the preset glides. Held constant, the angle stays continuous and a
   * state change only retimes the scrollwork.
   */
  statePresets: {
    // calm: slow evolution, open scrollwork
    idle: {
      speed: 0.5,
      zoom: 4.4,
      warpFreq: 1.5,
      coreClamp: 0.12,
      falloff: 1,
      gain: 0.55,
      rim: 0.12,
      alphaGain: 2.4
    },
    thinking: {
      speed: 0.65,
      zoom: 4.6,
      warpFreq: 1.6,
      coreClamp: 0.11,
      falloff: 0.96,
      gain: 0.6,
      rim: 0.13,
      alphaGain: 2.5
    },
    /*
      speaking is SPEED-led, like hydrogen's: the scrollwork keeps the idle
      structure but reforms itself several times faster, with hotter knots and
      MORE contrast (falloff above 1), so it reads as the same orb answering
      at speed. Densifying the pattern here (higher zoom/warpFreq) is what
      used to make speaking look like a blurry mesh: more detail per pixel and
      a flatter falloff wash the filigree into fog.

      warpFreq 1.2 is deliberate: the shader scales it by the input volume,
      and speaking synthesizes input around 0.65, so the EFFECTIVE frequency
      lands back at the crisp ~1.5 that idle shows at zero input.
    */
    speaking: {
      speed: 3,
      zoom: 4.4,
      warpFreq: 1.2,
      coreClamp: 0.07,
      falloff: 1.1,
      gain: 0.85,
      rim: 0.2,
      alphaGain: 3
    }
  }
},
  "shdr-03": {
  key: "shdr-03",
  label: "SHDR-03",
  note: "a turbulent belt of light girdling the ball, contoured in rainbow",
  frag: "\n#define STEPS 80\n#define TURB 8\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat eclipticTurb;\nfloat eclipticPlane;\nfloat eclipticExposure;\nfloat eclipticWidth;\n\nvec3 eclipticRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float animTime = uP_speed; // integrated clock: the warp\n  float wander = uP_wander;  // integrated clock: the belt's tilt\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back \u2014 the near belt veils the far one\n  float T = 1.0;\n\n  // march only the span the envelope can light, as in shdr-01\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  /*\n    The listing's feedback variable, explicit. On the first iteration the\n    axis below reads this before anything has written it \u2014 zero is what the\n    golfed version gets, so zero is what it gets here.\n  */\n  float d = 0.0;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 p = ro + rd * z;\n\n    /*\n      The axis, steered by the PREVIOUS step's density: the belt's tilt\n      settles as the ray closes on the surface and swings away from it out\n      in the open. The three phases are far enough apart that the cosines\n      can never null together, so the normalize is safe without a guard.\n    */\n    vec3 axis = normalize(cos(wander + vec3(4.0, 2.0, 0.0) - d * uP_feedback));\n\n    // the exact minus-90-degree rotation about that axis\n    vec3 a = dot(axis, p) * axis - cross(axis, p);\n\n    // eight octaves of plain feedback warp \u2014 no lattice quantizer here,\n    // unlike its cousins shdr-22 and shdr-04\n    for (int j = 0; j < TURB; j++) {\n      float f = float(j) + 2.0;\n      a += eclipticTurb * sin(a * f + animTime).yzx / f;\n    }\n\n    /*\n      Sphere plus plane. The shell reads the RAW point so the ball stays a\n      ball; the plane reads the WARPED one so the belt writhes across it.\n      uP_plane at zero drops the belt and lights the whole shell, which is\n      worth being able to see once.\n    */\n    d = uP_shellW * abs(length(p) - uP_shellR) + eclipticPlane * abs(a.y);\n    d = max(d, eclipticWidth);\n\n    /*\n      Hue from the DENSITY \u2014 the belt contoured in rainbow along its own\n      distance field \u2014 and the listing's z in the numerator, which burns\n      the far limb hotter than the near one.\n    */\n    vec3 w = cos(d * uP_hue + vec3(0.0, 2.0, 4.0) * uP_spread) + 1.0;\n    w *= z / d;\n    w = min(w, vec3(uP_stepClamp));\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    z += d;\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  /*\n    The SURGE: tightness and warp swept together on one phase, so the belt\n    gathers into a hard warped girdle and then opens back into a smooth\n    shell. Two params, one gesture \u2014 swept apart they read as two unrelated\n    things happening at once.\n\n    Absolute bounds rather than a swing around what was dialled, so the range\n    is exactly the range: tightness 0.1 to 0.3, warp 0.5 to 1.6. That is why\n    the mix sits OUTSIDE the volume terms below \u2014 folding the surge under\n    them would shave the top of both ranges by whatever the agent happened to\n    be doing. At surge zero those terms are all that is left, so a state that\n    does not ask for this is untouched.\n  */\n  float surge = 0.5 - 0.5 * cos(uAnim * 4.0);\n\n  eclipticTurb = mix(uP_turb * (1.0 + 0.4 * uInput), mix(0.5, 1.6, surge), uP_surge);\n  // the belt broadens toward a full shell while the agent speaks\n  eclipticPlane = mix(uP_plane * (1.0 - 0.35 * uOutput), mix(0.1, 0.3, surge), uP_surge);\n  eclipticExposure = uP_exposure * (1.0 - 0.3 * uOutput);\n\n  /*\n    The belt BREATHES. At pulse zero the width is exactly what was dialled,\n    so a state that does not ask for this is untouched; at one it sweeps the\n    whole way from nothing to that width and back, once every few seconds.\n\n    It cannot truly reach zero. Belt width is the march's step floor \u2014 see\n    the port note above \u2014 and a zero step stalls the ray on one point, which\n    with no scatter to close the transmittance accumulates the clamp eighty\n    times into a white flare. The floor is the param's own minimum, four\n    times finer than what the resting belt uses, so it reads as gone.\n\n    Off uAnim rather than a raw clock, so the breath quickens with the agent\n    like every other motion in the engine.\n  */\n  eclipticWidth = max(uP_width * (1.0 - uP_pulse * (0.5 + 0.5 * cos(uAnim * 3.0))), 5e-4);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      acc += eclipticRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = eclipticRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the envelope and transmittance change the\n  // accumulator's scale, so the golfed /1e4 knee is a tunable here\n  vec3 col = tanh3(acc / max(eclipticExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue contour\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.6, integrate: true },
    { key: "wander", label: "Belt tilt drift", min: 0, max: 5, step: 0.02, default: 0.3, integrate: true },
    { key: "feedback", label: "Tilt feedback", min: 0, max: 40, step: 0.1, default: 1.5 },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 5 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.05, default: 1.05 },
    { key: "shellR", label: "Shell radius", min: 0.2, max: 20, step: 0.1, default: 3 },
    { key: "shellW", label: "Shell weight", min: 0.005, max: 1, step: 0.005, default: 0.12 },
    { key: "plane", label: "Belt tightness", min: 0, max: 1, step: 0.005, default: 0.15 },
    { key: "turb", label: "Warp", min: 0, max: 4, step: 0.02, default: 0.55 },
    { key: "width", label: "Belt width", min: 0.0005, max: 0.4, step: 0.0005, default: 0.004 },
    { key: "pulse", label: "Belt breathing", min: 0, max: 1, step: 0.01, default: 0 },
    { key: "surge", label: "Belt surge", min: 0, max: 1, step: 0.01, default: 0 },
    { key: "hue", label: "Contour hue", min: 0, max: 60, step: 0.1, default: 25 },
    { key: "spread", label: "Colour spread", min: 0, max: 3, step: 0.02, default: 1 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 20, step: 0.1, default: 3.3 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 0.92 },
    { key: "fill", label: "Body fill", min: 0, max: 40, step: 0.05, default: 0.1 },
    { key: "stepClamp", label: "Step clamp", min: 5, max: 20000, step: 25, default: 1500 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.1, step: 0.0002, default: 0.0006 },
    { key: "exposure", label: "Exposure", min: 20, max: 100000, step: 50, default: 1500 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.05, default: 1.2 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.25 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    Staged on BELT TIGHTNESS, which is the only control that changes what
    the object is: high and the light is a single girdle, low and it opens
    out into the whole shell. Warp and belt width carry the rest.
  */
  statePresets: {
    /*
      at rest: a hairline thread on a small, thin shell. The belt is left
      loose — a twentieth of the way to thinking's wire — so it is the WARP,
      more than double what searching carries and the highest steady value of
      the three, that gives the light its shape rather than the plane
      confining it. Hue is pushed warm and the
      envelope opened to its ceiling, which is what lets so fine a line still
      read as a body.
    */
    idle: {
      speed: 0.6,
      wander: 0.3,
      feedback: 2,
      shellR: 2,
      shellW: 0.085,
      plane: 0.085,
      turb: 1.54,
      width: 0.001,
      hue: 39.8,
      spread: 0.94,
      envCore: 1.02,
      stepClamp: 1475,
      exposure: 1450,
      scatter: 0.0006,
      alphaGain: 2
    },
    /*
      searching: the belt BREATHES. Width is on `pulse` at full depth, so the
      band swells from nothing to fifty times the resting belt and closes
      again every few seconds — the state's whole tell, and the reason warp
      drops to under half of idle's: the shape comes from the breathing now,
      not from the noise.

      Under it the belt is also four times tighter than at rest and hunting
      hard — the tilt three times as fast, the axis feedback near quadrupled
      — on a shell pulled small and thin inside a much wider envelope, so
      what pulses is a broad band on a small ball rather than a girdle.
    */
    thinking: {
      speed: 2,
      wander: 1.1,
      feedback: 7.5,
      focal: 1.9,
      shellR: 1.9,
      shellW: 0.005,
      plane: 0.345,
      turb: 0.7,
      width: 0.048,
      pulse: 1,
      hue: 28.3,
      spread: 1.02,
      envRadius: 7.4,
      envCore: 0.84,
      exposure: 2300,
      scatter: 0,
      alphaGain: 2
    },
    /*
      answering: the belt SURGES. Tightness and warp are both on the surge at
      full depth, sweeping 0.1 to 0.3 and 0.5 to 1.6 together about every
      second and a half — from a loose, lightly warped band to a tight warped
      girdle and back. Where thinking pulses one control, this one swings the
      two that decide what the object is, which is why it reads as the
      loudest of the three.

      Tightness starts the sweep at exactly what is dialled here, so the
      preset value is the loose end of the swing; warp does not, and its 0.14
      is only what you would see with the surge turned off. What the preset
      carries either way is the body under them — a broad shell, tilt
      drifting near three times idle's, the axis feedback almost off — plus
      eighteen times the resting belt width to keep the girdle solid at the
      tight end.
    */
    speaking: {
      speed: 0.9,
      wander: 0.84,
      feedback: 0.3,
      shellR: 1.8,
      shellW: 0.19,
      plane: 0.1,
      turb: 0.14,
      width: 0.018,
      surge: 1,
      spread: 1.04,
      envRadius: 3.4,
      exposure: 650,
      scatter: 0.0003,
      alphaGain: 2.7
    }
  },
  // the contour ramp supplies the colour, so the tint only shifts its
  // temperature: neutral at rest, cooled while searching, warmed while
  // answering
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#9db8ff" },
    speaking: { tint: "#ffc492" }
  }
},
  "shdr-04": {
  key: "shdr-04",
  label: "SHDR-04",
  note: "a hollow shell of light, faceted by a voxel lattice",
  frag: "\n#define STEPS 50\n#define TURB 6\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat geodeTurb;\nfloat geodeWidth;\nfloat geodeExposure;\n\n// GLSL ES 1.0 has no round() \u2014 it arrived in ES 3.0. The listing quantizes\n// with it, so it ships here.\nvec3 roundv(vec3 x) { return floor(x + 0.5); }\n\nvec3 geodeRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float animTime = uP_speed; // integrated clock\n  float shellR = uP_shellR;\n  float pitch = max(uP_pitch, 0.002);\n\n  // the run-away bound for rays that miss the shell entirely\n  float zEnd = uP_camDist + shellR * 2.5;\n\n  vec3 acc = vec3(0.0);\n\n  // The listing starts its march at the camera and lets the trace do the\n  // travelling \u2014 see the header. z is the distance already walked.\n  float z = 0.0;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 p = ro + rd * z;\n\n    /*\n      Six octaves on ONE lattice. The pitch never changes; only the phase\n      multiplier does, so the displacement is piecewise constant on a\n      single grid and the shell facets at one scale.\n    */\n    for (int j = 0; j < TURB; j++) {\n      float f = float(j) + 2.0;\n      p += geodeTurb * sin(roundv(p.zxy / pitch) * pitch * f - animTime) / f;\n    }\n\n    /*\n      Sphere trace toward the shell, on the WARPED point \u2014 so the facets\n      are what the ray is chasing, not a smooth ball underneath them. The\n      slack is the listing's tenth, and the floor is the surface width.\n    */\n    float d = geodeWidth + uP_slack * abs(length(p) - shellR);\n\n    z += d;\n\n    /*\n      Position as colour, washing toward white with depth. Guarded on z:\n      the listing gets away with reading p/z here because its comma\n      operator advances z first, which is worth knowing before anyone\n      reorders these two lines.\n    */\n    acc += (p * uP_hueGain / max(z, 1e-3) + uP_floorLevel) / d;\n\n    if (z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  geodeTurb = uP_turb * (1.0 + 0.5 * uInput);\n  geodeWidth = max(uP_width * (1.0 - 0.4 * uOutput), 0.0002);\n  geodeExposure = uP_exposure * (1.0 - 0.3 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      acc += geodeRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = geodeRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the golfed /2e3 knee is a tunable here\n  vec3 col = tanh3(acc / max(geodeExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue facet\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  /*\n    Analytic silhouette against the shell, widened by uP_envScale because\n    the turbulence pushes the visible surface OUT past the nominal radius \u2014\n    cut at the bare radius and the facets would be shaved flat all round\n    the limb.\n  */\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float sil = uP_shellR * uP_envScale;\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(sil * (1.0 - band), sil * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.6, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 60, step: 0.3, default: 9 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.05, default: 1.35 },
    { key: "shellR", label: "Shell radius", min: 0.3, max: 20, step: 0.1, default: 5 },
    { key: "pitch", label: "Facet size", min: 0.005, max: 1.5, step: 0.005, default: 0.3 },
    { key: "turb", label: "Displacement", min: 0, max: 5, step: 0.02, default: 0.45 },
    { key: "slack", label: "Trace slack", min: 0.01, max: 0.9, step: 0.005, default: 0.1 },
    { key: "width", label: "Surface width", min: 0.0005, max: 0.3, step: 0.0005, default: 0.003 },
    { key: "hueGain", label: "Position hue", min: 0, max: 6, step: 0.02, default: 1 },
    { key: "floorLevel", label: "White floor", min: 0, max: 4, step: 0.02, default: 0.8 },
    { key: "envScale", label: "Silhouette margin", min: 1, max: 2, step: 0.01, default: 1.16 },
    { key: "exposure", label: "Exposure", min: 20, max: 40000, step: 20, default: 3000 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1.3 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.3 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    Staged on displacement — how far the lattice pushes the shell out of
    round — and on surface width, which is the only material control this
    shader has.

    FACET SIZE was held still across all three for a reason: it is a
    quantizer, and a gliding quantizer pops instead of fading (the same rule
    as shdr-14's cell grid and shdr-17's grain). Answering now moves it, 0.3
    to 0.22, so the lattice re-snaps through the half second either side of
    that state rather than cross-fading. Deliberate — see the note there.
  */
  statePresets: {
    // at rest: a shallow crust, the surface held thin and bright
    idle: {
      speed: 0.6,
      turb: 0.45,
      width: 0.003,
      slack: 0.1,
      hueGain: 1,
      exposure: 3000,
      contrast: 1.3
    },
    /*
      searching: the lattice pushes HARD — displacement nearly doubled —
      and the surface pulls to under half its idle width, so the facets
      read as sharp shifting plates. The knee rises with them: this is the
      dim, brittle state.
    */
    thinking: {
      speed: 1.8,
      turb: 0.85,
      width: 0.0012,
      slack: 0.07,
      hueGain: 1.7,
      exposure: 4800,
      contrast: 1.75
    },
    /*
      answering: plates AND lamp, which the other two never are at once. The
      lattice pushes almost as hard as it does while searching — 0.8 against
      0.85 — but on ten times the idle surface width instead of a third of
      it, so the facets stay sharp while the shell they sit on is wide open
      and bright. Fastest of the three, on the widest silhouette margin, and
      the most saturated.

      Two things here break the file's own rules on purpose. Facet size drops
      to 0.22, so the quantizer glides on the way in and out and the lattice
      re-snaps rather than fading; see the staging note above. And the tint
      goes COOL — cyan, cooler than the searching blue — against the warm
      answering tint the colour note below describes.
    */
    speaking: {
      speed: 2,
      pitch: 0.22,
      turb: 0.8,
      width: 0.032,
      slack: 0.165,
      hueGain: 0.5,
      floorLevel: 0.82,
      envScale: 1.67,
      exposure: 1220,
      contrast: 0.92,
      saturation: 1.66
    }
  },
  // the position ramp supplies the colour, so the tint only shifts its
  // temperature: neutral at rest and cool for both of the busy states —
  // blue while searching, a brighter cyan while answering
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#9db8ff" },
    speaking: { tint: "#94f3ff" }
  }
},
  "shdr-05": {
  key: "shdr-05",
  label: "SHDR-05",
  note: "rainbow rings travelling through a lattice of lenses",
  frag: "\n#define AA 3\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat causticSoft;\nfloat causticGain;\nfloat causticSpread;\n\n/*\n  Softened tangent. Equal to sin/cos wherever cos is not near zero, capped\n  at 1/(2*sqrt(g)) where it is \u2014 see the header for why the raw pole cannot\n  be supersampled away.\n*/\nvec2 tanSoft(vec2 x, float g) {\n  vec2 s = sin(x);\n  vec2 c = cos(x);\n  return s * c / (c * c + g);\n}\n\nvec3 causticRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n\n  float ring = uP_ring; // integrated clock: the rings travel\n\n  // stereographic wrap of the unrotated dome, as in shdr-08 \u2014 the lens\n  // lattice compresses toward the limb the way a texture on a sphere does\n  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;\n\n  // projection-safe 2D motion: the lattice turns and slides\n  float sw = uP_swirl; // integrated clock\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n  p += vec2(uP_slide, uP_slide * 0.6); // integrated clock\n\n  /*\n    The lens lattice. Adding p back to its own tangent is what gives every\n    cell a different view instead of tiling one image \u2014 see the header.\n  */\n  float L = length(tanSoft(p, causticSoft) * uP_lens + p);\n\n  /*\n    One cosine, three phases. The listing's (0, .7, 1) sit well under a\n    radian apart, so the channels overlap through most of a band and only\n    separate at its shoulders \u2014 white cores with coloured edges, not three\n    independent rainbows.\n  */\n  vec3 col = cos(L * uP_freq - ring + vec3(0.0, 0.7, 1.0) * causticSpread);\n\n  // the listing's clamp: half of every period is hard black, and that is\n  // what makes these read as bands rather than as a gradient\n  col = max(col, vec3(0.0)) * causticGain;\n\n  col = pow(col, vec3(uP_contrast));\n\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // a dark body under the bands, so the black half of the cosine reads as\n  // the ball rather than as a hole in it\n  col += uC_body * uP_floorLevel;\n\n  // dome shading keeps the ball a ball under the lattice\n  vec3 n = vec3(pl, z);\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.6 + uP_light * lambert;\n\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice lets the walls crowd tighter, the\n  // agent's brightens the bands and opens the colour split.\n  causticSoft = max(uP_poleSoft * (1.0 - 0.5 * uInput), 0.0008);\n  causticGain = uP_gain * (0.85 + 0.45 * uOutput);\n  causticSpread = uP_spread * (1.0 + 0.5 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += causticRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = causticRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "ring", label: "Ring speed", min: 0, max: 8, step: 0.03, default: 0.9, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.05, integrate: true },
    { key: "slide", label: "Lattice slide", min: 0, max: 4, step: 0.02, default: 0.12, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Lattice scale", min: 0.3, max: 20, step: 0.1, default: 5 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "lens", label: "Lens strength", min: 0, max: 4, step: 0.02, default: 1 },
    { key: "poleSoft", label: "Wall softness", min: 0.0008, max: 0.5, step: 0.0008, default: 0.02 },
    { key: "freq", label: "Ring frequency", min: 0.05, max: 8, step: 0.05, default: 1 },
    { key: "spread", label: "Colour split", min: 0, max: 4, step: 0.02, default: 1 },
    { key: "gain", label: "Brightness", min: 0.05, max: 4, step: 0.02, default: 1.1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 6, step: 0.05, default: 1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.15 },
    { key: "floorLevel", label: "Body fill", min: 0, max: 2, step: 0.01, default: 0.12 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.4 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.45 }
  ],
  colors: [
    { key: "tint", label: "Tint", default: "#ffffff" },
    { key: "body", label: "Body", default: "#141a30" },
    { key: "sheen", label: "Sheen", default: "#bcd8ff" }
  ],
  /*
    Staged on WALL SOFTNESS, which decides how tightly the rings are
    allowed to crowd before a cell wall stops them, and on ring frequency,
    which decides how many bands are on the ball at all. Lattice scale
    never moves between states — it sets the cell count, and a gliding cell
    count reads as the ball inflating rather than as a change of mood.

    Dome bulge and lens strength are staged too, so the SHAPE moves with the
    mood as well as the lattice: resting flattens both, and the two busy
    states drive them up — answering hardest, which puts bulge at 0 through
    0.36 to 0.96 across the three. They are continuous geometry rather than
    a quantizer, so gliding them is safe.
  */
  statePresets: {
    /*
      at rest: a plain sphere of drifting bands. Dome bulge is at zero and
      the lens down to under half its default — the only state that flattens
      both — so the ball is read straight rather than through a lens, which
      is what lets resting look settled even though the rings never stop
      moving.

      The walls are the TIGHTEST of the three here, under a third of
      searching's and a fifth of answering's, so the rings crowd hard
      against them; the colour split narrows to 0.7 with the key light
      raised well over its default to put back the separation the narrower
      split gives away.
    */
    idle: {
      ring: 0.9,
      swirl: 0.195,
      slide: 0.26,
      bulge: 0,
      lens: 0.38,
      poleSoft: 0.012,
      freq: 1.05,
      spread: 0.7,
      gain: 1.1,
      contrast: 1,
      saturation: 1.14,
      light: 0.66
    },
    /*
      searching: the ball comes UP. Where resting is flat and read straight,
      this bulges the dome and drives the lens past one, so the bands are
      magnified through the middle — and the drift roughly triples, swirl
      and lattice slide together, on a ring clock three times as fast.

      It is also the hardest-looking of the three by some way: contrast more
      than triples over resting and saturation doubles, on a body fill three
      times as deep and with the rim sheen switched off entirely, so nothing
      softens the edge. The walls open to three times resting's, which stops
      the rings being hairlines — this state reads through colour and shape
      now, not through fineness.
    */
    thinking: {
      ring: 3,
      swirl: 0.57,
      slide: 0.88,
      bulge: 0.36,
      lens: 1.28,
      poleSoft: 0.042,
      freq: 1.3,
      spread: 1.82,
      gain: 0.88,
      contrast: 3.2,
      saturation: 2.36,
      floorLevel: 0.4,
      rim: 0
    },
    /*
      answering: the FINEST banding of the three by a long way — ring
      frequency near five times resting's and nearly four times searching's
      — laid over the most strongly domed ball, bulge pushed almost to one
      against resting's flat zero. Many tight bands, spread across a surface
      curving away from you.

      The walls open to five times resting's, which is what keeps banding
      that fine from crowding into a solid field, and the drift is the
      highest of the three on both controls. Colour split comes back to
      about where resting holds it, so it is the fineness that carries this
      state rather than the split.
    */
    speaking: {
      ring: 1.4,
      swirl: 0.6,
      slide: 1,
      bulge: 0.96,
      lens: 1.2,
      poleSoft: 0.064,
      freq: 4.8,
      spread: 0.68,
      gain: 1.6,
      contrast: 0.75
    }
  },
  // the ring phases supply the colour, so the tint only shifts temperature
  // and the body carries the mood: neutral at rest, cold while searching,
  // warm while answering
  stateColors: {
    idle: { tint: "#ffffff", body: "#141a30", sheen: "#bcd8ff" },
    thinking: { tint: "#a6c0ff", body: "#080c26", sheen: "#7ea9ff" },
    speaking: { tint: "#ffc492", body: "#2e1408", sheen: "#ffb277" }
  }
},
  "shdr-06": {
  key: "shdr-06",
  label: "SHDR-06",
  note: "a hundred glowing lattices stacked through the ball, interfering",
  frag: "\n#define LAYERS 100\n#define AA 1\n\n/*\n * The listing's sin(r + f), minus the resolution. The components are a\n * quarter turn apart so the per-layer frequency pair walks a circle (see\n * the header) \u2014 the base value only sets where on that circle layer one\n * starts.\n */\nconst vec2 SEED = vec2(11.3, 12.87);\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat moireDrift;\nfloat moireGlow;\nfloat moireHue;\n\nvec3 moireRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n\n  float t = uP_speed; // integrated clock\n\n  /*\n    The layer-zero projection: the plain stereographic wrap of the dome's\n    surface. Every deeper layer is this divided by its own denominator, so\n    the whole parallax below costs one ratio per layer.\n  */\n  float bulge = 1.0 + uP_bulge;\n  float den0 = z + bulge;\n\n  vec2 w = pl / den0 * uP_scale;\n\n  vec3 acc = vec3(0.0);\n\n  for (int li = 0; li < LAYERS; li++) {\n    float f = float(li) + 1.0;\n    float u = f / float(LAYERS);\n\n    /*\n      This layer's depth along the view ray, and the projection from the\n      point the ray has reached there. At depth 0 the denominator is den0\n      and the ratio is 1; deeper layers see the pattern from further\n      inside the ball, which spreads them at the limb and not at all\n      through the centre. That gradient is what shears the stack.\n    */\n    float d = u * uP_depth;\n    float denu = z - d + bulge * sqrt(max(1.0 - 2.0 * d * z + d * d, 0.0));\n    vec2 q = w * (den0 / max(denu, 0.05));\n\n    /*\n      One lattice. sin(q * k) vanishes on a rectangular grid of points and\n      the reciprocal of its length lights every one; the floor on that\n      length is the glow's radius, and without it the divide is by exactly\n      zero at every lattice point.\n    */\n    vec2 k = sin(SEED + f) / max(uP_freq, 0.001);\n    float g = max(length(sin(q * k)), moireGlow);\n\n    // tint by layer index \u2014 depth through the stack reads as hue\n    vec3 hue = cos(f * moireHue + vec3(0.0, 1.0, 3.0)) + 1.1;\n\n    acc += hue / g;\n\n    // the listing's walk between layers: the stack is a hundred grids\n    // each shifted a little further along a wandering path\n    w += moireDrift * sin(w.yx + t);\n  }\n\n  /*\n    The listing's knee is tanh(o*o/4e4) over an unnormalized sum of a\n    hundred layers. Dividing by the layer count first pulls the square's\n    scale down by 100*100, so the same knee is exactly 4 here \u2014 a number\n    that fits on a slider. The square is a contrast squarer, not a tone\n    map: it crushes the field between the glows.\n  */\n  vec3 v = acc / float(LAYERS);\n  vec3 col = tanh3(v * v / max(uP_exposure, 0.0001));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  /*\n    Dome shading, kept gentle: the layers are emission seen THROUGH the\n    ball, so a hard lambert reads as a shadow thrown across the inside of\n    a lamp rather than as a lit surface.\n  */\n  vec3 n = vec3(pl, z);\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.6 + uP_light * lambert;\n\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice widens the walk between layers, the\n  // agent's opens the glows and runs the hue through the stack faster.\n  moireDrift = uP_drift * (1.0 + 0.6 * uInput);\n  moireGlow = max(uP_glowSize * (1.0 - 0.3 * uOutput), 0.002);\n  moireHue = uP_hueRate * (1.0 + 0.35 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  // A hundred lattices per sample, none of them worth paying for outside\n  // the silhouette.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += moireRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = moireRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "drift", label: "Layer walk", min: 0, max: 0.3, step: 0.002, default: 0.02 },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Pattern scale", min: 0.3, max: 20, step: 0.1, default: 4 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "depth", label: "Stack depth", min: 0, max: 1.6, step: 0.01, default: 0.7 },
    { key: "freq", label: "Lattice spacing", min: 0.05, max: 5, step: 0.01, default: 0.7 },
    { key: "glowSize", label: "Glow size", min: 0.002, max: 1, step: 0.002, default: 0.05 },
    { key: "hueRate", label: "Hue per layer", min: 0, max: 0.5, step: 0.002, default: 0.037 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 200, step: 0.05, default: 4 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.2 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.45 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.4 }
  ],
  colors: [
    { key: "tint", label: "Tint", default: "#ffffff" },
    { key: "sheen", label: "Sheen", default: "#bcd8ff" }
  ],
  /*
    Staged on the two controls that decide what the interference looks
    like: the WALK between layers, which sets how far the stack shears
    against itself, and the GLOW SIZE, which sets whether the lattice
    points read as pinpricks or as flooded light.

    The clock is staged hard alongside them, and the two are doing separate
    jobs: the walk is the AMPLITUDE of the shear and the clock is its RATE,
    so a state's character comes from the pair. Small walk on a fast clock
    twitches; a large walk on a fast clock churns.

    Lattice spacing never moves between states — it sets how many grids land
    on the ball, and a gliding count reads as the ball inflating rather than
    as a mood.
  */
  statePresets: {
    // at rest: a slow shallow walk, glows open and soft
    idle: {
      speed: 0.5,
      drift: 0.02,
      depth: 0.7,
      glowSize: 0.05,
      hueRate: 0.037,
      exposure: 4,
      contrast: 1.1
    },
    /*
      searching: quick and granular. The clock runs over five times resting
      speed and the walk is five times as wide, on the deepest stack of the
      three, so the hundred layers shear hard and visibly against each
      other. The glows stay small — a third of resting — which is what keeps
      the movement legible as movement: at this rate, fine points shifting
      read as a scan across the ball rather than as a wash.

      The DOME is pushed out hard too — bulge seven times its default, and
      the only state that moves it. That deepens the denominator the whole
      projection divides by, so the lattice lands finer on the ball and
      spreads less toward the limb: the grain tightens and evens out at the
      same time.
    */
    thinking: {
      speed: 2.6,
      drift: 0.105,
      bulge: 2.18,
      depth: 1.25,
      glowSize: 0.016,
      hueRate: 0.095,
      exposure: 6.5,
      contrast: 1.55
    },
    /*
      answering: the fastest clock of the three and the widest walk, but on
      the SHALLOWEST stack — a third of resting's — so the hundred layers
      barely disagree and travel nearly as one. That is what keeps it
      readable at this rate: a coherent lattice walked hard, rather than a
      hundred of them shearing apart into grain the way searching does.

      The glows stay small, only a little over resting, so the lattice keeps
      its points instead of flooding. What carries the state instead is the
      KEY LIGHT, up to two and a half times its default and the only state
      that touches it — enough dome shading that the flow reads as crossing
      a lit ball rather than as a flat lamp changing pattern.
    */
    speaking: {
      speed: 4.5,
      drift: 0.13,
      depth: 0.26,
      glowSize: 0.062,
      hueRate: 0.045,
      exposure: 2.7,
      contrast: 0.9,
      light: 1.11
    }
  },
  // the layer ramp supplies its own rainbow, so the tint only shifts its
  // temperature: neutral at rest, cooled while searching, warmed while
  // answering
  stateColors: {
    idle: { tint: "#ffffff", sheen: "#bcd8ff" },
    thinking: { tint: "#9db8ff", sheen: "#7ea9ff" },
    speaking: { tint: "#ffc492", sheen: "#ffb277" }
  }
},
  "shdr-07": {
  key: "shdr-07",
  label: "SHDR-07",
  note: "a twist wave travelling out through the ball around a lit column",
  frag: "\n#define STEPS 50\n#define TURB 9\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat torsionTurb;\nfloat torsionTwist;\nfloat torsionExposure;\n\n// GLSL ES 1.0 has no round() \u2014 it arrived in ES 3.0. The listing quantizes\n// with it, so it ships here. Halves round up rather than to even, which is\n// what a lattice quantizer wants anyway.\nvec3 roundv(vec3 x) { return floor(x + 0.5); }\n\nvec3 torsionRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float shimmer = uP_speed; // integrated clock: cell flicker\n  float wave = uP_wave;     // integrated clock: the travelling twist\n  float spin = uP_spin;     // integrated clock: roll about the axis\n\n  // the axis lean and the roll, applied to the SAMPLE rather than to the\n  // axis \u2014 see the header\n  float ct = cos(uP_tilt);\n  float st = sin(uP_tilt);\n  float cs = cos(spin);\n  float ss = sin(spin);\n\n  // the twist axis, unit by construction, which is what makes the\n  // Rodrigues rotation below exact\n  vec3 axis = vec3(0.0, 1.0, 0.0);\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back \u2014 near shells veil far ones\n  float T = 1.0;\n\n  // march only the span the envelope can light, as in shdr-01\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 world = ro + rd * z;\n\n    // into the axis frame: lean about X, then roll about Y\n    vec3 p = vec3(world.x, world.y * ct + world.z * st, -world.y * st + world.z * ct);\n    p = vec3(p.x * cs - p.z * ss, p.y, p.x * ss + p.z * cs);\n\n    /*\n      The travelling twist. h is the sample's radius (scaled by the twist\n      knob) minus the wave clock, and the line below is an exact rotation\n      about the axis by 90 degrees - h. Because h depends only on radius,\n      the winding is constant on spheres: the ball's own shells are the\n      structure, and raising uP_twist puts more turns between the core and\n      the surface.\n    */\n    float h = length(p) * torsionTwist - wave;\n    vec3 a = mix(dot(axis, p) * axis, p, sin(h)) + cos(h) * cross(axis, p);\n\n    // cell-quantized turbulence: every lattice cell flickers on its own\n    // phase, the same construction shdr-22 uses\n    for (int j = 0; j < TURB; j++) {\n      float dj = float(j) + 1.0;\n      a += torsionTurb * sin(roundv(a * dj) - shimmer).zxy / dj;\n    }\n\n    /*\n      The axial density. At uP_column 0 this is the listing's\n      length(a.xz) \u2014 distance from the twist axis, so the step collapses\n      along the pole and the axis burns as a column. At 1 it is the plain\n      radial length and the column dissolves into shells.\n    */\n    float d = uP_stepScale * mix(length(a.xz), length(a), uP_column);\n    d = max(d, uP_envRadius * 0.003);\n\n    /*\n      The march's own colour code, from the listing: red constant, green\n      by DEPTH into the ball, blue by STEP INDEX \u2014 the opposite assignment\n      from shdr-22, and the reason this orb runs cyan-blue where that\n      one runs red-green. Blue gets twice the clamp headroom: its ramp\n      runs to STEPS (50) where red is fixed at 3, and an equal clamp would\n      crush the step gradient first.\n    */\n    vec3 w = vec3(3.0, (z - uP_camDist + uP_envRadius) * uP_hueDepth, float(it) * uP_hueStep) / d;\n    w = min(w, vec3(uP_stepClamp) * vec3(1.0, 1.0, 2.0));\n\n    /*\n      Normalize the clamped weight back to family units, exactly as in\n      shdr-22: without this line the clamp value leaks into total\n      energy and Exposure, Body fill and Diffusion all change meaning\n      whenever the clamp moves.\n    */\n    w *= 20.0 / max(uP_stepClamp, 1.0);\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(world));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    z += d;\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  torsionTurb = uP_turb * (1.0 + 0.5 * uInput);\n  torsionExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n  // the ball winds tighter while the agent speaks\n  torsionTwist = uP_twist * (1.0 + 0.4 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      acc += torsionRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = torsionRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the envelope and transmittance change the\n  // accumulator's scale, so the golfed /1e4 knee is a tunable here\n  vec3 col = tanh3(acc / max(torsionExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue tail\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Cell shimmer", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "wave", label: "Wave speed", min: 0, max: 8, step: 0.03, default: 0.7, integrate: true },
    { key: "twist", label: "Twist", min: 0, max: 8, step: 0.02, default: 1 },
    { key: "spin", label: "Roll", min: 0, max: 3, step: 0.015, default: 0.1, integrate: true },
    { key: "tilt", label: "Axis lean", min: -1.5, max: 1.5, step: 0.015, default: 0.3 },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.1, default: 2.25 },
    { key: "turb", label: "Cell turbulence", min: 0, max: 5, step: 0.03, default: 1 },
    { key: "column", label: "Column release", min: 0, max: 1, step: 0.01, default: 0 },
    { key: "stepScale", label: "Step scale", min: 0.005, max: 1.5, step: 0.005, default: 0.1 },
    { key: "hueDepth", label: "Depth hue", min: 0, max: 10, step: 0.03, default: 0.75 },
    { key: "hueStep", label: "Step hue", min: 0, max: 10, step: 0.03, default: 0.45 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 0.88 },
    { key: "fill", label: "Body fill", min: 0, max: 100, step: 0.3, default: 0.15 },
    { key: "stepClamp", label: "Step clamp", min: 3, max: 5000, step: 10, default: 400 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.01 },
    { key: "exposure", label: "Exposure", min: 1.5, max: 5000, step: 5, default: 60 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1.3 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.15 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    Staged on the twist, which is the orb's whole subject: how many turns
    of winding sit between the core and the surface. The wave clock is the
    second lever — how fast that winding travels out through the shells —
    and both are phase-safe (twist is a scale on radius, not on a clock).
  */
  statePresets: {
    // at rest: a slow half-turn of winding drifting outward
    idle: {
      speed: 0.5,
      wave: 0.7,
      twist: 1,
      turb: 1,
      column: 0,
      exposure: 60,
      scatter: 0.01,
      alphaGain: 2
    },
    /*
      searching: the ball WINDS UP — three and a half times the twist, so
      the shells shear hard against each other — while the wave almost
      stops. Exposure goes UP, not down: a wound spring is stored energy,
      and this state is the darkest of the three on purpose.
    */
    thinking: {
      speed: 1.5,
      wave: 0.15,
      twist: 3.6,
      turb: 1.35,
      column: 0,
      exposure: 88,
      scatter: 0.011,
      alphaGain: 2
    },
    /*
      answering: the winding UNWINDS to a third of idle and the wave races
      out through the shells at more than four times idle — the tension
      released outward — with the column let go and the knee less than a
      third of the thinking state's. The release is the bright one.
    */
    speaking: {
      speed: 0.9,
      wave: 3.2,
      twist: 0.35,
      turb: 0.85,
      column: 0.45,
      exposure: 26,
      scatter: 0.006,
      alphaGain: 2.7
    }
  },
  // the march colour-codes itself, so the tint only shifts temperature:
  // neutral at rest, cooled while searching, warmed while answering
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#9db8ff" },
    speaking: { tint: "#ffc492" }
  }
},
  "shdr-08": {
  key: "shdr-08",
  label: "SHDR-08",
  note: "mother-of-pearl contour bands, each layer its own hue",
  frag: "\n#define OCTAVES 10\n#define AA 2\n\nconst float TAU = 6.28318530718;\n\n// The listing's +r, minus the resolution dependence (see the header).\nconst vec2 SEED = vec2(4.7, 2.3);\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat nacreWarp;\nfloat nacreThick;\nfloat nacreGain;\n\n/*\n  The listing's entire tone map: o = tanh(.2 / tan(x)); o *= o.\n\n  The square folds the sign, so abs() on the denominator is not an\n  approximation here \u2014 it is exact, and it removes the branch.\n*/\nvec3 cotBands(vec3 x, float k) {\n  vec3 b = tanh3(k * cos(x) / max(abs(sin(x)), vec3(1e-4)));\n  return b * b;\n}\n\nvec3 nacreRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n  vec3 n = vec3(pl, z);\n\n  float t = uP_speed; // integrated clock: the boil\n\n  /*\n    Stereographic projection, on the UNROTATED dome. Equal steps in screen\n    space map to ever-larger steps in pattern space toward the rim, which\n    is the foreshortening that sells a flat field as wrapped geometry.\n    uP_bulge softens the divisor \u2014 higher flattens the shell back toward a\n    disc, lower crowds the layers into the limb.\n  */\n  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;\n\n  // projection-safe 2D motion, in place of a dome spin: the plane turns,\n  // and the bands travel across themselves\n  float sw = uP_swirl; // integrated clock\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n  p.y -= uP_flow;      // integrated clock\n\n  /*\n    The ten-octave feedback warp. q is fed back into itself with the\n    components swapped, so each octave curls what the last one drew.\n  */\n  vec2 q = p;\n  for (int j = 0; j < OCTAVES; j++) {\n    float i = float(j) + 1.0;\n    q += nacreWarp * sin(q.yx * i + i * i + t * i + SEED) / i;\n  }\n\n  // the bands, with the listing's uneven per-channel phase kept as a ratio\n  // so one slider widens the whole split\n  vec3 band = cotBands(vec3(q.y) + vec3(0.0, 1.0, 3.0) * uP_split, nacreThick);\n  float lev = dot(band, vec3(1.0 / 3.0));\n\n  /*\n    A dark body colour under the bands, so the valleys read as the shell\n    itself rather than as holes punched through the ball. The band term\n    stays PER-CHANNEL through the palette multiply \u2014 that is what carries\n    the colour fringing; collapsing it to lev first would throw away the\n    only thing the vec4 phase was for.\n  */\n  vec3 col = uC_deep * uP_floor;\n  col += band * mix(uC_low, uC_crest, smoothstep(0.1, 0.9, lev)) * nacreGain;\n\n  /*\n    Thin-film interference. The cosine palette is keyed to the band\n    coordinate, so every layer carries its own hue \u2014 the inside of a shell\n    \u2014 and uP_view rotates that hue with the viewing angle through 1 - z,\n    which means the sphere's curvature is doing the colouring. Multiplied\n    in rather than mixed to, so it bends hues without erasing the palette.\n  */\n  vec3 irid = 0.5 + 0.5 * cos(TAU * (q.y * uP_irisScale + (1.0 - z) * uP_view + t * 0.03 + vec3(0.0, 0.33, 0.67)));\n  col = mix(col, col * (0.25 + 1.9 * irid), uP_iris);\n\n  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));\n\n  // dome shading keeps the ball a ball under the pattern\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.35 + uP_light * lambert;\n\n  // fresnel sheen: the wet gloss of a shell, and the thing that keeps the\n  // limb reading as a surface where the bands have compressed to a blur\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  /*\n    The BEAT: warp driven between 0.6 and 1.8 on a slow, unbroken cycle \u2014\n    one full swing every second and a third \u2014 with nothing held at either\n    end. Warp is the amplitude of the octave loop that folds the bands, so\n    sweeping it three to one makes the whole field draw in and open again\n    rather than change colour or brightness \u2014 a swell, not a flash.\n\n    Absolute bounds, so the range is exactly the range; that is why the mix\n    sits outside the volume term below. At beat zero nothing here applies\n    and the dialled warp stands, so a state that does not ask for it is\n    untouched.\n\n    Well under 3Hz, which matters: above that a full-field oscillation is\n    in the band photosensitivity guidance warns about, and this one covers\n    the whole ball. The rate is the constant below \u2014 raising it much past\n    18 walks back into that range.\n  */\n  float beat = 0.5 - 0.5 * cos(uAnim * 5.0);\n\n  // Volume coupling: the user's voice churns the warp harder, the agent's\n  // widens the crests and brightens them.\n  nacreWarp = mix(uP_warp * (1.0 + 0.45 * uInput), mix(0.6, 1.8, beat), uP_beat);\n  nacreThick = uP_thick * (1.0 + 0.6 * uOutput);\n  nacreGain = uP_gain * (0.85 + 0.4 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  // Nothing outside the silhouette is ever visible, so skip AA * AA warps\n  // for it rather than shading transparent sky.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += nacreRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = nacreRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Boil", min: 0.015, max: 10, step: 0.05, default: 0.35, integrate: true },
    { key: "flow", label: "Band drift", min: 0, max: 5, step: 0.03, default: 0.25, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.06, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Pattern scale", min: 0.3, max: 20, step: 0.1, default: 5.5 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "warp", label: "Warp", min: 0, max: 3, step: 0.02, default: 1 },
    { key: "beat", label: "Warp beat", min: 0, max: 1, step: 0.01, default: 0 },
    { key: "thick", label: "Band width", min: 0.02, max: 2, step: 0.01, default: 0.2 },
    { key: "split", label: "Chromatic split", min: 0, max: 1, step: 0.005, default: 0.1 },
    { key: "iris", label: "Iridescence", min: 0, max: 2, step: 0.01, default: 0.7 },
    { key: "irisScale", label: "Iridescence scale", min: 0, max: 2, step: 0.005, default: 0.315 },
    { key: "view", label: "Angle shift", min: 0, max: 3, step: 0.01, default: 1.34 },
    { key: "floor", label: "Body fill", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "gain", label: "Brightness", min: 0.05, max: 5, step: 0.05, default: 1.1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.15 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.75 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.5 }
  ],
  /*
   * Four stops: the shell body the bands sit on, the two ends of the band
   * ramp, and the fresnel sheen. The iridescence multiplies a rainbow over
   * all of them, so the palette sets the mood and the shimmer supplies the
   * rest of the hues.
   */
  colors: [
    { key: "deep", label: "Shell body", default: "#0d1430" },
    { key: "low", label: "Dim layer", default: "#2fb8c6" },
    { key: "crest", label: "Bright layer", default: "#fff1de" },
    { key: "sheen", label: "Sheen", default: "#bfe4ff" }
  ],
  /*
    Staged on the two levers that are phase-safe integrated clocks — the
    boil and the band drift — plus band width, which is the orb's loudest
    single control: narrow crests read as taut lines, wide ones flood the
    shell with light.

    IRIDESCENCE SCALE AND ANGLE SHIFT ARE ALL BUT FIXED, and the reason
    matters. Both multiply their way into the cosine that makes the
    thin-film rainbow, so they are spatial FREQUENCIES, not amounts: easing
    one across a wide span sweeps the field through every frequency in
    between, which races the fringes across the shell instead of
    cross-fading them. Pattern scale is held fixed here for the same reason,
    as are cell count in shdr-05 and lattice spacing in shdr-06.

    So they live on the params above, where resting and answering take them
    untouched. Searching nudges them and only just — scale to 0.83 of the
    fixed value, angle shift to 0.90 — which moves the fringes by well under
    one of their own periods, and reads as the shimmer settling rather than
    as a scramble. That margin is the whole budget: a state that wanted
    twice or a third of these would have to snap them, not glide.

    Iridescence itself — the amount — is safe to stage at any span: it is a
    plain mix toward the same rainbow, so it fades rather than moves.
  */
  statePresets: {
    /*
      at rest: slow and BRIGHT. The clocks stay gentle — a slow boil, the
      layers barely drifting — which is what still reads as at rest, but
      everything about the surface is turned up under them. Crests run wide,
      three quarters of the answering state's width, on more than twice the
      default brightness and the highest gain of the three.

      The shimmer carries the rest: iridescence near half again its default,
      laid over the fixed scale and angle shift the staging note above keeps
      out of the presets — the rainbow swings hard as the dome curves away,
      and it does so identically in all three states. The dome is bulged
      well past default and the body fill pulled back beneath it, so the
      light sits in the bands rather than in the shell behind them.
    */
    idle: {
      speed: 0.37,
      flow: 0.24,
      swirl: 0.06,
      bulge: 0.8,
      warp: 0.96,
      thick: 0.54,
      split: 0.1,
      iris: 1.02,
      floor: 0.57,
      gain: 2.45,
      contrast: 1.65,
      rim: 0.495
    },
    /*
      searching: the field CHURNS in place — boil at over four times resting,
      warp half again — while the layers all but stop drifting, a quarter of
      resting's flow on a third of its swirl. Crests hold exactly resting's
      width, so nothing about the BANDS says searching; what says it is that
      they are boiling hard and going nowhere.

      The shimmer is the other half of it: iridescence at nearly twice
      resting's, the strongest of the three by a wide margin, over a split
      that answering now matches. And still deliberately the dimmest —
      tension reads as held light, not spent light.
    */
    thinking: {
      speed: 1.61,
      flow: 0.06,
      swirl: 0.015,
      warp: 1.56,
      thick: 0.54,
      split: 0.3,
      iris: 1.89,
      irisScale: 0.26,
      view: 1.21,
      floor: 0.77,
      gain: 0.85,
      contrast: 1.65,
      rim: 0.495
    },
    /*
      answering: the field SWELLS and TRAVELS. Warp is on the beat at full
      depth, swinging 0.6 to 1.8 across a second and a third with nothing
      held at either end, so the bands draw in and open again slowly enough
      to watch — that swell IS the state, and the dialled warp below is only
      what you would see with the beat off.

      Under it everything is moving: the fastest boil of the three, and the
      hardest drift anywhere in this orb at ten times resting's, on crests
      pulled to half the width the other two both hold. Iridescence drops to
      the lowest of the three while the split opens out to match searching's
      — so this state spends its light on MOVEMENT rather than on shimmer,
      which is what keeps the two apart now that both run their bands hard.
    */
    speaking: {
      speed: 2,
      flow: 2.49,
      swirl: 0.18,
      warp: 1.84,
      beat: 1,
      thick: 0.27,
      split: 0.3,
      iris: 0.45,
      gain: 1.75,
      contrast: 0.78
    }
  },
  // abalone at rest, cold pearl while searching, warm fire-opal while
  // answering — the at-a-glance read, as in the sibling orbs
  stateColors: {
    idle: {
      deep: "#0d1430",
      low: "#2fb8c6",
      crest: "#fff1de",
      sheen: "#bfe4ff"
    },
    thinking: {
      deep: "#0a0f2c",
      low: "#6f7cff",
      crest: "#dfe8ff",
      sheen: "#9fd0ff"
    },
    speaking: {
      deep: "#2a0f22",
      low: "#ff7a4d",
      crest: "#fff0c9",
      sheen: "#ffc9a8"
    }
  }
},
  "shdr-09": {
  key: "shdr-09",
  label: "SHDR-09",
  note: "torn rings of rainbow light worn as the ball's latitudes",
  frag: "\n#define RINGS 10\n#define TURB 9\n#define AA 2\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat irisWarp;\nfloat irisGlow;\nfloat irisFringe;\n\nvec3 irisRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n  vec3 n = vec3(pl, z);\n\n  float t = uP_speed; // integrated clock\n\n  // tilt about X, then roll about Y on its own integrated clock\n  float ct = cos(uP_tilt);\n  float st = sin(uP_tilt);\n  vec3 sp = vec3(n.x, n.y * ct - n.z * st, n.y * st + n.z * ct);\n  float cr = cos(uP_spin);\n  float sr = sin(uP_spin);\n  sp = vec3(sp.x * cr - sp.z * sr, sp.y, sp.x * sr + sp.z * cr);\n\n  /*\n    Radius becomes the polar angle from the dome's axis (see the header),\n    so ring i lands on the latitude at angle i / uP_scale and the rings\n    crowd toward the limb the way a globe's latitudes do. acos is defined\n    on the whole sphere, so the roll above can put the axis anywhere \u2014\n    including behind the visible face, which sweeps the outer rings into\n    view over the limb.\n  */\n  float pol = acos(clamp(sp.z, -1.0, 1.0));\n  vec2 dir = sp.xy / max(length(sp.xy), 1e-4);\n  vec2 p = dir * pol * uP_scale;\n\n  vec3 acc = vec3(0.0);\n\n  for (int ri = 0; ri < RINGS; ri++) {\n    float i = float(ri) + 1.0;\n\n    /*\n      Each ring re-warps the ORIGINAL point with its own seed, exactly as\n      the listing does \u2014 this loop is why the rings tear differently\n      instead of nesting like tree rings.\n    */\n    vec2 v = p;\n    for (int j = 0; j < TURB; j++) {\n      float f = float(j) + 1.0;\n      v += irisWarp * sin(ceil(v * f + i * uP_seed) - t * 0.5) / f;\n    }\n\n    float l = length(v) - i;\n\n    // the asymmetric absolute value, with the floor doubling as the line\n    // width \u2014 a wider floor is a fatter, softer wavefront\n    float side = max(max(l, -uP_inner * l), uP_lineSoft);\n\n    /*\n      The hue sweep, softened. l/(l*l+g) tracks 1/l off the ring and rolls\n      over to a finite peak on it, so the rainbow compresses into a fringe\n      of finite width instead of an aliased band.\n    */\n    float fr = irisFringe * l / (l * l + uP_fringeSoft);\n    vec3 hue = cos(t - i * uP_ringPhase + fr + vec3(0.0, 1.0, 2.0)) + 1.1;\n\n    acc += (irisGlow / side) * hue;\n  }\n\n  // the listing's tanh knee, with the divisor exposed\n  vec3 col = tanh3(acc / max(uP_exposure, 0.001));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // dome shading keeps the ball a ball under the rings \u2014 gentler than the\n  // sibling orbs use, because these rings are emission and a hard lambert\n  // reads as a shadow thrown across a light source\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.55 + uP_light * lambert;\n\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice tears the rings harder, the agent's\n  // brightens them and opens the rainbow fringe.\n  irisWarp = uP_warp * (1.0 + 0.5 * uInput);\n  irisGlow = uP_glow * (0.85 + 0.5 * uOutput);\n  irisFringe = uP_fringe * (1.0 + 0.6 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  // Ninety sines per sample before supersampling \u2014 none of them worth\n  // paying for outside the silhouette.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += irisRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = irisRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.6, integrate: true },
    { key: "spin", label: "Roll", min: 0, max: 3, step: 0.015, default: 0.12, integrate: true },
    { key: "tilt", label: "Tilt", min: -1.5, max: 1.5, step: 0.015, default: 0.4 },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Ring spacing", min: 0.3, max: 20, step: 0.1, default: 3.5 },
    { key: "warp", label: "Tear", min: 0, max: 3, step: 0.02, default: 0.45 },
    { key: "seed", label: "Ring seed", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "glow", label: "Ring glow", min: 0, max: 1, step: 0.002, default: 0.05 },
    { key: "lineSoft", label: "Ring width", min: 0.002, max: 1, step: 0.002, default: 0.05 },
    { key: "inner", label: "Inner falloff", min: 0.2, max: 12, step: 0.05, default: 3 },
    { key: "fringe", label: "Rainbow fringe", min: 0, max: 2, step: 0.005, default: 0.1 },
    { key: "fringeSoft", label: "Fringe width", min: 0.001, max: 1, step: 0.001, default: 0.003 },
    { key: "ringPhase", label: "Ring hue step", min: 0, max: 3, step: 0.01, default: 0.8 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 20, step: 0.05, default: 1.1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.2 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.5 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.4 }
  ],
  colors: [
    { key: "tint", label: "Tint", default: "#ffffff" },
    { key: "sheen", label: "Sheen", default: "#b9d6ff" }
  ],
  /*
    Staged on the two things the rings own: how hard they TEAR, and how
    wide the wavefront is. Ring spacing never moves between states — it
    sets how many rings are on the ball, and a gliding count reads as the
    ball inflating rather than as a change of mood.
  */
  statePresets: {
    // at rest: slow, softly torn, wide calm wavefronts
    idle: {
      speed: 0.6,
      spin: 0.12,
      warp: 0.45,
      glow: 0.05,
      lineSoft: 0.05,
      fringe: 0.1,
      exposure: 1.1,
      contrast: 1.15
    },
    /*
      searching: the rings tear right open — warp near six times idle — and
      broaden rather than thin, so the ball reads as churning instead of
      brittle. The rainbow fringe runs almost to full and softens by two
      orders of magnitude, which is what turns the tears into wide spectral
      bands; exposure, saturation and the rim all lift together to keep that
      readable. Speed and spin sit at the schema defaults, so the ball keeps
      idle's rotation and the whole change reads in the surface, not the
      motion.
    */
    thinking: {
      warp: 2.54,
      glow: 0.2,
      lineSoft: 0.152,
      fringe: 0.96,
      fringeSoft: 0.854,
      ringPhase: 2.53,
      exposure: 1.75,
      contrast: 1.15,
      saturation: 2.22,
      light: 1.035,
      rim: 0.66
    },
    /*
      answering: the tears RELAX to half idle's and the wavefronts broaden
      to four times it — bands of light rather than rings — but the ball is
      travelling under them at near eight times idle speed, the fastest of
      the three by a wide margin. Broad calm shapes moving fast, which is
      the opposite of searching's tight shapes churning in place.

      The colour comes off the FRINGE rather than the glow: eight times
      idle's fringe strength on twenty times its width, with the ring glow
      pulled just under idle's and the knee down, so the light gathers in
      the spectral edges instead of flooding the rings themselves. The key
      light doubles to keep a dome under all that, and the rim sheen is off
      almost entirely.

      Note the RING SEED is staged here, and it is the one value in this
      preset that cannot glide: it sits inside a ceil() in the octave loop,
      so it quantizes, and easing it across a state change steps rather than
      fades. The move is small — 0.9 to 1.02 — but if the transition pops,
      that is what is popping, and the fix is to hold it equal in all three
      states rather than to slow it down.
    */
    speaking: {
      speed: 4.7,
      spin: 0.34,
      warp: 0.22,
      seed: 1.02,
      glow: 0.04,
      lineSoft: 0.22,
      fringe: 0.81,
      fringeSoft: 0.058,
      ringPhase: 1.03,
      exposure: 0.68,
      contrast: 0.85,
      light: 0.99,
      rim: 0.015
    }
  },
  // the rings supply their own rainbow, so the tint only shifts its
  // temperature: neutral at rest, cooled while searching, warmed while
  // answering
  stateColors: {
    idle: { tint: "#ffffff", sheen: "#b9d6ff" },
    thinking: { tint: "#9db8ff", sheen: "#7ba6ff" },
    speaking: { tint: "#ffc492", sheen: "#ffb277" }
  }
},
  "shdr-10": {
  key: "shdr-10",
  label: "SHDR-10",
  note: "a lattice of light knitted into the ball's own skin",
  frag: "\n#define STEPS 40\n#define TURB 6\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat weaveTurb;\nfloat weaveCell;\nfloat weaveExposure;\n\nvec3 weaveRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float animTime = uP_speed;  // integrated clock: the warp\n  float scroll = uP_scroll;   // integrated clock: the skin climbs\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back \u2014 the near skin veils the far one\n  float T = 1.0;\n\n  // march only the span the envelope can light, as in shdr-01\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  for (int it = 0; it < STEPS; it++) {\n    float fi = float(it) + 1.0;\n    vec3 world = ro + rd * z;\n\n    /*\n      The unwrap, with the listing's cylinder swapped for the ball: angle\n      about the axis, height, and distance from the CENTRE less the shell\n      radius. uP_wrap wants to stay a whole number \u2014 see the header.\n    */\n    float rl = length(world);\n    vec3 p = vec3(\n      atan(world.z, world.x) * uP_wrap,\n      world.y * uP_climb + scroll,\n      rl - uP_shellR\n    );\n\n    // six octaves of feedback warp, each march step on its own phase\n    for (int j = 0; j < TURB; j++) {\n      float dj = float(j) + 1.0;\n      p += weaveTurb * sin(p.yzx * dj + animTime + uP_layer * fi) / dj;\n    }\n\n    /*\n      The lattice. Small only where all three cosines sit at one and the\n      sample is on the shell \u2014 so the cells of a 3D lattice in unwrapped\n      space are cut by the ball's surface, and what is left is a knitted\n      skin. uP_cell is the listing's .3: the amplitude of the cosine terms\n      against the shell term, and therefore how much the lattice matters\n      relative to simply being on the surface.\n    */\n    float d = uP_stepScale * length(vec4(weaveCell * cos(p) - weaveCell, p.z));\n    d = max(d, uP_envRadius * 0.004);\n\n    // colour by unwrapped height, with each step offset again\n    vec3 w = cos(p.y + fi * uP_hueStep + vec3(6.0, 1.0, 2.0) * uP_spread) + 1.0;\n    w /= d;\n    w = min(w, vec3(uP_stepClamp));\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, rl);\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    z += d;\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  weaveTurb = uP_turb * (1.0 + 0.4 * uInput);\n  weaveCell = uP_cell * (1.0 + 0.3 * uInput);\n  weaveExposure = uP_exposure * (1.0 - 0.3 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      acc += weaveRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = weaveRender(gl_FragCoord.xy);\n#endif\n\n  /*\n    The listing's knee is tanh(o*o/6e3) over an unnormalized sum of forty\n    steps. Dividing by the step count first pulls the square's scale down\n    by forty squared, so the same knee lands near four \u2014 a number that fits\n    on a slider. The square is a contrast squarer, not a tone map.\n  */\n  vec3 v = acc / float(STEPS);\n  vec3 col = tanh3(v * v / max(weaveExposure, 0.0001));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue thread\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.6, integrate: true },
    { key: "scroll", label: "Climb", min: 0, max: 8, step: 0.03, default: 1.2, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.05, default: 2 },
    { key: "shellR", label: "Shell radius", min: 0.2, max: 20, step: 0.1, default: 2.6 },
    { key: "wrap", label: "Wraps around", min: 1, max: 14, step: 1, default: 8 },
    { key: "climb", label: "Band spacing", min: 0.05, max: 12, step: 0.05, default: 4 },
    { key: "turb", label: "Warp", min: 0, max: 3, step: 0.02, default: 0.35 },
    { key: "layer", label: "Layer offset", min: 0, max: 2, step: 0.01, default: 0.5 },
    { key: "cell", label: "Lattice weight", min: 0, max: 2, step: 0.01, default: 0.45 },
    { key: "stepScale", label: "Step scale", min: 0.02, max: 3, step: 0.005, default: 0.15 },
    { key: "hueStep", label: "Layer hue", min: 0, max: 3, step: 0.01, default: 0.4 },
    { key: "spread", label: "Colour spread", min: 0, max: 3, step: 0.02, default: 1 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 20, step: 0.1, default: 2.9 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 0.92 },
    { key: "fill", label: "Body fill", min: 0, max: 40, step: 0.05, default: 0.1 },
    { key: "stepClamp", label: "Step clamp", min: 5, max: 5000, step: 5, default: 300 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.2, step: 0.0005, default: 0.004 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 500, step: 0.5, default: 30 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.05, default: 1.15 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.2 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    Staged on LATTICE WEIGHT, which decides whether the ball wears a knitted
    net or a smooth shell, and on the two clocks, which are integrated and
    so change rate without ever jumping phase.

    THE LAYER OFFSET IS STAGED ONLY ON A BUDGET, and the budget is
    arithmetic rather than taste. It multiplies the SAMPLE INDEX inside the
    warp — sin(... + uP_layer * fi), with fi running to forty — so it is a
    phase rate across the stack, not an amount: a step of D moves the
    deepest sample by 40*D radians while the nearest barely moves. The old
    0.5 -> 2 stage was 60 radians, nine and a half turns, and the skin
    boiled through every arrangement in between instead of cross-fading.

    Hold |D| at or under 2*PI/40, about 0.157, and even the deepest sample
    travels less than one full turn, which reads as the layers settling.
    Resting sits at 0.5 and searching at 0.65 — 0.15, just inside it — and
    answering stays at 0.5, so every transition in the set is within one
    turn. Anything wider has to be reached with lattice weight and warp
    instead: both are plain amplitudes, and both glide cleanly.

    COLOUR SPLIT is staged on the same budget and the same reasoning. It
    scales a fixed vec3 inside the hue cosine, so its worst channel moves
    six radians per unit; searching's step of 0.55 is about half a turn on
    that channel, which crossfades. A step past one unit would not.

    Wraps around never moves either: it must stay a whole number or the seam
    opens, and a slider gliding through 1.5 would tear the ball open in the
    middle of a transition. Band spacing and layer hue are held for the same
    class of reason — both are frequencies read off a coordinate.
  */
  statePresets: {
    // at rest: an open net climbing slowly
    idle: {
      speed: 0.6,
      scroll: 1.2,
      turb: 0.35,
      cell: 0.45,
      exposure: 30,
      scatter: 0.004,
      alphaGain: 2
    },
    /*
      searching: the net DECOHERES. Three things pull in the same direction.
      Lattice weight drops to two thirds of resting's, so the cosine terms
      no longer close hard on their cells; the warp runs at nearly two and a
      half times resting and churns what is left of them; and the layer
      offset steps up by 0.15 — the whole phase budget above, and as far as
      the forty samples can be pushed out of agreement without the
      transition boiling.

      And it is BRIGHT. The knee drops to well under half resting's — near
      answering's, so this is no longer the dim state — with saturation
      raised half again over resting, contrast pulled back so nothing
      crushes, and the colour split opened to 1.55, which spreads the three
      channels further apart in phase and is what turns the decohering skin
      into full spectrum rather than a blue haze. The tint goes with it:
      near white with only a cool cast, where a saturated blue would have
      thrown all that colour away again.

      Step scale drops to two thirds under all of it, so the ray resolves
      finer detail over less depth, and the diffusion stays low enough that
      the far side still shows through.
    */
    thinking: {
      speed: 1.9,
      scroll: 0.5,
      turb: 0.85,
      layer: 0.65,
      cell: 0.3,
      stepScale: 0.09,
      spread: 1.55,
      fill: 0.12,
      exposure: 13,
      scatter: 0.006,
      contrast: 1.05,
      saturation: 1.7,
      alphaGain: 2.6
    },
    /*
      answering: the net SNAPS IN. Lattice weight goes to more than twice
      resting's and nearly five times searching's, so the cells close hard
      and the skin reads as knitted rope rather than gauze, with the warp
      down to a fifth of searching's so nothing blurs it.

      And it CLIMBS: the scroll clock runs three and a half times resting's,
      the fastest of the three, so the whole net travels up the ball while
      holding its shape. The knee drops to a quarter of searching's and the
      alpha gain lifts — this is unmistakably the bright state.
    */
    speaking: {
      speed: 1,
      scroll: 4.2,
      turb: 0.18,
      cell: 0.95,
      exposure: 11,
      scatter: 0.0015,
      contrast: 0.9,
      saturation: 1.45,
      alphaGain: 2.8
    }
  },
  // the height ramp supplies the colour, so the tint only shifts its
  // temperature: neutral at rest, barely cooled while searching — a
  // saturated blue there would cancel the colour split that state is built
  // on — and warmed while answering
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#e8f4ff" },
    speaking: { tint: "#ffc492" }
  }
},
  "shdr-11": {
  key: "shdr-11",
  label: "SHDR-11",
  note: "quantum orbital, rainbow chroma",
  frag: "\nconst float PI = 3.14159265359;\nvoid main() {\n  vec2 uv = orbUV();\n  float r2d = length(uv);\n  float R = uP_radius + uP_swell * uInput;\n  float mask = smoothstep(0.012, -0.012, r2d - R);\n  float nr = clamp(r2d / max(R, 0.001), 0.0, 1.0);\n  float z = sqrt(max(1.0 - nr * nr, 0.0));\n\n  // uP_speed and uP_flowSpeed arrive pre-integrated as clocks (see\n  // OrbParamDef.integrate), so state transitions stay phase-continuous.\n  // The state volumes reshape the orbital itself: the params set the base,\n  // input/output excitement bends zoom, radial form, probability and chroma,\n  // so each state settles into a different interference pattern.\n  float posScale = uP_posScale * (0.8 + 0.45 * uOutput + 0.2 * uInput);\n  float radialPow = uP_radialPow * (0.7 + 0.8 * uOutput);\n  float radialDecay = uP_radialDecay * (1.25 - 0.5 * uOutput);\n  float probPow = uP_probPow * (1.3 - 0.55 * uOutput);\n  float probGain = uP_probGain * (0.7 + 0.6 * uOutput + 0.5 * uInput);\n  float waveFreq = uP_waveFreq * (0.6 + 1.0 * uOutput);\n  float chromaSpread = uP_chromaSpread * (0.6 + 0.9 * uOutput + 0.5 * uInput);\n\n  // dome point rotated around Y \u2014 the fake 3D of the flat disc\n  float animTime = uP_speed; // integrated clock\n  float cosT = cos(animTime * uP_rotSpeed);\n  float sinT = sin(animTime * uP_rotSpeed);\n  vec3 sp = vec3(uv / max(R, 0.001), z) * posScale;\n  vec3 pos = vec3(sp.x * cosT - sp.z * sinT, sp.y, sp.x * sinT + sp.z * cosT);\n\n  // precession: the rotation axis itself drifts, so the pattern never\n  // settles into a repeating spin\n  float tilt = sin(animTime * 0.21 + 1.7) * uP_precess;\n  float cx = cos(tilt), sx = sin(tilt);\n  pos = vec3(pos.x, pos.y * cx - pos.z * sx, pos.y * sx + pos.z * cx);\n\n  // liquid flow: drifting fbm warps the 3D domain, so the wave function\n  // smears and migrates around the sphere instead of wobbling in place.\n  // (sampled on pos components \u2014 continuous everywhere, no phi seam)\n  float flowT = uP_flowSpeed; // integrated clock\n  float fAmp = uP_flowAmp * (0.7 + 0.6 * uOutput + 0.4 * uInput);\n  vec3 w;\n  w.x = fbm(pos.yz * uP_flowScale + vec2(flowT * 0.70, -flowT * 0.40));\n  w.y = fbm(pos.zx * uP_flowScale + vec2(-flowT * 0.55, flowT * 0.62) + 3.7);\n  w.z = fbm(pos.xy * uP_flowScale + vec2(flowT * 0.50, flowT * 0.85) + 7.1);\n  pos += (w - 0.5) * fAmp;\n\n  float r = length(pos) + 0.001;\n  float theta = acos(clamp(pos.y / r, -1.0, 1.0));\n  float phi = atan(pos.z, pos.x);\n\n  float a0 = 0.5;\n  float rho = 2.0 * r / (5.0 * a0);\n  float radial = pow(rho, radialPow) * exp(-rho / radialDecay);\n  float angular = pow(sin(theta), 3.0) * cos(phi + animTime * 0.2); // single lobe\n\n  float psi = radial * angular;\n  float probability = psi * psi;\n\n  // travelling spiral wave \u2014 the modulation moves across the surface instead\n  // of pulsing in place. The azimuthal harmonic count must be a whole number,\n  // else sin(phi * f) doesn't line up across the +/-PI wrap and leaves a\n  // vertical meridian seam. Snap it to the nearest integer.\n  float waveN = max(1.0, floor(waveFreq + 0.5));\n  float wavePhase = phi * waveN + theta * 2.5 - animTime * 2.0;\n  probability *= (0.85 + 0.15 * sin(wavePhase));\n\n  // drifting bright patches, like convection cells wandering the surface\n  float patches = fbm(pos.xy * 1.6 + vec2(flowT * 0.4, -flowT * 0.3));\n  probability *= 0.65 + 0.7 * patches;\n\n  probability = pow(probability, probPow) * probGain;\n  probability = clamp(probability, 0.0, 1.0);\n\n  float fresnel = pow(1.0 - z, 1.5);\n\n  // rainbow chromatic aberration\n  float chromaOffset = phi * 2.0 + theta * 1.5 + animTime * 0.3 + probability * 3.0;\n  vec3 rainbow;\n  rainbow.r = sin(chromaOffset) * 0.5 + 0.5;\n  rainbow.g = sin(chromaOffset + chromaSpread) * 0.5 + 0.5;\n  rainbow.b = sin(chromaOffset + chromaSpread * 2.0) * 0.5 + 0.5;\n  rainbow = normalize(rainbow + 0.01) * length(rainbow);\n\n  float bandFreq = chromaOffset * 3.0 + fresnel * 2.4;\n  vec3 chromaticBands;\n  chromaticBands.r = sin(bandFreq) * 0.5 + 0.5;\n  chromaticBands.g = sin(bandFreq + 2.094) * 0.5 + 0.5;\n  chromaticBands.b = sin(bandFreq + 4.189) * 0.5 + 0.5;\n\n  vec3 glowColor = mix(rainbow, chromaticBands, 0.12);\n  glowColor = pow(glowColor, vec3(0.8));\n\n  vec3 darkMetal = vec3(uP_metalDark);\n  vec3 lightMetal = mix(vec3(0.9, 0.92, 0.95), glowColor, 0.7);\n\n  float metalGradient = smoothstep(0.0, 1.0, probability * 0.7 + fresnel * 0.3);\n  vec3 metalColor = mix(darkMetal, lightMetal, metalGradient);\n\n  float orbGlow = uP_glow + 0.6 * uOutput;\n  float totalGlow = (0.25 + fresnel * 0.6 + probability * 0.8) * orbGlow;\n  float glowAmount = clamp(pow(totalGlow, 0.7), 0.0, 1.0);\n\n  vec3 surfaceColor = mix(metalColor, glowColor, glowAmount);\n\n  vec3 normal = vec3(uv / max(R, 0.001), z);\n  float specular = pow(max(dot(normal, normalize(vec3(1.0, 1.0, 2.0))), 0.0), 32.0);\n  surfaceColor += mix(vec3(1.0), glowColor, 0.6) * specular * 0.4;\n\n  float visibility = clamp(probability * 1.2 + fresnel * 0.3 + uP_baseVis + uInput * 0.15, 0.0, 1.0);\n\n  float a = mask * visibility;\n  gl_FragColor = vec4(surfaceColor * a, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.9, integrate: true },
    { key: "rotSpeed", label: "Rotation speed", min: 0, max: 5, step: 0.05, default: 0.5 },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "swell", label: "Input swell", min: 0, max: 1, step: 0.01, default: 0.07 },
    { key: "posScale", label: "Orbital zoom", min: 0.15, max: 10, step: 0.05, default: 0.5 },
    { key: "flowSpeed", label: "Flow speed", min: 0, max: 10, step: 0.05, default: 0.35, integrate: true },
    { key: "flowAmp", label: "Flow amount", min: 0, max: 4, step: 0.05, default: 0.45 },
    { key: "flowScale", label: "Flow scale", min: 0.3, max: 10, step: 0.1, default: 0.3 },
    { key: "precess", label: "Precession", min: 0, max: 4, step: 0.05, default: 0.3 },
    { key: "radialPow", label: "Radial power", min: 0.5, max: 15, step: 0.1, default: 0.5 },
    { key: "radialDecay", label: "Radial decay", min: 0.3, max: 30, step: 0.15, default: 1 },
    { key: "probPow", label: "Probability curve", min: 0.1, max: 3, step: 0.015, default: 0.4 },
    { key: "probGain", label: "Probability gain", min: 0.15, max: 15, step: 0.1, default: 3 },
    { key: "waveFreq", label: "Wave frequency", min: 0, max: 20, step: 0.5, default: 4 },
    { key: "chromaSpread", label: "Chroma spread", min: 0, max: 1.5, step: 0.01, default: 0.18 },
    { key: "glow", label: "Glow", min: 0, max: 5, step: 0.05, default: 0.9 },
    { key: "metalDark", label: "Metal darkness", min: 0, max: 3, step: 0.015, default: 0 },
    { key: "baseVis", label: "Base visibility", min: 0, max: 1.5, step: 0.01, default: 0.12 }
  ],
  colors: [],
  statePresets: {
    // idle look, tuned by hand — the schema defaults mirror this set
    idle: {
      speed: 0.9,
      rotSpeed: 0.5,
      radius: 0.9,
      swell: 0.07,
      posScale: 0.5,
      flowSpeed: 0.35,
      flowAmp: 0.45,
      flowScale: 0.3,
      precess: 0.3,
      radialPow: 0.5,
      radialDecay: 1,
      probPow: 0.4,
      probGain: 3,
      waveFreq: 4,
      chromaSpread: 0.18,
      glow: 0.9,
      metalDark: 0,
      baseVis: 0.12
    },
    // thinking: wider zoom, heavier flow, tighter shells, wide chroma —
    // restless but not loud
    thinking: {
      speed: 0.9,
      rotSpeed: 0.5,
      radius: 0.9,
      swell: 0.07,
      posScale: 0.65,
      flowSpeed: 0.35,
      flowAmp: 1.1,
      flowScale: 0.3,
      precess: 0,
      radialPow: 0.5,
      radialDecay: 1.9,
      probPow: 0.4,
      probGain: 3,
      waveFreq: 4,
      chromaSpread: 0.41,
      glow: 0.9,
      metalDark: 0,
      baseVis: 0.12
    },
    // speaking: fast anim, full zoom, quick fine-grained flow, strong
    // precession, bright gain — the loudest, most energetic pattern
    speaking: {
      speed: 2.45,
      rotSpeed: 0.5,
      radius: 0.9,
      swell: 0.07,
      posScale: 1,
      flowSpeed: 2.75,
      flowAmp: 0.8,
      flowScale: 2.2,
      precess: 1.3,
      radialPow: 0.5,
      radialDecay: 1,
      probPow: 0.31,
      probGain: 4.3,
      waveFreq: 4,
      chromaSpread: 0.12,
      glow: 0.9,
      metalDark: 0,
      baseVis: 0.12
    }
  }
},
  "shdr-12": {
  key: "shdr-12",
  label: "SHDR-12",
  note: "a ball of glossy toy bricks, studs up — it rebuilds itself while it thinks",
  frag: "\n#define STEPS 96\n\n// Per-fragment constants, resolved once in main().\nvec3 lgCell;  // cell sizes: (stud pitch, brick height, stud pitch)\nfloat lgGap;\n\n// Brick-lookup results (GLSL ES 1.0 has no out-struct ergonomics).\nvec3 lgBid;     // unique id of the owning brick\nfloat lgOff;    // long-axis stagger offset of its course, in studs\nfloat lgOrient; // 0: long axis runs along x, 1: along z\n\nmat2 lgRot(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\n/*\n  Which 2x4 brick owns this stud cell? Layers alternate their long axis\n  and every (layer, row) course staggers by a hashed offset \u2014 brickwork\n  bonding, so vertical seams never stack.\n*/\nvoid lgBrick(vec3 cellIdx) {\n  lgOrient = mod(cellIdx.y, 2.0);\n  float lc = lgOrient < 0.5 ? cellIdx.x : cellIdx.z;\n  float sc = lgOrient < 0.5 ? cellIdx.z : cellIdx.x;\n  float srow = floor(sc / 2.0);\n  lgOff = floor(hash(vec2(cellIdx.y * 3.17, srow * 7.31)) * 4.0);\n  lgBid = vec3(floor((lc + lgOff) / 4.0), cellIdx.y, srow + lgOrient * 913.0);\n}\n\n/*\n  The world function: inside the ball, minus bricks currently blinked out\n  of the outer two courses. Interior cells answer with a single length \u2014\n  the brick lookup only runs in the shell.\n*/\nfloat lgSolid(vec3 cc) {\n  float r = length(cc);\n  if (r >= 1.0) return 0.0;\n  if (r > 1.0 - 2.2 * lgCell.y) {\n    lgBrick(floor(cc / lgCell));\n    float blink = fract(hash(lgBid.xy * 0.173 + lgBid.z * 0.089) + uP_rebuild * 0.03);\n    if (blink < lgGap) return 0.0; // this brick is off the build right now\n  }\n  return 1.0;\n}\n\nvoid main() {\n  // Volume coupling: agent output stokes the sheen and the gain; user\n  // input brightens the key light.\n  float glossNow = uP_gloss * (0.7 + 0.9 * uOutput);\n  float gainNow = uP_gain * (0.92 + 0.25 * uOutput);\n  float lightNow = uP_light * (1.0 + 0.3 * uInput);\n\n  float pitch = 2.0 / clamp(uP_studs, 8.0, 48.0);\n  lgCell = vec3(pitch, pitch * 1.2, pitch); // real brick proportion\n  lgGap = clamp(uP_gap, 0.0, 0.9);\n\n  float bound = 1.0 + length(lgCell) * 0.5 + 0.001;\n\n  vec2 uv = orbUV() / uP_radius;\n  vec3 ro = vec3(uv * bound, 2.6);\n  vec3 rd = vec3(0.0, 0.0, -1.0);\n\n  // rotate the RAY into object space (inverse tumble) \u2014 the lattice stays\n  // axis-aligned and the studs stay up while the ball turns. Light and\n  // view rotate along, keeping the sun fixed relative to the viewer.\n  mat2 tiltM = lgRot(uP_tilt); // positive tilt looks DOWN at the studs\n  mat2 spinM = lgRot(-uP_spin); // integrated clock\n  ro.yz = tiltM * ro.yz;\n  ro.xz = spinM * ro.xz;\n  rd.yz = tiltM * rd.yz;\n  rd.xz = spinM * rd.xz;\n  vec3 Lo = normalize(vec3(-0.5, 0.7, 0.55));\n  Lo.yz = tiltM * Lo.yz;\n  Lo.xz = spinM * Lo.xz;\n  vec3 Vo = vec3(0.0, 0.0, 1.0);\n  Vo.yz = tiltM * Vo.yz;\n  Vo.xz = spinM * Vo.xz;\n\n  // DDA needs nonzero direction components \u2014 nudge, keep the sign\n  vec3 sgn = vec3(\n    rd.x >= 0.0 ? 1.0 : -1.0,\n    rd.y >= 0.0 ? 1.0 : -1.0,\n    rd.z >= 0.0 ? 1.0 : -1.0\n  );\n  rd = normalize(sgn * max(abs(rd), vec3(1.0e-4)));\n\n  // analytic bounding sphere: empty pixels exit here\n  float b = dot(rd, ro);\n  float c = dot(ro, ro) - bound * bound;\n  float disc = b * b - c;\n  if (disc < 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n  float sq = sqrt(disc);\n  vec3 p0 = ro + rd * (-b - sq + pitch * 0.001);\n  float tSpan = 2.0 * sq;\n\n  // Amanatides & Woo, anisotropic cells: per-axis sizes throughout\n  vec3 vp = floor(p0 / lgCell);\n  vec3 tDelta = lgCell / abs(rd);\n  vec3 tMax = ((vp + step(vec3(0.0), rd)) * lgCell - p0) / rd;\n\n  float hitF = 0.0;\n  vec3 mask = vec3(0.0, 0.0, 1.0); // first-voxel fallback: face the viewer\n  float tCur = 0.0;\n\n  for (int i = 0; i < STEPS; i++) {\n    if (lgSolid((vp + 0.5) * lgCell) > 0.5) {\n      hitF = 1.0;\n      break;\n    }\n    if (tMax.x < tMax.y && tMax.x < tMax.z) {\n      tCur = tMax.x;\n      tMax.x += tDelta.x;\n      vp.x += sgn.x;\n      mask = vec3(1.0, 0.0, 0.0);\n    } else if (tMax.y < tMax.z) {\n      tCur = tMax.y;\n      tMax.y += tDelta.y;\n      vp.y += sgn.y;\n      mask = vec3(0.0, 1.0, 0.0);\n    } else {\n      tCur = tMax.z;\n      tMax.z += tDelta.z;\n      vp.z += sgn.z;\n      mask = vec3(0.0, 0.0, 1.0);\n    }\n    if (tCur > tSpan) break; // left the bound: miss\n  }\n\n  if (hitF < 0.5) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  // the hit cell, its brick, and the struck face\n  vec3 cc = (vp + 0.5) * lgCell;\n  float r = length(cc);\n  vec3 dir = cc / max(r, 1.0e-4);\n  lgBrick(vp);\n  vec3 n = -mask * sgn;\n  vec3 hp = p0 + rd * tCur;\n\n  /*\n    Brick colour: a per-brick hash picks one of the five plastic colours.\n    The patch parameter slides the pick toward a smooth field over the\n    sphere, so 0 is per-brick confetti and 1 is big moulded colour\n    regions; the field is range-stretched so all five colours appear.\n  */\n  float cph = hash(lgBid.xy * 1.37 + lgBid.z * 0.91);\n  float rn = noise(dir.xy * 2.6 + 7.0) * 0.5 + noise(dir.yz * 2.6 + 13.0) * 0.5;\n  rn = clamp(0.5 + (rn - 0.5) * 2.2, 0.0, 0.999);\n  float idx = floor(clamp(mix(cph, rn, clamp(uP_patch, 0.0, 1.0)), 0.0, 0.999) * 5.0);\n  vec3 albedo = idx < 0.5 ? uC_brickA\n    : (idx < 1.5 ? uC_brickB\n    : (idx < 2.5 ? uC_brickC\n    : (idx < 3.5 ? uC_brickD : uC_brickE)));\n  albedo *= 0.93 + 0.14 * hash(lgBid.xy * 0.53 + lgBid.z * 1.7); // mold variance\n\n  /*\n    Seams: distance to the nearest BRICK boundary along each lattice axis,\n    from the continuous within-brick coordinates. Only the two axes\n    tangent to the struck face draw \u2014 stud grid lines never do.\n  */\n  vec3 sp = hp / lgCell;\n  float lcC = lgOrient < 0.5 ? sp.x : sp.z;\n  float scC = lgOrient < 0.5 ? sp.z : sp.x;\n  float u4 = fract((lcC + lgOff) / 4.0);\n  float v2 = fract(scC / 2.0);\n  float wY = fract(sp.y);\n  float dL = min(u4, 1.0 - u4) * 4.0 * pitch;\n  float dS = min(v2, 1.0 - v2) * 2.0 * pitch;\n  float dY = min(wY, 1.0 - wY) * lgCell.y;\n  float seamD;\n  if (mask.y > 0.5) seamD = min(dL, dS);\n  else if (mask.x > 0.5) seamD = min(dY, lgOrient < 0.5 ? dS : dL);\n  else seamD = min(dY, lgOrient < 0.5 ? dL : dS);\n  float seam = (1.0 - smoothstep(0.0, 0.07 * pitch, seamD)) * clamp(uP_seam, 0.0, 1.0);\n\n  /*\n    Studs, embossed the way the real brick photographs: the normal tilts\n    hard around the stud shoulder so the light wraps it like a cylinder\n    edge, the cap lifts, a contact shadow falls on the side facing away\n    from the light, and a faint ring engraved into the cap stands in for\n    the moulded logo.\n  */\n  vec3 nEff = n;\n  float studF = 0.0;\n  float shadowF = 0.0;\n  float engrave = 0.0;\n  float studAmt = clamp(uP_stud, 0.0, 1.0);\n  if (mask.y > 0.5 && n.y > 0.5) {\n    vec2 cuv = fract(hp.xz / pitch) - 0.5;\n    float sd = length(cuv);\n    float rim = smoothstep(0.14, 0.29, sd) * (1.0 - smoothstep(0.29, 0.335, sd));\n    vec3 tiltN = normalize(vec3(cuv.x, 0.42, cuv.y));\n    nEff = normalize(mix(n, tiltN, rim * studAmt));\n    studF = 1.0 - smoothstep(0.285, 0.33, sd);\n    vec2 lxz = normalize(Lo.xz + vec2(1.0e-5));\n    float away = clamp(dot(normalize(cuv + vec2(1.0e-5)), -lxz), 0.0, 1.0);\n    shadowF = smoothstep(0.47, 0.335, sd) * (1.0 - studF) * (0.35 + 0.65 * away);\n    engrave = smoothstep(0.11, 0.135, sd) * (1.0 - smoothstep(0.155, 0.18, sd)) * studF;\n  }\n\n  // plastic shading: lambert + wrap for roundness + white Blinn sheen,\n  // dimmed toward the interior so revealed under-bricks read as inside\n  float lam = clamp(dot(nEff, Lo), 0.0, 1.0);\n  float wrap = clamp(dot(dir, Lo) * 0.5 + 0.5, 0.0, 1.0);\n  float depthDim = mix(1.0, 0.55, clamp((1.0 - r) / (3.0 * lgCell.y), 0.0, 1.0));\n  float shade = (0.34 + 0.42 * wrap * wrap + 0.8 * lam * lightNow) * depthDim;\n\n  vec3 col = albedo * shade * (1.0 + 0.1 * studF);\n  col *= 1.0 - shadowF * 0.38 * studAmt; // stud contact shadow\n  col *= 1.0 - engrave * 0.14 * studAmt; // moulded logo ring\n\n  // chamfered edge: a thin bright bevel line just inside the dark joint,\n  // catching the light the way the real brick's edges do\n  float bevel = smoothstep(0.05 * pitch, 0.085 * pitch, seamD)\n    * (1.0 - smoothstep(0.085 * pitch, 0.16 * pitch, seamD));\n  col += albedo * bevel * (0.18 + 0.5 * lam) * clamp(uP_seam, 0.0, 1.0);\n  col *= 1.0 - seam * 0.8; // dark joints\n\n  // two-lobe plastic sheen: a sharp hotspot over a broad soft gloss\n  float ndh = clamp(dot(nEff, normalize(Lo + Vo)), 0.0, 1.0);\n  float spec = pow(ndh, 48.0) + 0.22 * pow(ndh, 8.0);\n  col += vec3(1.0) * spec * glossNow * (1.0 - seam) * depthDim;\n\n  col *= gainNow;\n  col = pow(max(col, 0.0), vec3(uP_contrast));\n\n  // Surface-lit orb bounded by the hit test: alpha IS coverage, and a hit\n  // is fully opaque \u2014 premultiplied output, trivially (see shdr-28).\n  gl_FragColor = vec4(col, 1.0);\n}\n",
  params: [
    { key: "spin", label: "Spin", min: 0, max: 5, step: 0.03, default: 0.25, integrate: true },
    { key: "tilt", label: "Tilt", min: 0, max: 4, step: 0.02, default: 0.55 },
    { key: "rebuild", label: "Rebuild rate", min: 0, max: 20, step: 0.1, default: 0.4, integrate: true },
    { key: "gap", label: "Missing bricks", min: 0, max: 0.8, step: 0.01, default: 0.07 },
    { key: "studs", label: "Studs", min: 8, max: 48, step: 1, default: 18 },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.95 },
    { key: "patch", label: "Colour patches", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "stud", label: "Stud relief", min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: "seam", label: "Seams", min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: "gloss", label: "Gloss", min: 0, max: 3, step: 0.02, default: 1 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 1 },
    { key: "gain", label: "Gain", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 }
  ],
  colors: [
    { key: "brickA", label: "Red", default: "#c4281c" },
    { key: "brickB", label: "Yellow", default: "#f2cd37" },
    { key: "brickC", label: "Blue", default: "#1e5aa8" },
    { key: "brickD", label: "Green", default: "#00852b" },
    { key: "brickE", label: "White", default: "#f4f4f4" }
  ],
  /*
    The rebuild blink is the state read:

      idle SETTLES     lazy tumble, an occasional brick popped off the shell
      thinking BUILDS  the tumble all but stops while the outer courses
                       churn — bricks blinking out and back everywhere,
                       the ball visibly rebuilding itself
      speaking SNAPS   whole and glossy: the gaps close, the sheen flares,
                       and the ball turns fast to answer

    Two controls are deliberately NOT staged, and both for the same reason:
    they quantize, so easing them steps instead of fading. STUDS sets the
    grid pitch, and a gliding pitch re-tiles the whole shell — the ball
    reads as inflating rather than changing mood. COLOUR PATCHES lands
    inside a floor() that picks one of the five brick colours, so easing it
    flips bricks between colours one at a time, which reads as a fault
    rather than a transition. Everything staged below is either an
    amplitude or one of the two integrated clocks, whose rate can change
    without their phase ever jumping.

    The surface finish carries as much of the read as the blink does:
    searching wears full stud relief and hard seams on a matt gloss — every
    brick edge visible, an object mid-assembly — and answering flattens the
    studs, sinks the seams and flares the sheen, so it resolves into one
    moulded piece.
  */
  statePresets: {
    idle: {
      spin: 0.25,
      rebuild: 0.4,
      gap: 0.07,
      gloss: 1,
      gain: 1,
      light: 1
    },
    thinking: {
      spin: 0.03,
      tilt: 0.9,
      rebuild: 9,
      gap: 0.55,
      stud: 1,
      seam: 0.95,
      gloss: 0.55,
      gain: 1.05,
      light: 1.15,
      contrast: 1.05
    },
    speaking: {
      spin: 1.6,
      tilt: 0.42,
      rebuild: 0.5,
      gap: 0,
      stud: 0.6,
      seam: 0.3,
      gloss: 2.4,
      gain: 1.25,
      light: 1.35,
      contrast: 0.95
    }
  },
  /*
    Answering swaps the whole box out. Resting and searching keep the
    classic five above — that palette is the joke, and it should be what
    the orb looks like most of the time — but the state that snaps whole
    and glossy gets a hot set to snap INTO: the same five slots, pushed to
    high chroma, so the sheen at gloss 2.4 has something saturated to sit
    on rather than a flat primary.

    Safe to stage, unlike the patch control that picks between these. Each
    brick keeps its slot through the change and only the colour in that
    slot eases, so the shell cross-fades where flipping bricks between
    slots would pop. Omitting idle and thinking is deliberate: an unlisted
    state falls back to the colour defaults, which is exactly the classic
    palette.
  */
  stateColors: {
    speaking: {
      brickA: "#ff3b6b",
      brickB: "#ffc93c",
      brickC: "#21d4fd",
      brickD: "#7af5a0",
      brickE: "#ffffff"
    }
  }
},
  "shdr-13": {
  key: "shdr-13",
  label: "SHDR-13",
  note: "plasma globe: crawling lightning filaments",
  frag: "\n#define STEPS 64\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat ionSharp;\nfloat ionWrithe;\nfloat ionCore;\nfloat ionExposure;\nfloat ionRadius;\n\nmat2 ionRot2(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\nvec3 ionRender(vec2 fragCoord) {\n  float t = uP_speed;      // integrated clock: filament crawl\n  float spinAng = uP_spin; // integrated clock: array precession\n\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  // exact ray/sphere chord \u2014 the march never leaves the globe, so no\n  // envelope fade is needed and every step length is meaningful\n  float proj = dot(-ro, rd);\n  float b2 = dot(ro, ro) - proj * proj;\n  float half_ = sqrt(max(ionRadius * ionRadius - b2, 0.0));\n  float zNear = proj - half_;\n  float stepLen = 2.0 * half_ / float(STEPS);\n  // per-pixel jitter of the march start: a filament grazed at a shallow\n  // angle is crossed periodically by the fixed step grid and renders as a\n  // dotted chain \u2014 the jitter decorrelates neighbouring rays and melts the\n  // dots into plasma grain\n  zNear += (hash(fragCoord) - 0.5) * stepLen;\n\n  vec3 acc = vec3(0.0);\n  float T = 1.0;\n\n  for (int i = 0; i < STEPS; i++) {\n    vec3 p = ro + rd * (zNear + (float(i) + 0.5) * stepLen);\n\n    // precess the whole filament array; a static tilt keeps the spin axis\n    // off-vertical so the motion reads in 3D\n    vec3 pr = p;\n    pr.xz = ionRot2(spinAng) * pr.xz;\n    pr.yz = ionRot2(uP_tilt) * pr.yz;\n\n    float r = length(pr);\n    vec3 dir = pr / max(r, 1e-4);\n    float rr = r / max(ionRadius, 1e-3);\n\n    // writhe: bend the sampling direction with radius and time, rooted at\n    // the nucleus by the smoothstep so filaments stay attached\n    float wr = ionWrithe * smoothstep(0.0, ionRadius * 0.35, r);\n    vec3 q = dir * uP_fils;\n    q += wr * vec3(\n      sin(r * uP_writheFreq        - t * 1.2 + q.y * 1.8),\n      sin(r * uP_writheFreq * 0.83 + t * 1.0 + q.z * 1.8),\n      sin(r * uP_writheFreq * 1.19 - t * 0.7 + q.x * 1.8));\n\n    // two independent fields over the direction sphere; their joint zero\n    // set is the filament curves. Time enters as additive phase only.\n    float f1 = sin(q.x + t * 0.70)\n             + sin(q.y * 1.31 - t * 0.50)\n             + sin(q.z * 1.13 + t * 0.90);\n    float f2 = sin(q.y * 1.21 + t * 0.60 + 1.7)\n             + sin(q.z * 1.43 - t * 0.80 + 3.1)\n             + sin(q.x * 0.87 + t * 0.40 + 5.0);\n    float d2 = f1 * f1 + f2 * f2;\n    float g = 1.0 / (d2 * ionSharp + uP_soft);\n\n    // flare where a streamer lands on the glass, and the hot nucleus\n    g *= 1.0 + uP_tipGain * smoothstep(0.55, 0.95, rr);\n    float core = ionCore / (r * r * 8.0 + 0.05);\n\n    // pink near the nucleus, violet-blue at the glass, cores whitened by\n    // their own intensity\n    vec3 fCol = mix(uC_inner, uC_arc, smoothstep(0.1, 0.75, rr));\n    vec3 w = (fCol + vec3(uP_whiten) * g) * g + uC_inner * core + vec3(uP_fill);\n    w = min(w, vec3(uP_stepClamp));\n    w *= stepLen; // length-fair: limb chords are short and dim correctly\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n    if (T < 0.004) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  // Louder agent output softens and thickens the arcs and quickens the\n  // writhe; user input flares the nucleus \u2014 the globe answers being spoken\n  // to the way the real toy answers a fingertip.\n  ionSharp = uP_sharp * (1.0 - 0.25 * uOutput);\n  ionWrithe = uP_writhe * (1.0 + 0.6 * uOutput);\n  ionCore = uP_coreGain * (1.0 + 1.6 * uInput + 0.4 * uOutput);\n  ionExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n  ionRadius = uP_envRadius + uP_swell * uInput;\n\n  vec3 acc = ionRender(gl_FragCoord.xy);\n\n  // tanh tone map with a tunable knee, then the usual finishing chain\n  vec3 col = tanh3(acc / max(ionExposure, 0.01));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel \u2014 a saturated violet streamer has low\n  // luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // analytic silhouette, identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(ionRadius * (1.0 - band), ionRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 1, integrate: true },
    { key: "spin", label: "Spin rate", min: 0, max: 5, step: 0.03, default: 0.2, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.1, default: 2.25 },
    { key: "envRadius", label: "Globe radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "swell", label: "Input swell", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "tilt", label: "Axis tilt", min: 0, max: 4, step: 0.02, default: 0.4 },
    { key: "fils", label: "Filament density", min: 0.5, max: 12, step: 0.1, default: 6 },
    { key: "writhe", label: "Writhe", min: 0, max: 3, step: 0.02, default: 0.9 },
    { key: "writheFreq", label: "Writhe frequency", min: 0.2, max: 8, step: 0.05, default: 1.6 },
    { key: "sharp", label: "Arc sharpness", min: 0.5, max: 60, step: 0.5, default: 4 },
    { key: "soft", label: "Arc core softness", min: 0.002, max: 0.5, step: 0.002, default: 0.06 },
    { key: "whiten", label: "Core whitening", min: 0, max: 0.2, step: 0.002, default: 0.008 },
    { key: "coreGain", label: "Nucleus glow", min: 0, max: 5, step: 0.05, default: 1.6 },
    { key: "tipGain", label: "Glass flare", min: 0, max: 6, step: 0.05, default: 1.8 },
    { key: "fill", label: "Body haze", min: 0, max: 2, step: 0.01, default: 0.02 },
    { key: "stepClamp", label: "Step clamp", min: 0.3, max: 300, step: 1.5, default: 40 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.012 },
    { key: "exposure", label: "Exposure", min: 0.1, max: 200, step: 0.5, default: 11 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.2 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2.5 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 }
  ],
  colors: [
    { key: "inner", label: "Nucleus", default: "#ff70d8" },
    { key: "arc", label: "Arc", default: "#5a5cff" },
    { key: "tint", label: "Tint", default: "#ffffff" }
  ],
  statePresets: {
    // a full globe of swooping arcs around a hot nucleus
    idle: {
      speed: 1,
      spin: 0.2,
      fils: 6,
      writhe: 0.9,
      sharp: 4,
      soft: 0.06,
      whiten: 0.008,
      tipGain: 1.8,
      coreGain: 1.6,
      exposure: 11
    },
    // hunting: even more filaments, softer and more nebular, restless writhe
    thinking: {
      speed: 1.8,
      spin: 0.45,
      fils: 7,
      writhe: 1.2,
      sharp: 3,
      soft: 0.08,
      whiten: 0.012,
      tipGain: 1.5,
      coreGain: 1.2,
      exposure: 10
    },
    // discharge: the densest, brightest state — spiky arcs flaring hard on
    // the glass around a blazing core
    speaking: {
      speed: 2.6,
      spin: 0.3,
      fils: 8,
      writhe: 1.3,
      sharp: 3.5,
      soft: 0.05,
      whiten: 0.012,
      tipGain: 2.4,
      coreGain: 2,
      exposure: 8.5
    }
  }
},
  "shdr-14": {
  key: "shdr-14",
  label: "SHDR-14",
  note: "a lit plasma dome quantized to chunky two-tone pixels",
  frag: "\n// 2x2 Bayer base: floor/fract only. (0,0)=0, (1,0)=.5, (0,1)=.75, (1,1)=.25\n// \u2014 the 0,2,3,1 ordering over 4.\nfloat bayer2(vec2 a) {\n  a = floor(a);\n  return fract(a.x / 2.0 + a.y * a.y * 0.75);\n}\n\n// 8x8 by recursion: M8 = M2(a/4)/16 + M2(a/2)/4 + M2(a). No arrays, no\n// bitwise \u2014 neither exists in GLSL ES 1.0.\nfloat bayer8(vec2 a) {\n  return bayer2(a * 0.25) * 0.0625 + bayer2(a * 0.5) * 0.25 + bayer2(a);\n}\n\nvoid main() {\n  // Volume coupling: user input deepens the waves, agent output brightens\n  // the whole tone ladder \u2014 the dot field visibly blooms while it speaks.\n  float plasmaAmt = uP_plasma * (1.0 + 0.4 * uInput);\n  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);\n\n  /*\n    Chunky pixel grid, RESOLUTION-RELATIVE: uP_cells is how many cells span\n    the canvas, so a 190px gallery card and a 420px playground orb show the\n    same composition \u2014 the same wave resolved by the same number of dots.\n    Sized in device pixels instead, small canvases collapse to a few dozen\n    blotches. All content below samples at the cell centre so every dot is\n    one flat square.\n  */\n  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 1.0);\n  vec2 pix = floor(gl_FragCoord.xy / cellPx);\n  vec2 cellCentre = (pix + 0.5) * cellPx;\n\n  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);\n  vec2 uv = suv / uP_radius;\n  float r2 = dot(uv, uv);\n\n  // blocky silhouette \u2014 cut on the cell grid, deliberately not smoothed\n  float mask = 1.0 - step(1.0, r2);\n\n  float z = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(uv, z);\n\n  /*\n    The plasma is evaluated in a ROTATING frame: the dome point spins about\n    Y on its own integrated clock, so the wavefronts roll around the ball\n    instead of sliding across a flat disc. The light stays screen-fixed \u2014\n    the form shading holds still while the pattern travels over it.\n  */\n  float rot = uP_spin; // integrated clock\n  float cr = cos(rot);\n  float sr = sin(rot);\n  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);\n\n  float t = uP_speed; // integrated clock\n\n  // the classic demoscene plasma: three interfering sine waves, each on its\n  // own direction and rate\n  float f = uP_scale;\n  float v = sin(sp.x * f * 3.1 + t)\n    + sin((sp.y * 0.85 + sp.z * 0.4) * f * 3.6 - t * 1.3)\n    + sin((sp.x + sp.y + sp.z) * f * 2.2 + t * 0.7);\n\n  // a ripple source orbiting the dome \u2014 expanding rings pushed through the\n  // interference; the clock enters only as additive phase\n  vec2 src = 0.55 * vec2(cos(t * 0.5), sin(t * 0.5));\n  v += sin(length(uv - src) * f * 5.0 - t * 2.2);\n  v *= 0.25; // four unit waves back to -1..1\n\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  float fres = pow(1.0 - z, 2.0);\n\n  // waves modulated by the dome shading, so the ball stays a ball under\n  // the rolling pattern; everything collapses into one luminance\n  float lum = (0.5 + 0.5 * v * plasmaAmt) * (0.3 + uP_light * lambert)\n    + uP_rim * fres;\n  lum = pow(clamp(lum * gainNow, 0.0, 1.0), uP_contrast);\n\n  // ordered dither onto the tone ladder \u2014 levels 2 is the classic 1-bit\n  // look, higher values keep the grain but add mid-tones\n  float steps = max(uP_levels - 1.0, 1.0);\n  float q = clamp(floor(lum * steps + bayer8(pix)) / steps, 0.0, 1.0);\n\n  vec3 col = mix(uC_ink, uC_paper, q);\n\n  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply \u2014\n  // the opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(col * a, a);\n}\n",
  params: [
    { key: "speed", label: "Wave speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.15, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "cells", label: "Grid cells", min: 32, max: 320, step: 2, default: 140 },
    { key: "levels", label: "Tone steps", min: 2, max: 8, step: 1, default: 3 },
    { key: "scale", label: "Wave scale", min: 0.3, max: 12, step: 0.1, default: 1.5 },
    { key: "plasma", label: "Wave amount", min: 0, max: 3, step: 0.015, default: 0.9 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.9 },
    { key: "rim", label: "Rim light", min: 0, max: 3, step: 0.015, default: 0.35 },
    { key: "gain", label: "Brightness", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.1 }
  ],
  colors: [
    { key: "ink", label: "Ink", default: "#101426" },
    { key: "paper", label: "Paper", default: "#cfe6ff" }
  ],
  /*
    Staged in the family language: thinking churns the plasma in place while
    the light freezes, speaking sweeps the light fast and brightens the
    ladder. `pixel` and `levels` never move between states — both quantize,
    and a gliding quantizer pops instead of fading.
  */
  statePresets: {
    // calm: waves rolling slowly, dome barely turning
    idle: {
      speed: 0.5,
      spin: 0.15,
      plasma: 0.9,
      gain: 1,
      contrast: 1.1
    },
    // computing: the interference races IN PLACE — wave clock at three
    // times idle, deeper waves — while the dome stops turning
    thinking: {
      speed: 1.6,
      spin: 0.05,
      plasma: 1.15,
      gain: 0.95,
      contrast: 1.15
    },
    // answering: the whole dome rolls fast and the tones bloom bright
    speaking: {
      speed: 1.3,
      spin: 0.8,
      plasma: 1,
      gain: 1.3,
      contrast: 1.05
    }
  },
  // ink/paper carry the at-a-glance read: cool print at rest, violet-blue
  // while computing, warm amber while answering
  stateColors: {
    idle: { ink: "#101426", paper: "#cfe6ff" },
    thinking: { ink: "#140f38", paper: "#a9b9ff" },
    speaking: { ink: "#2a1410", paper: "#ffd9a4" }
  }
},
  "shdr-15": {
  key: "shdr-15",
  label: "SHDR-15",
  note: "an iridescent particle-track web worn as the ball's skin",
  frag: "\n#define STEPS 10\n#define TURB 8\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat muonsTurb;\nfloat muonsExposure;\n\nvec3 muonsRender(vec2 fragCoord) {\n  float animTime = uP_speed; // integrated clock: weave + hue phase\n  float wander = uP_wander;  // integrated clock: axis drift\n\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  /*\n    Anchor the micro-slab to the ball: intersect the ray with the shell\n    analytically and start the ten steps AT the entry point, so the slab\n    hugs the sphere's curve. Rays that miss fall back to their closest\n    approach \u2014 the envelope and silhouette cut them anyway.\n  */\n  float proj = dot(-ro, rd);\n  float b2 = dot(ro, ro) - proj * proj;\n  float R = uP_envRadius * 0.96;\n  float entry = proj - sqrt(max(R * R - b2, 0.0));\n\n  vec3 acc = vec3(0.0);\n  float T = 1.0;\n  float z = entry;\n  float s = 0.0;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 p = ro + rd * z;\n\n    // shell points scaled into field space \u2014 the original worked around\n    // magnitude 9, and the ring density rides on that magnitude\n    vec3 q = p * uP_fieldScale;\n\n    // the per-layer axis, with the original's s feedback \u2014 each of the\n    // ten layers takes a differently jittered axis\n    vec3 axis = normalize(cos(vec3(7.0, 1.0, 0.0) + wander - s));\n\n    // the minus-90-degree Rodrigues twin of shdr-22\n    vec3 a = axis * dot(axis, q) - cross(axis, q);\n\n    for (int j = 0; j < TURB; j++) {\n      float dj = float(j) + 2.0;\n      a += muonsTurb * sin(a * dj + animTime).yzx / dj;\n    }\n\n    // the shells: the march sticks where the field magnitude sits on a\n    // multiple of pi, and 1/d blows up \u2014 that is the web\n    s = length(a);\n    float d = uP_stepScale * abs(sin(s));\n    d = max(d, 1e-5);\n    z += d;\n\n    /*\n      Layer-cycled palette, with the depth measured from the ENTRY point\n      so the banding follows the ball's skin. Clamp then normalize to\n      family units, as in shdr-22 \u2014 the raw spikes run to 1/1e-5.\n    */\n    vec3 w = (cos((z - entry) / max(uP_stepScale, 1e-3) + animTime + vec3(0.0, 2.0, 3.0) * uP_disperse) + 1.0)\n      / d / max(s, 0.5);\n    w = min(w, vec3(uP_stepClamp));\n    w *= 20.0 / max(uP_stepClamp, 1.0);\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    if (T < 0.004) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  muonsTurb = uP_turb * (1.0 + 0.5 * uInput);\n  muonsExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;\n      acc += muonsRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = muonsRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the golfed /3e3 knee is a tunable here\n  vec3 col = tanh3(acc / max(muonsExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a saturated violet\n  // thread has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "wander", label: "Axis wander", min: 0, max: 3, step: 0.015, default: 0.15, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.1, default: 2.25 },
    { key: "fieldScale", label: "Web density", min: 1, max: 20, step: 0.1, default: 2.4 },
    { key: "turb", label: "Weave", min: 0, max: 5, step: 0.03, default: 0.8 },
    { key: "stepScale", label: "Skin depth", min: 0.0015, max: 0.4, step: 0.005, default: 0.015 },
    { key: "disperse", label: "Dispersion", min: 0, max: 5, step: 0.03, default: 1 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 1 },
    { key: "fill", label: "Body fill", min: 0, max: 100, step: 0.3, default: 0.3 },
    { key: "stepClamp", label: "Step clamp", min: 3, max: 5000, step: 30, default: 150 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.01 },
    { key: "exposure", label: "Exposure", min: 1.5, max: 1500, step: 10, default: 50 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1.35 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.35 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    Staged on the two integrated clocks, as across the family: thinking
    sends the AXIS hunting (the web continuously reweaves in place) while
    speaking is speed-led (the layer-cycled iridescence shimmers fast and
    bright). turb and disperse are amplitudes/phases — everything glides.
  */
  statePresets: {
    // calm: slow weave, near-still axis
    idle: {
      speed: 0.4,
      wander: 0.12,
      turb: 0.75,
      disperse: 1,
      exposure: 72,
      scatter: 0.01,
      alphaGain: 2
    },
    // reweaving: the axis hunts at six times idle and the weave deepens —
    // the web knits and unknits in place, spectrum pulled tighter
    thinking: {
      speed: 1,
      wander: 0.7,
      turb: 0.95,
      disperse: 0.8,
      exposure: 66,
      scatter: 0.0095,
      alphaGain: 2.1
    },
    // answering: fast iridescent shimmer, wide spectrum, hot threads
    speaking: {
      speed: 2,
      wander: 0.3,
      turb: 1.1,
      disperse: 1.6,
      exposure: 46,
      scatter: 0.0075,
      alphaGain: 2.5
    }
  }
},
  "shdr-16": {
  key: "shdr-16",
  label: "SHDR-16",
  note: "sunlight through water — a caustic net crawling over the ball, fringing into colour where it moves",
  frag: "\n// Volume- and surge-reactive values, resolved once per fragment in main().\nfloat causticWarp;\n\n/*\n  The water. The plane is folded on its own sines three times, each octave\n  at a literal frequency and on its own share of the clock, so the ripples\n  refract the net rather than scroll it. Amplitude is the one control.\n*/\nvec2 fold(vec2 p, float t) {\n  p += causticWarp        * sin(p.yx * 1.31 + vec2( t * 0.90, -t * 0.70));\n  p += causticWarp * 0.60 * sin(p.yx * 2.17 + vec2(-t * 1.30,  t * 1.10));\n  p += causticWarp * 0.35 * sin(p.yx * 3.73 + vec2( t * 1.90,  t * 1.60));\n  return p;\n}\n\n/*\n  The light. Two crossed families of crest lines, sharpened by the edge\n  exponent \u2014 the base is 1 - abs(sin), always in [0, 1], so pow is defined \u2014\n  with their product added back so the crossings, where wavefronts focus,\n  burn hotter than the lines between them.\n*/\nfloat net(vec2 p, float t) {\n  vec2 q = fold(p, t);\n  vec2 s = 1.0 - abs(sin(q));\n  vec2 l = pow(s, vec2(uP_edge));\n  // Normalised to [0, 1]: the sum peaks at four on a crossing, and left\n  // unbounded it drove the tone knee into clipping all three channels,\n  // which turns any sun colour white. Bounded, the sun colour survives\n  // the knee at the foci and gain is a real brightness rather than a\n  // race to white.\n  return (l.x + l.y + 2.0 * l.x * l.y) * 0.25;\n}\n\n/*\n  Triplanar: the plane field read on the three axis planes of the surface\n  direction and blended by the fourth power of each component, so each\n  plane only shows where it faces squarely. No pole and no seam \u2014 the ball\n  can turn forever.\n*/\nfloat netOn(vec3 sp, float t) {\n  vec3 w = sp * sp;\n  w *= w;\n  w /= (w.x + w.y + w.z);\n  float k = uP_scale;\n  return w.x * net(sp.yz * k, t) + w.y * net(sp.zx * k, t) + w.z * net(sp.xy * k, t);\n}\n\nvoid main() {\n  vec2 uv = orbUV();\n  float rd = length(uv);\n  float R = uP_radius;\n  float mask = smoothstep(0.012, -0.012, rd - R);\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n  vec3 n = vec3(pl, z);\n\n  // the ball turns about Y on its own integrated clock\n  float cr = cos(uP_spin);\n  float sr = sin(uP_spin);\n  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);\n\n  float t = uP_flow; // integrated clock: the water\n\n  /*\n    The surge: a round trip on an integrated clock through cos, so it eases\n    through both ends and never wraps. It lifts the gain and deepens the\n    ripple together \u2014 brighter as the water heaves \u2014 and uP_swell is how\n    much of that a state takes.\n\n    Volume coupling in the family language: the agent's voice brightens the\n    light, the user's deepens the water.\n  */\n  float surge = 0.5 - 0.5 * cos(uP_swellRate);\n  float gainNow = uP_gain * mix(1.0, 0.55 + 0.9 * surge, uP_swell) * (0.8 + 0.5 * uOutput);\n  causticWarp = uP_warp * mix(1.0, 0.8 + 0.4 * surge, uP_swell) * (1.0 + 0.35 * uInput);\n\n  /*\n    Three moments of the fold, one per channel. The LIGHT is the net's\n    luminance under the sun colour, so gold is gold at the foci; the\n    per-channel disagreement is split off as a zero-mean residual and added\n    back scaled by uP_split, so the rainbow is a fringe that rides on the\n    edges where they move and vanishes where they hold \u2014 never a tint on\n    the whole net. Read once with the offset baked in and once without\n    would cost the same three evaluations, so the offset is constant and\n    the split is a plain amplitude on the residual: safe to stage.\n  */\n  float ds = 0.09;\n  vec3 c = vec3(netOn(sp, t + ds), netOn(sp, t), netOn(sp, t - ds));\n  float cLum = dot(c, vec3(1.0 / 3.0));\n  vec3 fringe = (c - cLum) * uP_split;\n\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  float fres = pow(1.0 - z, 2.5);\n\n  // the floor of the pool, then the light thrown on it \u2014 dimmer round the\n  // limb, where the floor tilts away from the sun\n  vec3 col = uC_deep * (0.35 + 0.65 * uP_light * lambert);\n  col += (uC_sun * cLum + fringe) * gainNow * (0.55 + 0.45 * lambert);\n  col += uC_sheen * uP_rim * fres;\n\n  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));\n  col = tanh3(col);\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "flow", label: "Water flow", min: 0.015, max: 10, step: 0.05, default: 0.9, integrate: true },
    { key: "spin", label: "Turn", min: 0, max: 5, step: 0.03, default: 0.08, integrate: true },
    { key: "swellRate", label: "Surge rate", min: 0, max: 8, step: 0.05, default: 0.6, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Net scale", min: 3, max: 30, step: 0.1, default: 9 },
    { key: "warp", label: "Ripple depth", min: 0, max: 3, step: 0.02, default: 0.8 },
    { key: "edge", label: "Line sharpness", min: 0.5, max: 10, step: 0.05, default: 2.2 },
    { key: "split", label: "Colour fringe", min: 0, max: 3, step: 0.02, default: 0.6 },
    { key: "swell", label: "Surge depth", min: 0, max: 1, step: 0.01, default: 0.15 },
    { key: "gain", label: "Sun power", min: 0.05, max: 6, step: 0.05, default: 1.6 },
    { key: "contrast", label: "Tone knee", min: 0.15, max: 6, step: 0.05, default: 1.1 },
    { key: "light", label: "Floor light", min: 0, max: 3, step: 0.015, default: 0.9 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.6 }
  ],
  // the pool floor, the light thrown on it, and the wet gloss at the limb
  colors: [
    { key: "deep", label: "Water", default: "#0b2f6e" },
    { key: "sun", label: "Caustic light", default: "#7ff6ff" },
    { key: "sheen", label: "Sheen", default: "#bfe8ff" }
  ],
  /*
    Staged on the three integrated clocks and on amplitudes only — nothing
    a state touches is a spatial frequency, so every transition cross-fades
    with nothing racing across the surface. NET SCALE is the one frequency
    in the orb and it is never staged: it multiplies the surface direction
    before the fold, so gliding it would sweep the whole net through every
    spacing in between. Line sharpness is a power exponent on a base in
    [0, 1], an amplitude, and safe at any span.

    The read is in the water:

      idle     a slow pool, lit HARD. Gentle ripple, moderate lines, the
               faintest surge, the ball barely turning — but the sun at
               full power on a firmer knee, so the caustics burn white
               over dark red water.
      thinking NERVOUS water. The flow runs at three and a half times
               resting on a ripple nearly double rest's, and the lines
               go broad under it — a coarse, fast, restless net. The
               surge is shallow but quick, a flicker rather than a heave,
               and the ball all but freezes so the motion is in the
               light. The sun is dropped to half rest's power with the
               key light and rim pulled down: white on a darker red,
               dimmer than rest.
      speaking the water HEAVES, fast. Full surge depth on a rate five
               times rest's, so the light pumps in quick breaths, on the
               deepest ripple and the broadest lines — sheets of light
               rather than threads — with the colour split wide so every
               edge fringes, and the ball plainly turning beneath it. The
               rim is all but cut so the light is the sun alone. Warm:
               gold on brick red.
  */
  statePresets: {
    idle: {
      flow: 0.92,
      spin: 0.09,
      swellRate: 0.6,
      warp: 0.8,
      edge: 3,
      split: 0.6,
      swell: 0.15,
      gain: 6,
      contrast: 1.3,
      light: 0.9,
      rim: 0.6
    },
    thinking: {
      flow: 3.22,
      spin: 0.03,
      swellRate: 2.4,
      warp: 1.52,
      edge: 2.8,
      split: 0.36,
      swell: 0.26,
      gain: 3.35,
      contrast: 1.15,
      light: 0.525,
      rim: 0.21
    },
    speaking: {
      flow: 1.8,
      spin: 0.7,
      swellRate: 5.4,
      warp: 1.7,
      edge: 1.7,
      split: 1.1,
      swell: 1,
      gain: 3.6,
      contrast: 0.85,
      light: 0.96,
      rim: 0.18
    }
  },
  // aqua light on dark red water at rest, pure white on a darker red while
  // searching, gold on brick-red water while answering
  stateColors: {
    idle: {
      deep: "#6f0b0b",
      sun: "#7ff6ff",
      sheen: "#bfe8ff"
    },
    thinking: {
      deep: "#3a0808",
      sun: "#ffffff",
      sheen: "#ffffff"
    },
    speaking: {
      deep: "#8d2525",
      sun: "#ffb914",
      sheen: "#ffb3c6"
    }
  }
},
  "shdr-17": {
  key: "shdr-17",
  label: "SHDR-17",
  note: "a grainy many-coloured storm with band shear and lightning",
  frag: "\nconst float PI = 3.14159265359;\n\n// Animated white noise, one tap per grain cell per grain frame. The seed\n// decorrelates the two taps so field grain and film grain never line up.\nfloat grainNoise(vec2 gpix, float frame, float seed) {\n  return hash(gpix + vec2(frame * 13.71 + seed, frame * 7.37 - seed));\n}\n\nvoid main() {\n  // Volume coupling: user input churns the warp harder, agent output\n  // brightens the field \u2014 the lightning gate opens separately below.\n  float warpNow = uP_warp * (1.0 + 0.55 * uInput);\n  float gainNow = uP_gain * (0.85 + 0.45 * uOutput);\n\n  vec2 uv = orbUV();\n  float rd = length(uv);\n  float R = uP_radius;\n  float mask = smoothstep(0.012, -0.012, rd - R);\n\n  // The storm below costs five fbm evaluations per fragment \u2014 skip all of it\n  // outside the silhouette instead of computing weather for transparent sky.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec2 pl = uv / R;\n  float r2 = dot(pl, pl);\n  float z = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(pl, z);\n\n  // roll the dome about Y on its own integrated clock\n  float cr = cos(uP_spin);\n  float sr = sin(uP_spin);\n  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);\n\n  float t = uP_speed; // integrated clock\n\n  // stereographic wrap: the weather travels around the ball and compresses\n  // toward the limb instead of sliding across a flat disc\n  vec2 st = sp.xy / (1.3 + sp.z) * uP_scale;\n\n  /*\n    Jovian band flow: a uniform stream plus a BOUNDED traveling wave of\n    shear, so latitude rings appear to slip past each other. The obvious\n    construction \u2014 t * sin(latitude) \u2014 accumulates the differential forever\n    and rakes the field into hairline streaks within seconds of the random\n    mount phase; the wave form keeps the shear amplitude fixed while its\n    phase travels. sp.y is untouched by the Y-roll, so the bands hold\n    horizontal while the dome turns underneath them.\n  */\n  st.x -= t * 0.3;\n  st.x += uP_shear * sin(sp.y * uP_bands - t * 0.45);\n\n  // two-level domain warp, the storm-cloud construction: q says where to\n  // look, w says where q said to look, the field reads there\n  vec2 q = vec2(\n    fbm(st + vec2(0.0, t * 0.35)),\n    fbm(st + vec2(5.2, 1.3) - vec2(t * 0.28, 0.0))\n  );\n  vec2 w = vec2(\n    fbm(st + warpNow * q + vec2(1.7, 9.2) + vec2(t * 0.12, 0.0)),\n    fbm(st + warpNow * q + vec2(8.3, 2.8) - vec2(0.0, t * 0.1))\n  );\n  float f = fbm(st + uP_churn * w);\n\n  /*\n    Grain tap 1: speckle folded into the FIELD itself, before the gradient,\n    so the colour stops below dither into grain instead of smooth bands.\n    Refreshed on the ambient clock \u2014 the flicker rate stays constant across\n    states on purpose (see the header note).\n  */\n  vec2 gpix = floor(gl_FragCoord.xy / max(uP_grainSize, 1.0));\n  float frame = floor(uTime * 48.0);\n  float g1 = grainNoise(gpix, frame, 3.1);\n  f += (g1 - 0.5) * uP_grain;\n\n  f = pow(clamp(f * gainNow, 0.0, 1.0), uP_contrast);\n\n  // four-stop palette climbing the storm field\n  vec3 col = mix(uC_deep, uC_low, smoothstep(0.05, 0.35, f));\n  col = mix(col, uC_mid, smoothstep(0.35, 0.62, f));\n  col = mix(col, uC_hot, smoothstep(0.62, 0.88, f));\n\n  // iridescent shimmer: a cosine rainbow keyed to the field AND to the warp\n  // vector \u2014 q varies at storm-cell scale, so the rainbow lands as coherent\n  // coloured weather cells instead of hue noise that optically averages to\n  // grey \u2014 multiplied in so it bends hues without erasing the palette\n  vec3 shimmer = 0.5 + 0.5 * cos(2.0 * PI * (f * 0.9 + q.x * 1.1 + t * 0.06 + vec3(0.0, 0.33, 0.67)));\n  col = mix(col, col * (0.35 + 1.9 * shimmer), uP_rainbow);\n\n  /*\n    Lightning: one hashed gate per flash interval with an exponential decay,\n    so most intervals stay dark and some strike. Agent output opens the gate\n    \u2014 an idle orb flickers occasionally, a speaking one strobes. The strike\n    lands hardest on the high-pressure cells of the field.\n  */\n  float ft = t * uP_flashRate;\n  float gate = step(1.0 - (0.1 + 0.5 * uOutput), hash(vec2(floor(ft), 7.7)));\n  float flashEnv = gate * exp(-fract(ft) * 6.0);\n  // squared so the strike stays inside the storm cells \u2014 a linear weight\n  // tints the whole ball and reads as the canvas strobing, not as weather\n  float high = smoothstep(0.55, 0.95, f);\n  col += uC_flash * (flashEnv * uP_flash) * (0.06 + 0.94 * high * high);\n\n  // dome shading keeps the ball a ball under the weather\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  col *= 0.35 + uP_light * lambert;\n  float fres = pow(1.0 - z, 2.5);\n  col += uC_flash * uP_rim * fres * (0.4 + 0.35 * flashEnv);\n\n  // grain tap 2: plain film grain over the final colour\n  float g2 = grainNoise(gpix, frame, 27.9);\n  col *= 1.0 + (g2 - 0.5) * uP_filmGrain;\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Storm speed", min: 0.015, max: 10, step: 0.05, default: 0.9, integrate: true },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.12, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Weather scale", min: 0.3, max: 12, step: 0.1, default: 2.4 },
    { key: "bands", label: "Band count", min: 0, max: 20, step: 0.1, default: 6 },
    { key: "shear", label: "Band shear", min: 0, max: 5, step: 0.03, default: 1.1 },
    { key: "warp", label: "Warp", min: 0, max: 8, step: 0.05, default: 2.2 },
    { key: "churn", label: "Churn", min: 0, max: 8, step: 0.05, default: 1.4 },
    { key: "gain", label: "Brightness", min: 0.05, max: 5, step: 0.05, default: 1.15 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.35 },
    { key: "grain", label: "Field grain", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "filmGrain", label: "Film grain", min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: "grainSize", label: "Grain size", min: 1, max: 8, step: 1, default: 2 },
    { key: "rainbow", label: "Iridescence", min: 0, max: 2, step: 0.01, default: 0.65 },
    { key: "flashRate", label: "Flash rate", min: 0, max: 10, step: 0.05, default: 1.6 },
    { key: "flash", label: "Flash power", min: 0, max: 5, step: 0.03, default: 1.2 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.85 },
    { key: "rim", label: "Rim light", min: 0, max: 3, step: 0.015, default: 0.5 }
  ],
  /*
   * Five stops: four climbing the storm field plus the lightning colour.
   * The iridescence param multiplies a rainbow over all of them, so the
   * palette here sets the mood and the shimmer supplies the extra hues.
   */
  colors: [
    { key: "deep", label: "Deep", default: "#2a0f4e" },
    { key: "low", label: "Low pressure", default: "#0fd0c3" },
    { key: "mid", label: "Mid pressure", default: "#ff5e9d" },
    { key: "hot", label: "High pressure", default: "#ffd166" },
    { key: "flash", label: "Lightning", default: "#eaf4ff" }
  ],
  /*
    Staged in the family language. Grain and grain size never move between
    states — grain is a quantizer, and a gliding quantizer pops instead of
    fading (same rule as the dither orb's cell grid).
  */
  statePresets: {
    // brooding: bands drifting, the odd distant flicker
    idle: {
      speed: 0.9,
      shear: 1.1,
      warp: 2.2,
      churn: 1.4,
      flash: 0.7,
      gain: 1.15,
      contrast: 1.35
    },
    // computing: the storm churns IN PLACE — clock at twice idle, deeper
    // warp, bands almost stalled, lightning held back
    thinking: {
      speed: 2.2,
      shear: 0.6,
      warp: 3.4,
      churn: 2.1,
      flash: 0.6,
      gain: 1.05,
      contrast: 1.5
    },
    // answering: bands race, the field blooms bright, lightning strobes
    speaking: {
      speed: 1.6,
      shear: 2.2,
      warp: 2.6,
      churn: 1.6,
      flash: 2.6,
      gain: 1.45,
      contrast: 1.2
    }
  },
  // teal-magenta-amber carnival at rest, cold indigo-cyan while computing,
  // hot magma while answering
  stateColors: {
    idle: {
      deep: "#2a0f4e",
      low: "#0fd0c3",
      mid: "#ff5e9d",
      hot: "#ffd166",
      flash: "#eaf4ff"
    },
    thinking: {
      deep: "#0d1440",
      low: "#4c4cf0",
      mid: "#9d4ce0",
      hot: "#4ce0ff",
      flash: "#d5e5ff"
    },
    speaking: {
      deep: "#3a0f1e",
      low: "#ff6a3d",
      mid: "#ff2e88",
      hot: "#ffd23f",
      flash: "#fff3e0"
    }
  }
},
  "shdr-18": {
  key: "shdr-18",
  label: "SHDR-18",
  note: "a crystal folded out of one eighth of space, tumbling",
  frag: "\n#define STEPS 50\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat octantFold;\nfloat octantFreq;\nfloat octantExposure;\n\nvec3 octantRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float wander = uP_wander; // integrated clock: the axis, and with it the\n                            // mirror planes, tumble\n\n  /*\n    The wandering axis. Unit by construction, which is what makes the\n    rotation below an exact one \u2014 and the three phases are far enough\n    apart that the cosines can never null together, so the normalize is\n    safe without a guard.\n  */\n  vec3 axis = normalize(cos(wander + vec3(0.0, 2.0, 4.0)));\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back \u2014 near cells veil far ones\n  float T = 1.0;\n\n  // march only the span the envelope can light, as in shdr-01\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 p = ro + rd * z;\n\n    // the exact minus-90-degree rotation about the wandering axis\n    vec3 a = dot(axis, p) * axis - cross(axis, p);\n\n    /*\n      The two folds, both blendable. uP_fold reflects the octants together\n      and uP_crease creases the diagonals; at zero the crystal dissolves\n      back into an ordinary periodic field, which is worth being able to\n      see, because the symmetry is doing more work here than the field is.\n    */\n    a = mix(a, abs(a), octantFold);\n    a = mix(a, max(a, a.yzx), uP_crease);\n\n    // step and density in one quantity, as in the listing\n    float d = uP_stepScale * length(cos(a * octantFreq));\n    d = max(d, uP_envRadius * 0.004);\n\n    /*\n      Depth as hue, near as bright.\n\n      The hue is keyed to depth measured from where the envelope BEGINS,\n      not from the camera. The listing marches from the lens out to twenty\n      units and cycles its ramp several times over that; bounded to the\n      ball, the same .2 slope covers barely a quarter turn of the wheel \u2014\n      and the quarter it covers has both green and blue sitting at the\n      bottom of their cosines, so the first build of this orb came out a\n      flat dark red. Anchored to the ball, the ramp spans it, and moving\n      the camera no longer repaints the crystal.\n\n      No step-length weighting here, unlike orb-nova and against the\n      README's usual rule \u2014 because 1/d IS this shader's density, not an\n      artefact of sphere tracing. Multiply it by the step and the two\n      cancel exactly, leaving a flat sum with every trace of the cell walls\n      gone. The clamp does the job the step weight would have, which is\n      also what shdr-22 does with the same construction.\n    */\n    float zRel = z - (uP_camDist - uP_envRadius);\n    vec3 w = cos(uP_hue * zRel + vec3(0.0, 2.0, 3.0) * uP_spread) + 1.0;\n    w /= d * max(z, 0.05);\n    w = min(w, vec3(uP_stepClamp));\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    z += d;\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  octantFold = clamp(uP_fold * (1.0 + 0.3 * uInput), 0.0, 1.0);\n  octantFreq = uP_freq * (1.0 + 0.25 * uInput);\n  octantExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      acc += octantRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = octantRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the envelope and transmittance change the\n  // accumulator's scale, so the golfed /1e2 knee is a tunable here\n  vec3 col = tanh3(acc / max(octantExposure, 0.01));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue cell\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "wander", label: "Tumble", min: 0, max: 5, step: 0.02, default: 0.5, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 4 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.05, default: 1.5 },
    { key: "fold", label: "Octant fold", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "crease", label: "Diagonal crease", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "freq", label: "Crystal frequency", min: 0.1, max: 20, step: 0.05, default: 5 },
    { key: "stepScale", label: "Step scale", min: 0.02, max: 2, step: 0.01, default: 0.3 },
    { key: "hue", label: "Depth hue", min: 0, max: 4, step: 0.01, default: 1.5 },
    { key: "spread", label: "Colour spread", min: 0, max: 3, step: 0.02, default: 1 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.1 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 0.9 },
    { key: "fill", label: "Body fill", min: 0, max: 20, step: 0.01, default: 0.02 },
    { key: "stepClamp", label: "Step clamp", min: 1, max: 2000, step: 1, default: 40 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.2, step: 0.001, default: 0.004 },
    { key: "exposure", label: "Exposure", min: 0.2, max: 500, step: 0.5, default: 18 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.05, default: 1.2 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.25 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    Staged on the two folds, which is the only orb here where SYMMETRY is
    the mood: a crystal at rest, the mirrors relaxing open while it works,
    and locked hard shut while it answers. The tumble carries the tempo.
  */
  statePresets: {
    // at rest: fully folded, turning slowly — a still crystal
    idle: {
      wander: 0.5,
      fold: 1,
      crease: 1,
      freq: 5,
      exposure: 18,
      scatter: 0.004,
      alphaGain: 2
    },
    /*
      searching: the crystal is pushed BACK and the mirrors loosen a hair.
      The lens nearly doubles so the fold sits deeper in the frame, the
      octant fold slips just under one — enough for the field to drift out
      of register without dissolving — on a tumble twice idle and a
      slightly coarser cell. The step clamp is thrown wide open and the
      diffusion raised fivefold, so the march runs long and the light
      fogs: the brightest state, but hazed rather than sharp.
    */
    thinking: {
      wander: 1.08,
      focal: 2.7,
      fold: 0.91,
      crease: 1,
      freq: 4.1,
      stepClamp: 1200,
      scatter: 0.02,
      exposure: 26,
      alphaGain: 2
    },
    /*
      answering: the mirrors LOCK SHUT again and the crystal goes finer
      than idle, marched on a step nearly twice as long so the cell walls
      read as crisp lines rather than fog. The envelope core drops to half,
      which hollows the ball and leaves the crystal floating in it; the
      depth hue runs faster and the saturation is pushed hard, at less than
      half the idle knee — the sharpest, most coloured state.
    */
    speaking: {
      wander: 0.7,
      fold: 1,
      crease: 1,
      freq: 6.05,
      stepScale: 0.51,
      hue: 2,
      envCore: 0.49,
      exposure: 8,
      scatter: 0.002,
      saturation: 2,
      alphaGain: 2.7
    }
  },
  // the depth ramp supplies the colour, so the tint only shifts its
  // temperature: neutral at rest, cooled while searching, warmed while
  // answering
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#9db8ff" },
    speaking: { tint: "#ffc492" }
  }
},
  "shdr-19": {
  key: "shdr-19",
  label: "SHDR-19",
  note: "beads swelling and shrinking in their cells, packed over the ball",
  frag: "\n#define AA 2\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat foamGrow;\nfloat foamJitter;\nfloat foamGain;\n\nvec3 foamRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n\n  float t = uP_speed; // integrated clock\n\n  // stereographic wrap of the unrotated dome, as in shdr-08\n  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;\n\n  // projection-safe 2D motion: the packing turns and drifts\n  float sw = uP_swirl; // integrated clock\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n  p += vec2(uP_slide, uP_slide * 0.7); // integrated clock\n\n  vec2 cell = ceil(p);\n  vec2 f = p - cell; // in (-1, 0], the fragment's place in its own cell\n\n  /*\n    The 3x3 walk, keyed on the ABSOLUTE cell index so a bead is one bead \u2014\n    see the header. Tracking the winner as well as the max costs nothing\n    and is what makes the shading below possible.\n  */\n  float cover = 0.0;\n  float bestRel = 1e9;\n  vec2 bestDelta = vec2(0.0);\n  float bestRad = 1.0;\n  vec2 bestId = vec2(0.0);\n\n  for (int gy = -1; gy <= 1; gy++) {\n    for (int gx = -1; gx <= 1; gx++) {\n      vec2 g = vec2(float(gx), float(gy));\n      vec2 id = cell + g;\n\n      /*\n        The listing's generator: a dot of a cosine against a detuned,\n        swizzled sine of the cell index, both carrying the clock. Mind the\n        range \u2014 a dot of two 2-vectors of unit-bounded components spans\n        FOUR, not two, so the listing's /6 puts radii within a third of a\n        cell of the mean. Read it as half that and the largest discs\n        overlap their neighbours, which is what turns a dot screen into a\n        litter of merged blobs.\n      */\n      float rad = dot(cos(id - t), sin(id.yx * uP_skew + t)) * uP_vary + foamGrow;\n      /*\n        Fragment to feature point, and the signs matter more than they\n        look. The disc labelled id sits at id + jitter in absolute\n        coordinates, so delta = p - (id + jitter) = f - g - jitter. Write\n        it as f + g and the disc's IDENTITY and its POSITION end up using\n        opposite offsets: every fragment then draws disc id in a different\n        place, and the field comes out as clumps of half-agreeing circles\n        rather than circles.\n      */\n      vec2 jit = cos(id.yx + t) * foamJitter;\n      vec2 delta = f - g - jit;\n      float dist = length(delta);\n\n      /*\n        The union is taken over COVERAGE, not over the signed distance the\n        listing maxes. Those differ exactly where two discs overlap: max of\n        (radius - distance) hands the whole overlap to whichever disc wins\n        and bites a straight edge out of the other, so the field comes out\n        a litter of crescents and pinwheels. Max of the clamped coverage\n        keeps every disc whole and merely lets overlapping ones merge.\n\n        The x50 ramp is the listing's, and it is an edge width rather than\n        a brightness: a signed distance scaled that hard and clamped is a\n        hard-edged disc with about a pixel of feather.\n      */\n      cover = max(cover, clamp((rad - dist) * uP_edge, 0.0, 1.0));\n\n      /*\n        The winner is tracked separately, by RELATIVE depth rather than\n        absolute \u2014 which disc this fragment is furthest inside, in units of\n        that disc's own radius. Only the optional bead shading reads it,\n        and relative depth is what keeps a small disc from being shaded as\n        though it were the large one beside it.\n      */\n      float rel = dist / max(rad, 1e-4);\n      if (rel < bestRel) {\n        bestRel = rel;\n        bestDelta = delta;\n        bestRad = rad;\n        bestId = id;\n      }\n    }\n  }\n\n  /*\n    The bead. The winning cell's own distance and radius give the height of\n    a hemisphere over the disc, and that is a normal \u2014 so the flat decal\n    becomes a lit piece of glass without a second field being evaluated.\n  */\n  float rr = max(bestRad, 1e-4);\n  float dome = clamp(1.0 - dot(bestDelta, bestDelta) / (rr * rr), 0.0, 1.0);\n  vec3 bn = normalize(vec3(bestDelta / rr, sqrt(dome) + 0.001));\n\n  vec3 key = normalize(vec3(-0.45, 0.55, 0.72));\n  float beadLam = clamp(dot(bn, key), 0.0, 1.0);\n\n  // per-disc colour, hashed on the cell index \u2014 near-flat at the defaults,\n  // which is what keeps the field reading as a dot screen\n  vec3 beadCol = mix(uC_low, uC_high, hash(bestId + 0.5));\n\n  // uP_bead at 0 leaves the listing's flat disc, which is the default\n  float shade = mix(1.0, 0.45 + 0.85 * beadLam, uP_bead);\n  vec3 col = beadCol * shade * foamGain * cover;\n\n  // a dark body under the packing, so the gaps read as the ball rather\n  // than as holes in it\n  col += uC_body * uP_floorLevel;\n\n  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));\n\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n\n  // dome shading keeps the ball a ball under the packing\n  vec3 n = vec3(pl, z);\n  float lambert = clamp(dot(n, key), 0.0, 1.0);\n  col *= 0.55 + uP_light * lambert;\n\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice shakes the beads off their centres,\n  // the agent's swells them and brightens the packing.\n  foamGrow = uP_grow * (1.0 + 0.35 * uOutput);\n  foamJitter = uP_jitter * (1.0 + 0.5 * uInput);\n  foamGain = uP_gain * (0.85 + 0.4 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += foamRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = foamRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.05, integrate: true },
    { key: "slide", label: "Drift", min: 0, max: 4, step: 0.02, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Packing scale", min: 0.3, max: 30, step: 0.1, default: 10 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "grow", label: "Dot size", min: -0.2, max: 1.2, step: 0.005, default: 0.185 },
    { key: "vary", label: "Size variation", min: 0, max: 0.4, step: 0.005, default: 0.13 },
    { key: "skew", label: "Generator detune", min: 0, max: 3, step: 0.01, default: 0.62 },
    { key: "jitter", label: "Dot wander", min: 0, max: 1.5, step: 0.01, default: 0.1 },
    { key: "edge", label: "Rim hardness", min: 1, max: 200, step: 1, default: 50 },
    { key: "bead", label: "Bead shading", min: 0, max: 1, step: 0.01, default: 0 },
    { key: "gain", label: "Brightness", min: 0.05, max: 4, step: 0.02, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 6, step: 0.05, default: 1 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.1 },
    { key: "floorLevel", label: "Body fill", min: 0, max: 2, step: 0.01, default: 0.06 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.3 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.35 }
  ],
  /*
   * Four stops: the two ends of the per-bead hash, the body the packing
   * sits on, and the glass.
   */
  colors: [
    { key: "low", label: "Dot", default: "#ffffff" },
    { key: "high", label: "Dot accent", default: "#eef5ff" },
    { key: "body", label: "Body", default: "#05070c" },
    { key: "sheen", label: "Sheen", default: "#9dbfe4" }
  ],
  /*
    Staged on BEAD SIZE, which decides whether the ball is a scatter of
    separate beads or a packed foam, and on wander, which decides how far
    each one strays from its cell. Packing scale never moves between
    states — it sets the bead count, and a gliding count reads as the ball
    inflating rather than as a change of mood.
  */
  statePresets: {
    /*
      at rest: a sparse, restless screen. The dots sit small with a wide
      size spread and wander most of a cell, on a dome flattened almost to
      a disc, so the halftone reads as grain rather than pattern — pushed
      bright and hard-contrasted so the few dots that land carry.
    */
    idle: {
      speed: 0.52,
      swirl: 0.045,
      slide: 0.1,
      bulge: 0.08,
      grow: 0.12,
      vary: 0.19,
      skew: 0.63,
      jitter: 0.74,
      edge: 51,
      gain: 2.28,
      contrast: 2.6,
      rim: 0.345
    },
    /*
      searching: the screen is set MOVING. The clock runs five times idle,
      the swirl and slide both open up an order of magnitude, and the
      generator detunes near double, so the dots stream across the ball
      rather than sit on it. They swell a little and wander half as far as
      idle, under a softer contrast and a stronger key light — a flatter,
      brighter, busier screen.
    */
    thinking: {
      speed: 2.55,
      swirl: 0.57,
      slide: 0.84,
      bulge: 0.14,
      grow: 0.19,
      vary: 0.165,
      skew: 1.13,
      jitter: 0.37,
      gain: 1.04,
      contrast: 0.55,
      light: 0.585,
      rim: 0.24
    },
    /*
      answering: the screen goes HARD. The generator detune drops to zero,
      so every dot's size runs on the clock alone and the whole screen
      pulses in step; the size spread opens to its widest and the rim
      hardness nearly triples, so the dots read as punched holes rather
      than beads. The dome rises, the dots settle to a quarter of idle's
      wander, and the body fill is cut — pure white dots on black, at the
      thinking tempo and a harder contrast still.
    */
    speaking: {
      speed: 2.85,
      swirl: 0.585,
      slide: 0.55,
      bulge: 0.28,
      grow: 0.22,
      vary: 0.365,
      skew: 0,
      jitter: 0.17,
      edge: 141,
      gain: 1.35,
      contrast: 3.2,
      saturation: 2.04,
      floorLevel: 0
    }
  },
  // cool glass at rest, then pure white on black for both working states —
  // the answering one keeps the faintly warm body
  stateColors: {
    idle: { low: "#ffffff", high: "#eef5ff", body: "#05070c", sheen: "#9dbfe4" },
    thinking: { low: "#dae6ff", high: "#ffffff", body: "#000000", sheen: "#ffffff" },
    speaking: { low: "#ffffff", high: "#ffffff", body: "#140a06", sheen: "#ffffff" }
  }
},
  "shdr-20": {
  key: "shdr-20",
  label: "SHDR-20",
  note: "a water film rushing down the ball, fountain-style",
  frag: "\n#define STEPS 50\n#define TURB 5\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat fallsFoam;\nfloat fallsExposure;\n\nmat2 fallsRot(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\nvec3 fallsRender(vec2 fragCoord) {\n  float animTime = uP_speed; // integrated clock: ripple phase\n  float flow = uP_flow;      // integrated clock: the 9t rush, tunable\n\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float rShell = uP_envRadius * 0.92;\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back \u2014 near foam veils far foam\n  float T = 1.0;\n\n  // march only the span the envelope can light, as in shdr-01\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 c = ro + rd * z;\n\n    // a slight static tilt of the flow axis\n    c.yz = fallsRot(uP_tilt) * c.yz;\n\n    /*\n      The fall grain: squash the vertical axis, then the five octaves with\n      the rush phase on the first component \u2014 cos(p.yzx*f + ...) writes\n      that component to x, so height and time drive the sideways waves,\n      exactly the original's x*t construction.\n    */\n    vec3 p = c;\n    p.y *= uP_stretch;\n    for (int j = 0; j < TURB; j++) {\n      float fj = float(j) + 1.3;\n      p += cos(p.yzx * fj + float(it) + z + vec3(flow, 0.0, 0.0)) / fj;\n    }\n\n    // the foam blend \u2014 most of the displacement is thrown away, leaving a\n    // film of detail over a coherent surface\n    vec3 pm = mix(c, p, fallsFoam);\n\n    /*\n      The surface, swapped from the sigmoid cliff to the ball's own shell:\n      distance to the sphere (sharpened by uP_wall) plus the original's\n      traveling ripple. f can still reach zero exactly \u2014 the guard feeds\n      both the division and the march step.\n    */\n    float f = uP_stepScale * (abs(length(pm) - rShell) * uP_wall\n      + sin(pm.x - pm.z + animTime * 2.0) + 1.0);\n    f = max(f, 1e-3);\n    z += f;\n\n    /*\n      Vertical hue sheets from the listing, bright where the march grazes\n      the film. The CLAMP is load-bearing, as in every accumulator here \u2014\n      one f-null step would own the whole 50-step sum.\n    */\n    vec3 w = (cos(pm.x * uP_hueScale + f + vec3(6.0, 1.0, 2.0)) + 2.0) / f / max(z, 1.0);\n    w = min(w, vec3(uP_stepClamp));\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(ro + rd * z));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  fallsFoam = uP_foam * (1.0 + 0.5 * uInput);\n  fallsExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;\n      acc += fallsRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = fallsRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the golfed /3e1 knee is a tunable here\n  vec3 col = tanh3(acc / max(fallsExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue sheet\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Ripple speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "flow", label: "Fall rush", min: 0, max: 20, step: 0.1, default: 3, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.1, default: 2.25 },
    { key: "tilt", label: "Flow tilt", min: 0, max: 4, step: 0.02, default: 0.15 },
    { key: "stretch", label: "Fall stretch", min: 0.03, max: 3, step: 0.015, default: 0.3 },
    { key: "foam", label: "Foam", min: 0, max: 3, step: 0.015, default: 0.3 },
    { key: "wall", label: "Film sharpness", min: 0.15, max: 20, step: 0.1, default: 3 },
    { key: "stepScale", label: "Step scale", min: 0.015, max: 1.5, step: 0.01, default: 0.2 },
    { key: "hueScale", label: "Hue banding", min: 0, max: 3, step: 0.015, default: 0.85 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 1 },
    { key: "fill", label: "Body fill", min: 0, max: 100, step: 0.3, default: 0.4 },
    { key: "stepClamp", label: "Step clamp", min: 0.3, max: 300, step: 1.5, default: 20 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.01 },
    { key: "exposure", label: "Exposure", min: 1.5, max: 1500, step: 10, default: 22 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1.15 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.55 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  statePresets: {
    idle: {
      speed: 0.5,
      flow: 3,
      foam: 0.3,
      exposure: 22,
      scatter: 0.01,
      alphaGain: 2
    },
    thinking: {
      speed: 0.6,
      flow: 3.3,
      foam: 0.33,
      exposure: 21,
      scatter: 0.0095,
      alphaGain: 2.1
    },
    // loudest: full rush, thick foam, hot film
    speaking: {
      speed: 1,
      flow: 5.5,
      foam: 0.45,
      exposure: 16,
      scatter: 0.0075,
      alphaGain: 2.5
    }
  }
},
  "shdr-21": {
  key: "shdr-21",
  label: "SHDR-21",
  note: "light diffusing through a cloud",
  frag: "\n#define STEPS 56\n#define LIGHT_STEPS 4\n#define DENSITY_OCT 4\n#define AA 1\n\nconst float PI = 3.14159265359;\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat nimbusPower;\nfloat nimbusDensity;\n\n/*\n  Density inside the sphere.\n\n  The radial term falls to zero at the boundary, which both bounds the volume\n  and gives the soft edge for free. The cos-warp folds the sample point a few\n  times \u2014 the same cheap turbulence the other orbs use \u2014 and the threshold\n  carves that into clumps rather than an even fog.\n*/\nfloat density(vec3 p, float animTime) {\n  float shell = 1.0 - length(p) / uP_radius;\n  if (shell <= 0.0) return 0.0;\n\n  vec3 q = p * uP_scale;\n  float f = 1.0;\n  for (int k = 0; k < DENSITY_OCT; k++) {\n    q += cos(q.yzx * f + animTime * uP_churn) / f;\n    f *= 1.8;\n  }\n\n  float n = (sin(q.x) + sin(q.y) + sin(q.z)) / 3.0 * 0.5 + 0.5;\n  // smoothstep against the threshold is the clump control: high threshold\n  // leaves sparse wisps, low fills the sphere with even fog\n  float clump = smoothstep(uP_threshold, 1.0, n);\n  return clump * pow(shell, uP_edgeSoft) * nimbusDensity;\n}\n\n/*\n  Henyey-Greenstein: g > 0 biases scattering forward, which is what gives the\n  bloom on the limb facing the light.\n\n  The physical form carries a 1/(4*PI) normalisation. It is dropped here and\n  folded into uP_power instead \u2014 kept in, the whole term sits around 0.02 and\n  the orb renders black unless power is pushed into the hundreds, which makes\n  the slider useless.\n*/\nfloat phaseHG(float c, float g) {\n  float g2 = g * g;\n  return (1.0 - g2) / pow(max(1.0 + g2 - 2.0 * g * c, 0.0001), 1.5);\n}\n\nvec4 nimbusRender(vec2 fragCoord) {\n  float animTime = uP_speed; // integrated clock\n\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, -uP_camDist);\n  vec3 rd = normalize(vec3(uv, uP_focal));\n\n  /*\n    Light direction, slowly orbiting so the shading is never static.\n\n    The z term is kept POSITIVE \u2014 the camera looks along +z, so a light also\n    pointing along +z sits behind the cloud. That is the back-lit case, where\n    dot(rd, L) approaches 1 and the forward-scattering phase blooms. Put the\n    light on the camera's side instead and every ray samples the phase function\n    on its back-scatter tail, where it is roughly ten times smaller, and the orb\n    goes muddy.\n  */\n  vec3 L = normalize(vec3(\n    cos(animTime * uP_lightSpin) * 0.7,\n    0.45,\n    sin(animTime * uP_lightSpin) * 0.35 + 0.65\n  ));\n\n  float phase = phaseHG(dot(rd, L), uP_aniso);\n\n  // Start the march at the sphere's front face instead of the camera \u2014 every\n  // step before that contributes nothing, and at 56 steps they are expensive.\n  float toCentre = uP_camDist;\n  float tStart = max(toCentre - uP_radius, 0.0);\n  float span = 2.0 * uP_radius;\n  float dt = span / float(STEPS);\n\n  float T = 1.0;\n  vec3 scattered = vec3(0.0);\n\n  for (int i = 0; i < STEPS; i++) {\n    float t = tStart + (float(i) + 0.5) * dt;\n    vec3 p = ro + rd * t;\n\n    float dn = density(p, animTime);\n    if (dn > 0.001) {\n      // short march toward the light for self-shadowing\n      float shadow = 1.0;\n      float lstep = uP_radius / float(LIGHT_STEPS);\n      for (int k = 1; k <= LIGHT_STEPS; k++) {\n        vec3 lp = p + L * (float(k) - 0.5) * lstep;\n        shadow *= exp(-density(lp, animTime) * lstep * uP_shadowAbsorb);\n      }\n\n      /*\n        In-scattered light: warm where lit, cool where the volume shadows\n        itself.\n\n        The shadow term appears ONCE, inside the mix. Multiplying by it again\n        as a factor \u2014 the obvious-looking thing to write \u2014 scales the shadowed\n        end of the mix toward zero, so the cool colour is always multiplied\n        away and the cloud comes out monochrome beige however it is tinted.\n        uP_shadowLift is how much light still reaches the shadowed side.\n      */\n      vec3 lit = mix(uC_shadow * uP_shadowLift, uC_light, shadow);\n      scattered += T * dn * dt * lit * phase * nimbusPower;\n\n      T *= exp(-dn * dt * uP_absorb);\n      if (T < 0.01) break;\n    }\n  }\n\n  // a soft ambient body so the unlit side is not pure black\n  float body = 1.0 - T;\n  scattered += uC_shadow * body * uP_ambient;\n\n  return vec4(scattered, body);\n}\n\nvoid main() {\n  /*\n    Agent output turns the light up; user input thickens the cloud. Both are\n    AMPLITUDES. Churn is deliberately NOT volume-scaled: it multiplies the\n    accumulated clock into a phase (animTime * churn), so scaling it by the\n    live volume would turn every volume wobble into a phase jump the size of\n    the whole clock \u2014 the cloud scrambles chaotically on each state change\n    instead of gliding, and gets worse the longer the page is open.\n  */\n  nimbusPower = uP_power * (0.7 + 0.9 * uOutput);\n  nimbusDensity = uP_density * (1.0 + 0.35 * uInput);\n\n  vec4 acc = vec4(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;\n      acc += nimbusRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = nimbusRender(gl_FragCoord.xy);\n#endif\n\n  vec3 col = tanh3(acc.rgb * uP_exposure);\n  float a = clamp(acc.a * uP_alphaGain, 0.0, 1.0);\n\n  // Emitted/scattered light, so rgb is already premultiplied \u2014 do NOT multiply\n  // by alpha again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 10, integrate: true },
    { key: "camDist", label: "Camera distance", min: 0.5, max: 40, step: 0.2, default: 4.4 },
    { key: "focal", label: "Lens", min: 0.3, max: 15, step: 0.1, default: 1.8 },
    { key: "radius", label: "Cloud radius", min: 0.15, max: 10, step: 0.05, default: 2 },
    { key: "scale", label: "Cloud scale", min: 0.1, max: 15, step: 0.1, default: 0.8 },
    { key: "churn", label: "Churn", min: 0, max: 5, step: 0.03, default: 0.3 },
    { key: "threshold", label: "Clumping", min: 0, max: 3, step: 0.015, default: 0.075 },
    { key: "edgeSoft", label: "Edge softness", min: 0.1, max: 10, step: 0.05, default: 0.8 },
    { key: "density", label: "Density", min: 0.03, max: 20, step: 0.1, default: 3.2 },
    { key: "absorb", label: "Absorption", min: 0.03, max: 15, step: 0.1, default: 1.4 },
    { key: "shadowAbsorb", label: "Shadow depth", min: 0, max: 20, step: 0.1, default: 2.4 },
    { key: "shadowLift", label: "Shadow lift", min: 0, max: 5, step: 0.03, default: 0.55 },
    { key: "aniso", label: "Forward scatter", min: -0.9, max: 0.9, step: 0.01, default: 0.45 },
    { key: "lightSpin", label: "Light orbit", min: 0, max: 3, step: 0.015, default: 0.12 },
    { key: "power", label: "Light power", min: 0.03, max: 40, step: 0.2, default: 1.9 },
    { key: "ambient", label: "Ambient", min: 0, max: 3, step: 0.015, default: 0.12 },
    { key: "exposure", label: "Exposure", min: 0.03, max: 10, step: 0.05, default: 1 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 10, step: 0.05, default: 1.5 }
  ],
  /*
   * The engine uploads these as uC_<key> vec3 uniforms. Warm light against a
   * cool shadow is what reads as depth — a single-hue cloud looks flat however
   * well it is shadowed.
   */
  colors: [
    { key: "light", label: "Light", default: "#ffd7a3" },
    { key: "shadow", label: "Shadow", default: "#3a4a8c" }
  ],
  statePresets: {
    /*
      Every state shares the same speed, geometry and cloud shape — only the
      AMBIENCE and the palette move, so switching state relights the cloud
      instead of restaging it. The engine glides params and cross-fades
      colours on one shared easing, so the change reads as a mood shift.
    */
    idle: {
      ambient: 0.12,
      power: 1.9,
      shadowLift: 0.55
    },
    thinking: {
      ambient: 0.22,
      power: 2.15,
      shadowLift: 0.65
    },
    speaking: {
      ambient: 0.46,
      power: 3.1,
      shadowLift: 0.95
    }
  },
  /*
    The palette carries the rest of the state read: a warm lamp over cool
    shadow at rest, shifting violet while it thinks, and burning hot while
    speaking.
  */
  stateColors: {
    idle: { light: "#ffd7a3", shadow: "#3a4a8c" },
    thinking: { light: "#e6d4ff", shadow: "#3b3f96" },
    speaking: { light: "#ffb066", shadow: "#7a2f6e" }
  }
},
  "shdr-22": {
  key: "shdr-22",
  label: "SHDR-22",
  note: "field lines swirling around the ball about a wandering axis",
  frag: "\n#define STEPS 70\n#define TURB 7\n#define AA 1\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat vectorsTurb;\nfloat vectorsExposure;\nfloat vectorsGlow;\n\nvec3 vectorsRender(vec2 fragCoord) {\n  float animTime = uP_speed; // integrated clock: cell flicker phase\n  float wander = uP_wander;  // integrated clock: axis drift\n\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  // the wandering rotation axis \u2014 unit by construction, which is what\n  // makes the 90-degree Rodrigues below exact\n  vec3 axis = normalize(sin(wander + vec3(0.0, 2.0, 4.0)));\n\n  vec3 acc = vec3(0.0);\n\n  // transmittance carried front-to-back \u2014 near streaks veil far ones\n  float T = 1.0;\n\n  // march only the span the envelope can light, as in shdr-01\n  float z = max(uP_camDist - uP_envRadius * 1.3, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.3;\n\n  for (int it = 0; it < STEPS; it++) {\n    vec3 p = ro + rd * z;\n\n    /*\n      THE ORB IS THE OBJECT \u2014 pull the sample toward the sphere's shell\n      before the field ever sees it. At hug 0 this is the raw 3D tangle;\n      at 1 the field is purely angular, painted on the ball's skin. The\n      guard keeps normalize() defined through the centre.\n    */\n    float rl = max(length(p), 1e-3);\n    vec3 q = mix(p, p / rl * uP_envRadius, uP_hug);\n\n    // the exact 90-degree rotation about the wandering axis; v stays\n    // clean, a takes the turbulence \u2014 the fork is the original's v=a=...\n    vec3 v = dot(axis, q) * axis + cross(axis, q);\n    vec3 a = v;\n\n    // cell-quantized turbulence: every ceil() lattice cell flickers on\n    // its own phase\n    for (int j = 0; j < TURB; j++) {\n      float dj = float(j) + 3.0;\n      a += vectorsTurb * sin(ceil(a * dj) - animTime).yzx / dj;\n    }\n\n    // the density product \u2014 turbulent detail times clean streak surfaces\n    float d = uP_stepScale * length(sin(a * a)) * sqrt(length(v * sin(v.yzx)));\n    d = max(d, 1e-4);\n\n    /*\n      The march's own colour code, from the listing: red constant, green\n      by step index, blue by depth into the ball \u2014 with the two ramps\n      exposed. The CLAMP is load-bearing as everywhere: one grazing step\n      would own the whole 70-step sum at some phases. Green gets twice the\n      clamp headroom: its ramp runs to STEPS (70) where red is fixed at 9,\n      and an equal clamp would crush the step gradient first.\n    */\n    vec3 w = vec3(9.0, float(it) * uP_hueStep, (z - uP_camDist + uP_envRadius) * uP_hueDepth) / d;\n    w = min(w, vec3(uP_stepClamp) * vec3(1.0, 2.0, 1.0));\n\n    /*\n      Normalize the clamped weight back to family units (a ceiling of ~20,\n      like the sibling orbs). This orb's raw weights run in the hundreds \u2014\n      the golfed knee was 6e4 \u2014 and without this one line the clamp value\n      leaks into total energy, so Exposure, Body fill and Diffusion would\n      all change meaning whenever the clamp moves. Normalized, stepClamp\n      is a pure dynamic-range knob: low flattens the streaks, high lets\n      the 1/d spikes whiten.\n    */\n    w *= 20.0 / max(uP_stepClamp, 1.0);\n\n    /*\n      A few vectors GLOW. Cells of the clean rotated frame are hashed, and\n      each cell's hash cycles against the clock so only a small fraction\n      (uP_glowFew of the cycle) are hot at any moment. Where a hot cell\n      meets a streak null, the same 1/d spike is re-read on a far higher\n      ceiling than the step clamp \u2014 deliberately bypassing it \u2014 and pushed\n      as warm-white light. The two smoothsteps make a triangle window, so\n      each glow blooms and fades instead of popping at the cycle wrap.\n    */\n    float few = max(uP_glowFew, 1e-3);\n    vec3 vc = ceil(v * 2.0);\n    float hcell = hash(vc.xy + vc.z * vec2(7.31, 3.17));\n    float cyc = fract(hcell + animTime * 0.05);\n    float sel = smoothstep(1.0 - few, 1.0 - 0.5 * few, cyc) * smoothstep(1.0, 1.0 - 0.5 * few, cyc);\n    // QUADRATIC in 1/d, unlike the linear base weight \u2014 the glow hugs the\n    // filament core and falls off fast, a hot wire rather than a lit sector\n    w += vec3(1.0, 0.96, 0.88) * min(0.08 / (d * d), 500.0) * sel * vectorsGlow;\n\n    // envelope: plateau through the ball, cut 12% past the radius so the\n    // analytic silhouette in main() still has emission left to cut\n    float env = smoothstep(uP_envRadius * 1.12, uP_envRadius * uP_envCore, length(p));\n    w = (w + uP_fill) * env;\n\n    acc += T * w;\n    T *= exp(-dot(w, vec3(0.299, 0.587, 0.114)) * uP_scatter);\n\n    z += d;\n    if (T < 0.004 || z > zEnd) break;\n  }\n\n  return acc;\n}\n\nvoid main() {\n  vectorsTurb = uP_turb * (1.0 + 0.5 * uInput);\n  vectorsExposure = uP_exposure * (1.0 - 0.35 * uOutput);\n  // the glows flare when the agent speaks\n  vectorsGlow = uP_glow * (1.0 + 0.8 * uOutput);\n\n  vec3 acc = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;\n      acc += vectorsRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = vectorsRender(gl_FragCoord.xy);\n#endif\n\n  // tanh tone map per channel \u2014 the envelope and transmittance change the\n  // accumulator's scale, so the golfed /6e4 knee is a tunable here\n  vec3 col = tanh3(acc / max(vectorsExposure, 1.0));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel, not luminance \u2014 a deep blue tail\n  // has low luminance but must not go transparent\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "wander", label: "Axis wander", min: 0, max: 3, step: 0.015, default: 0.12, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.1, default: 2.25 },
    { key: "hug", label: "Surface hug", min: 0, max: 3, step: 0.015, default: 0.8 },
    { key: "turb", label: "Cell shimmer", min: 0, max: 5, step: 0.03, default: 0.6 },
    { key: "stepScale", label: "Step scale", min: 0.005, max: 1.5, step: 0.01, default: 0.07 },
    { key: "hueStep", label: "Step hue", min: 0, max: 10, step: 0.03, default: 0.12 },
    { key: "hueDepth", label: "Depth hue", min: 0, max: 10, step: 0.03, default: 1.4 },
    { key: "glow", label: "Vector glow", min: 0, max: 10, step: 0.05, default: 1.4 },
    { key: "glowFew", label: "Glow density", min: 0, max: 1.5, step: 0.01, default: 0.12 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "envCore", label: "Envelope core", min: 0.3, max: 1.02, step: 0.01, default: 0.88 },
    { key: "fill", label: "Body fill", min: 0, max: 100, step: 0.3, default: 0.15 },
    { key: "stepClamp", label: "Step clamp", min: 3, max: 5000, step: 30, default: 800 },
    { key: "scatter", label: "Diffusion", min: 0, max: 0.5, step: 0.003, default: 0.01 },
    { key: "exposure", label: "Exposure", min: 1.5, max: 5000, step: 15, default: 260 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 15, step: 0.1, default: 1.3 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.15 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [{ key: "tint", label: "Tint", default: "#ffffff" }],
  /*
    The states are staged on this orb's two best levers, both phase-safe
    integrated clocks: the AXIS WANDER (the whole field re-orients as the
    axis moves) and the cell-flicker speed. glowFew is the third lever —
    how many of the hot-wire vectors are lit at once.
  */
  statePresets: {
    // calm: slow shimmer, near-still axis, a few soft glows
    idle: {
      speed: 0.4,
      wander: 0.1,
      turb: 0.55,
      glow: 1.3,
      glowFew: 0.12,
      exposure: 260,
      scatter: 0.01,
      alphaGain: 2
    },
    /*
      searching: the axis HUNTS — wander runs six times idle, so the field
      lines continuously re-orient as if trying directions — while the
      glows go SPARSER but sharper: rare single sparks, ideas catching.
    */
    thinking: {
      speed: 1.2,
      wander: 0.6,
      turb: 0.7,
      glow: 1.7,
      glowFew: 0.07,
      exposure: 230,
      scatter: 0.0095,
      alphaGain: 2.1
    },
    /*
      answering: the axis settles (it found the direction) and the energy
      moves to the field itself — fast flicker, many hot wires at once
      (glowFew 0.22, further flared by the output volume), bright.
    */
    speaking: {
      speed: 2.2,
      wander: 0.3,
      turb: 0.85,
      glow: 2.4,
      glowFew: 0.22,
      exposure: 170,
      scatter: 0.0075,
      alphaGain: 2.5
    }
  },
  // the tint carries the at-a-glance read, as in chords: neutral at rest,
  // cooled while searching, warmed while answering
  stateColors: {
    idle: { tint: "#ffffff" },
    thinking: { tint: "#c3d2ff" },
    speaking: { tint: "#ffd9c4" }
  }
},
  "shdr-23": {
  key: "shdr-23",
  label: "SHDR-23",
  note: "an ASCII glyph matrix in CRT green, wrapped on the ball",
  frag: "\nvoid main() {\n  // Volume coupling: user input densifies the glyphs, agent output turns\n  // the phosphor up \u2014 the matrix visibly burns brighter while it speaks.\n  float densBias = uP_density + 0.2 * uInput;\n  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);\n\n  // resolution-relative glyph grid \u2014 same character count at every size\n  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);\n  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);\n  vec2 cellCentre = (cellIdx + 0.5) * cellPx;\n  vec2 g = fract(gl_FragCoord.xy / cellPx); // 0..1 inside the cell\n\n  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);\n  vec2 uv = suv / uP_radius;\n  float r2 = dot(uv, uv);\n\n  // blocky silhouette, cut on the cell grid like the rest of the matrix\n  float mask = 1.0 - step(1.0, r2);\n\n  float z = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(uv, z);\n\n  // rotating dome, stereographic projection \u2014 the weave compresses toward\n  // the rim and rolls around the ball as the dome turns\n  float rot = uP_spin; // integrated clock\n  float cr = cos(rot);\n  float sr = sin(rot);\n  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);\n  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;\n\n  /*\n    Three motions, one per state, each on its OWN integrated clock so a\n    state change morphs the movement instead of jumping it:\n\n      DRIFT   diagonal lava-flow streaming        (idle)\n      SCROLL  vertical paging, terminal-style     (thinking)\n      PULSE   radial waves radiating from centre  (speaking)\n\n    The clocks are rates in the presets \u2014 a rate gliding to zero freezes\n    that motion in place, phase intact. The pulse's amplitude is a separate\n    non-integrated param, so idle carries no static rings.\n  */\n  float driftT = uP_drift;   // integrated clock: diagonal stream\n  float scrollT = uP_scroll; // integrated clock: vertical paging\n  float t = uP_speed;        // integrated clock: pulse phase\n  vec2 flow = vec2(driftT * 0.6, -driftT * 0.45 - scrollT);\n\n  float field = fbm(p2 + flow);\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  float dens = clamp((field - 0.5) * 1.8 + densBias + 0.4 * uP_light * lambert\n    + uP_pulse * 0.35 * sin(length(uv) * 5.5 - t * 2.4), 0.0, 1.0);\n\n  /*\n    The glyph: four dash rows split by three stripe gaps. Rows light from\n    the bottom as density rises \u2014 the step() against the row index IS the\n    ASCII quantizer, so a cell is always a whole character.\n  */\n  float rowI = floor(g.y * 4.0);\n  float bar = step(0.22, fract(g.y * 4.0)) * step(fract(g.y * 4.0), 0.9);\n  float stripe = step(0.18, fract(g.x * 3.0));\n  float lit = step(rowI + 0.5, dens * 4.0 * gainNow);\n  float glyph = bar * stripe * lit;\n\n  /*\n    Blocky dropouts: the same field, resampled on a 2x2 super-grid and\n    thresholded. Because whole super-cells fail together, the dark zones\n    become hard rectangular holes instead of dim characters.\n  */\n  vec2 superCentre = (floor(cellIdx / 2.0) * 2.0 + 1.0) * cellPx;\n  vec2 sSuv = (2.0 * superCentre - uRes) / min(uRes.x, uRes.y);\n  vec2 sUv2 = sSuv / uP_radius;\n  float sz = sqrt(max(1.0 - dot(sUv2, sUv2), 0.0));\n  vec3 ssp = vec3(sUv2.x * cr - sz * sr, sUv2.y, sUv2.x * sr + sz * cr);\n  float superField = fbm(ssp.xy / (abs(ssp.z) + 1.2) * uP_scale * 3.0 + flow);\n  float keep = step(uP_dropout, superField + 0.15 * uOutput);\n  glyph *= keep;\n\n  // phosphor ramp: deep green floor to hot glow, whitening at the top end\n  vec3 glyphCol = mix(uC_deep, uC_glow, dens);\n  glyphCol += vec3(0.7, 1.0, 0.9) * pow(dens, 3.0) * 0.35;\n\n  // a dark body under the matrix plus a glow-coloured fresnel rim, so the\n  // orb reads as a solid ball and not loose characters\n  float fres = pow(1.0 - z, 2.2);\n  vec3 col = uC_deep * 0.22 + glyphCol * glyph + uC_glow * fres * uP_rim;\n\n  col = pow(max(col, 0.0), vec3(uP_contrast));\n\n  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply \u2014\n  // the opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(col * a, a);\n}\n",
  params: [
    { key: "drift", label: "Drift", min: 0, max: 10, step: 0.05, default: 0.55, integrate: true },
    { key: "scroll", label: "Scroll", min: 0, max: 10, step: 0.05, default: 0.05, integrate: true },
    { key: "speed", label: "Pulse rate", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "pulse", label: "Pulse depth", min: 0, max: 2, step: 0.01, default: 0 },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.12, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "cells", label: "Glyph grid", min: 16, max: 120, step: 2, default: 40 },
    { key: "scale", label: "Field scale", min: 0.3, max: 10, step: 0.1, default: 1.6 },
    { key: "density", label: "Glyph density", min: 0, max: 2, step: 0.01, default: 0.48 },
    { key: "dropout", label: "Dropout", min: 0, max: 1, step: 0.01, default: 0.48 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.6 },
    { key: "rim", label: "Rim glow", min: 0, max: 3, step: 0.015, default: 0.45 },
    { key: "gain", label: "Phosphor gain", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 }
  ],
  colors: [
    { key: "glow", label: "Glow", default: "#57ffc9" },
    { key: "deep", label: "Deep", default: "#0b3b2d" }
  ],
  /*
    Each state ANIMATES differently — its own kind of motion, not just its
    own speed — and each has its own phosphor colour. Every motion has its own integrated clock, so a rate gliding to zero
    freezes that motion in place with its phase intact; the pulse depth is
    an amplitude.
  */
  statePresets: {
    /*
      idle DRIFTS: slow diagonal lava-flow, lazy roll — on a far finer,
      sparser screen than the working states. The glyph grid is nearly
      doubled and the field scale tripled, with the density down by a third
      and half the dropout, so the matrix reads as a fine violet mesh under
      a strong key light and a bright rim, slightly dimmed.
    */
    idle: {
      drift: 0.55,
      scroll: 0.05,
      pulse: 0,
      speed: 0.52,
      spin: 0.12,
      cells: 68,
      scale: 5.1,
      density: 0.31,
      dropout: 0.24,
      light: 1.11,
      rim: 0.66,
      gain: 0.9
    },
    /*
      thinking STREAMS: the drift runs at six times idle with a steady
      vertical scroll under it and a pulse near speaking depth, on a dome
      almost stopped — the matrix pours across the ball rather than paging.
      The finest grid of the three and the least dropout, so the field is
      nearly solid, on idle's field scale with a touch more contrast.
    */
    thinking: {
      drift: 3.05,
      scroll: 0.65,
      pulse: 0.58,
      speed: 0.45,
      spin: 0.04,
      cells: 86,
      density: 0.33,
      dropout: 0.13,
      light: 0.855,
      rim: 0.51,
      contrast: 1.3,
      gain: 0.95
    },
    /*
      speaking PULSES, hard: radial waves at more than double the thinking
      depth, driven at five times its rate, radiate through the glyphs while
      the dome rolls at nearly a full spin. The grid goes to its finest and
      the field scale past idle's, with the densest glyphs and the heaviest
      dropout of the three — a coarse, flickering red screen — under a dim
      key light with the phosphor gain tripled.
    */
    speaking: {
      drift: 0.4,
      scroll: 0.1,
      pulse: 1.27,
      speed: 2.85,
      spin: 1.05,
      cells: 120,
      scale: 7.2,
      density: 0.56,
      dropout: 0.59,
      light: 0.39,
      rim: 0.51,
      gain: 2.95
    }
  },
  // violet at rest, aqua while searching, red while answering
  stateColors: {
    idle: { glow: "#6a57ff" },
    thinking: { glow: "#57ffe3" },
    speaking: { glow: "#ff5757" }
  }
},
  "shdr-24": {
  key: "shdr-24",
  label: "SHDR-24",
  note: "a Minecraft Earth — a perfect voxel sphere whose seasons cycle it through lush, cherry-grove, ice, mesa and desert worlds",
  frag: "\n#define STEPS 160\n\n// Per-fragment state, resolved once in main() before the march.\nvec3 ckDrift;\nfloat ckVs;\nfloat ckMaxH;\nfloat ckSeaN;\n// Climate weights (lush, desert, ice, mesa) plus the cherry grove \u2014 a\n// partition of unity driven by the integrated season clock \u2014 and the tree\n// density they imply.\nvec4 ckClim;\nfloat ckCherry;\nfloat ckTreeMul;\n\n// Tree-cell lookup results (GLSL ES 1.0 has no out-struct ergonomics).\nvec3 ckTreeDir;\nfloat ckTreeH1;\nfloat ckTreeH2;\n\nmat2 ckRot(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\n// Seam-free noise on the direction sphere: tri-planar sum of the prelude's\n// 2D value noise, range-stretched (see the header) and clamped so the\n// terrain bound stays a true bound.\nfloat ckN3(vec3 p) {\n  float v = (noise(p.xy) + noise(p.yz + 19.1) + noise(p.zx + 47.3)) / 3.0;\n  return clamp(0.5 + (v - 0.5) * 1.9, 0.0, 1.0);\n}\n\n// The raw terrain field for a surface direction, 0..1. Two octaves only \u2014\n// the voxel grid quantizes away anything finer.\nfloat ckField(vec3 dir) {\n  vec3 q = dir * uP_scale + ckDrift;\n  return ckN3(q) * 0.65 + ckN3(q * 2.6 + 31.7) * 0.35;\n}\n\n// Local terrain radius. Relief is strictly ADDITIVE above the unit sphere:\n// oceans and plains sit exactly on it, mountains climb from the shoreline.\n// Under the mesa climate the relief terraces into three-block steps \u2014\n// flat-topped buttes and benches, the badlands profile.\nfloat ckTerrain(vec3 dir) {\n  // the mesa amplifies its relief into big banded towers\n  float h = 1.0 + uP_rough * max(ckField(dir) - ckSeaN, 0.0) * 1.2\n    * (1.0 + ckClim.w * 0.8);\n  float stepH = 3.0 * ckVs;\n  float hq = 1.0 + floor((h - 1.0) / stepH) * stepH;\n  return mix(h, hq, ckClim.w * 0.85);\n}\n\n// The continent-scale biome field: below 0.3 desert, above 0.58 forest,\n// plains between. Drifts with the terrain so biomes move with their land.\nfloat ckBiome(vec3 dir) {\n  return ckN3(dir * 1.3 + ckDrift + 57.9);\n}\n\n/*\n  Which tree cell does this direction fall in? The direction is projected\n  onto its dominant cube face and quantized there \u2014 every voxel along a\n  radial line lands in the same cell, which is what keeps a tree's trunk\n  and canopy agreeing across grid levels. The anchor direction is rebuilt\n  from the jittered cell centre.\n*/\nvoid ckTreeCell(vec3 dir) {\n  vec3 ad = abs(dir);\n  vec2 fuv;\n  float face;\n  if (ad.x >= ad.y && ad.x >= ad.z) {\n    fuv = dir.yz / ad.x;\n    face = dir.x > 0.0 ? 0.0 : 1.0;\n  } else if (ad.y >= ad.z) {\n    fuv = dir.xz / ad.y;\n    face = dir.y > 0.0 ? 2.0 : 3.0;\n  } else {\n    fuv = dir.xy / ad.z;\n    face = dir.z > 0.0 ? 4.0 : 5.0;\n  }\n  float grid = max(uP_blocks / 6.0, 2.0);\n  vec2 cell = floor((fuv * 0.5 + 0.5) * grid);\n  ckTreeH1 = hash(cell * 1.17 + face * 19.3);\n  ckTreeH2 = hash(cell * 0.71 + face * 7.7 + 9.3);\n  vec2 jit = vec2(hash(cell + 7.1 + face), hash(cell + 13.7 + face)) - 0.5;\n  vec2 auv = ((cell + 0.5 + jit * 0.3) / grid) * 2.0 - 1.0;\n  vec3 cp;\n  if (face < 1.5) cp = vec3(face < 0.5 ? 1.0 : -1.0, auv.x, auv.y);\n  else if (face < 3.5) cp = vec3(auv.x, face < 2.5 ? 1.0 : -1.0, auv.y);\n  else cp = vec3(auv.x, auv.y, face < 4.5 ? 1.0 : -1.0);\n  ckTreeDir = normalize(cp);\n}\n\n/*\n  The world function: what fills this voxel?\n    0 air   1 ground   2 trunk   3 leaves\n  Ground is the terrain sphere; caves are carved ONLY where the ground has\n  risen above the base sphere, so the smooth lowlands stay pristine. Water\n  is not a voxel here \u2014 ocean surface blocks are painted as water in the\n  material pass. Trees grow radially from dry anchors below the tree line,\n  dense where the biome says forest.\n*/\nfloat ckVoxel(vec3 cc) {\n  float r = length(cc);\n  vec3 dir = cc / max(r, 1.0e-4);\n  if (r < ckMaxH) {\n    float h = ckTerrain(dir);\n    if (r < h) {\n      // carve caves into risen ground only \u2014 mountainsides get entrances,\n      // the perfect lowland sphere keeps its silhouette\n      if (h > 1.0 + 1.5 * ckVs) {\n        float cv = ckN3(cc * (uP_scale * 1.9) + 71.3);\n        float cw = uP_cave * 0.16 * smoothstep(ckMaxH, ckMaxH - 0.45, r);\n        if (abs(cv - 0.5) < cw) return 0.0;\n      }\n      return 1.0;\n    }\n  }\n  // trees live in a thin shell above the tallest terrain\n  if (r < ckMaxH + 8.0 * ckVs && uP_trees > 0.001) {\n    ckTreeCell(dir);\n    float thrMax = clamp(uP_trees, 0.0, 1.0) * 0.8;\n    if (ckTreeH1 > 1.0 - thrMax) {\n      // forest density comes from the biome at the ANCHOR, so a whole\n      // tree agrees with itself about existing\n      float bioA = ckBiome(ckTreeDir);\n      float dens = bioA > 0.58 ? 1.0 : (bioA > 0.3 ? 0.25 : 0.0);\n      dens *= ckTreeMul; // forests thin out under desert, ice and mesa skies\n      if (ckTreeH1 > 1.0 - thrMax * dens) {\n        float fA = ckField(ckTreeDir);\n        float ha = 1.0 + uP_rough * max(fA - ckSeaN, 0.0) * 1.2;\n        // dry land only, below the stone tree line\n        if (fA > ckSeaN + 0.015 && ha < 1.0 + uP_rough * 0.42) {\n          float lat = length(cc - dot(cc, ckTreeDir) * ckTreeDir);\n          if (ckClim.z > 0.5) {\n            // ICE SPIKES: the lattice grows tapering packed-ice spires in\n            // place of trees. Squaring the height hash makes many stubs\n            // and a few tall spires, the ice-plains skyline.\n            float spikeH = (2.0 + 6.0 * ckTreeH2 * ckTreeH2) * ckVs;\n            float w = mix(1.15, 0.3, clamp((r - ha) / spikeH, 0.0, 1.0)) * ckVs;\n            if (lat < w && r > ha - ckVs && r < ha + spikeH) return 3.0;\n          } else if (ckClim.w > 0.5) {\n            // CACTI: short green columns dotting the badlands flats\n            float cacH = (1.5 + 2.0 * ckTreeH2) * ckVs;\n            if (lat < 0.6 * ckVs && r > ha - ckVs && r < ha + cacH) return 3.0;\n          } else if (ckCherry > 0.5) {\n            // CHERRY GROVE: broad flat blossom puffs on short dark trunks \u2014\n            // the radial component of the canopy test is stretched, which\n            // squashes the puff wide and flat like the cherry grove trees\n            float trunkTop = ha + (2.0 + 1.5 * ckTreeH2) * ckVs;\n            if (lat < 0.75 * ckVs && r > ha - ckVs && r < trunkTop) return 2.0;\n            vec3 dd = cc - ckTreeDir * (trunkTop + 0.6 * ckVs);\n            dd += ckTreeDir * dot(dd, ckTreeDir) * 0.8;\n            vec3 lv = floor(cc / ckVs);\n            float rag = hash(lv.xy * 0.61 + lv.z * 2.23);\n            if (length(dd) < (2.2 + 0.5 * rag) * ckVs) return 3.0;\n          } else {\n            float trunkTop = ha + (2.5 + 2.0 * ckTreeH2) * ckVs;\n            if (lat < 0.75 * ckVs && r > ha - ckVs && r < trunkTop) return 2.0;\n            vec3 dd = cc - ckTreeDir * (trunkTop + 0.7 * ckVs);\n            // canopy radius re-hashed per voxel \u2014 ragged blocky foliage\n            vec3 lv = floor(cc / ckVs);\n            float rag = hash(lv.xy * 0.61 + lv.z * 2.23);\n            if (length(dd) < (1.7 + 0.5 * rag) * ckVs) return 3.0;\n          }\n        }\n      }\n    }\n  }\n  return 0.0;\n}\n\nvoid main() {\n  // Volume coupling: agent output stokes the glow, the gain and the molten\n  // core; user input brightens the key light.\n  float glowNow = uP_glow * (0.7 + 1.0 * uOutput);\n  float gainNow = uP_gain * (0.9 + 0.3 * uOutput);\n  float lightNow = uP_light * (1.0 + 0.3 * uInput);\n\n  // the terrain field drifts on its own integrated clock \u2014 in the thinking\n  // state it streams, and blocks pop in and out like chunks loading\n  ckDrift = vec3(uP_drift * 0.31, uP_drift * 0.17, -uP_drift * 0.23);\n\n  /*\n    CLIMATE: the integrated season clock carries the planet through four\n    worlds \u2014 lush, desert, ice, mesa \u2014 on a cycle. The triangular weights\n    overlap so exactly two adjacent climates crossfade at any moment, and\n    because the clock integrates, changing the season rate never snaps the\n    phase: the world just weathers faster or slower.\n  */\n  // five worlds in crossfade order: lush, cherry, ice, mesa, desert \u2014\n  // blossom thaws into snow, terracotta dries into sand\n  float t5 = fract(uP_season * 0.05) * 5.0;\n  ckClim = vec4(\n    clamp(1.0 - min(abs(t5), abs(t5 - 5.0)), 0.0, 1.0), // lush (wraps)\n    clamp(1.0 - abs(t5 - 4.0), 0.0, 1.0),               // desert\n    clamp(1.0 - abs(t5 - 2.0), 0.0, 1.0),               // ice\n    clamp(1.0 - abs(t5 - 3.0), 0.0, 1.0)                // mesa\n  );\n  ckCherry = clamp(1.0 - abs(t5 - 1.0), 0.0, 1.0);      // cherry grove\n  // ice and cherry run HIGH (dense spikes / dense groves); mesa keeps cacti\n  ckTreeMul = dot(ckClim, vec4(1.0, 0.15, 0.9, 0.3)) + ckCherry * 0.9;\n\n  ckVs = 2.0 / clamp(uP_blocks, 8.0, 96.0);   // voxel size, planet radius 1\n  // sea level in FIELD space: 0.5 puts about half the sphere under water\n  ckSeaN = 0.25 + clamp(uP_sea, 0.0, 1.0) * 0.5;\n  // tallest possible terrain \u2014 sized for the mesa's amplified towers so\n  // the viewport holds steady while the seasons turn\n  ckMaxH = 1.0 + uP_rough * (1.0 - ckSeaN) * 1.2 * 1.8 + 0.001;\n  float bound = ckMaxH + 8.5 * ckVs;          // ...plus the tree shell\n\n  vec2 uv = orbUV() / uP_radius;\n\n  // orthographic camera, viewport sized to the bound so the treetops fit\n  vec3 ro = vec3(uv * bound, 2.9);\n  vec3 rd = vec3(0.0, 0.0, -1.0);\n\n  // rotate the RAY into object space (inverse tumble) \u2014 the grid stays\n  // axis-aligned, the planet appears to spin. The light rotates along,\n  // keeping the sun fixed relative to the viewer.\n  mat2 tiltM = ckRot(uP_tilt); // positive tilt looks DOWN at the north pole\n  mat2 spinM = ckRot(-uP_spin); // integrated clock\n  ro.yz = tiltM * ro.yz;\n  ro.xz = spinM * ro.xz;\n  rd.yz = tiltM * rd.yz;\n  rd.xz = spinM * rd.xz;\n  vec3 Lo = normalize(vec3(-0.5, 0.7, 0.55));\n  Lo.yz = tiltM * Lo.yz;\n  Lo.xz = spinM * Lo.xz;\n\n  // DDA needs nonzero direction components \u2014 nudge, keep the sign\n  vec3 sgn = vec3(\n    rd.x >= 0.0 ? 1.0 : -1.0,\n    rd.y >= 0.0 ? 1.0 : -1.0,\n    rd.z >= 0.0 ? 1.0 : -1.0\n  );\n  rd = normalize(sgn * max(abs(rd), vec3(1.0e-4)));\n\n  // analytic bounding sphere: empty pixels exit here, and the march below\n  // only ever walks the chord inside the bound\n  float b = dot(rd, ro);\n  float c = dot(ro, ro) - bound * bound;\n  float disc = b * b - c;\n  if (disc < 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n  float sq = sqrt(disc);\n  vec3 p0 = ro + rd * (-b - sq + ckVs * 0.001);\n  float tSpan = 2.0 * sq;\n\n  // Amanatides & Woo init: current voxel, per-axis distance to the next\n  // grid plane, per-axis crossing stride\n  vec3 vp = floor(p0 / ckVs);\n  vec3 tDelta = ckVs / abs(rd);\n  vec3 tMax = ((vp + step(vec3(0.0), rd)) * ckVs - p0) / rd;\n\n  float mat = 0.0;\n  vec3 mask = vec3(0.0, 0.0, 1.0); // first-voxel fallback: face the viewer\n  float tCur = 0.0;\n\n  for (int i = 0; i < STEPS; i++) {\n    float m = ckVoxel((vp + 0.5) * ckVs);\n    if (m > 0.5) {\n      mat = m;\n      break;\n    }\n    // step to the next voxel across the nearest grid plane\n    if (tMax.x < tMax.y && tMax.x < tMax.z) {\n      tCur = tMax.x;\n      tMax.x += tDelta.x;\n      vp.x += sgn.x;\n      mask = vec3(1.0, 0.0, 0.0);\n    } else if (tMax.y < tMax.z) {\n      tCur = tMax.y;\n      tMax.y += tDelta.y;\n      vp.y += sgn.y;\n      mask = vec3(0.0, 1.0, 0.0);\n    } else {\n      tCur = tMax.z;\n      tMax.z += tDelta.z;\n      vp.z += sgn.z;\n      mask = vec3(0.0, 0.0, 1.0);\n    }\n    if (tCur > tSpan) break; // left the bound: miss\n  }\n\n  if (mat < 0.5) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  // the hit voxel, its radial \"up\", and the face that was struck\n  vec3 cc = (vp + 0.5) * ckVs;\n  float r = length(cc);\n  vec3 dir = cc / max(r, 1.0e-4);\n  vec3 n = -mask * sgn;\n  vec3 hp = p0 + rd * tCur;\n\n  // per-voxel hashes: core phase and material variety\n  vec2 vseed = vec2(dot(vp, vec3(1.0, 57.0, 113.0)), dot(vp, vec3(27.0, 7.0, 91.0)));\n  float h1 = hash(vseed * 0.013);\n  float h2 = hash(vseed * 0.029 + 5.7);\n\n  // block-texture grain: a 4x4 hash grid on the struck face\n  vec2 uvFace;\n  if (mask.x > 0.5) uvFace = hp.yz;\n  else if (mask.y > 0.5) uvFace = hp.xz;\n  else uvFace = hp.xy;\n  float grain = hash(floor(fract(uvFace / ckVs) * 4.0) * 0.37 + vseed * 0.11);\n  float texMul = mix(1.0, 0.72 + 0.55 * grain, uP_texture);\n\n  // flat face lambert + radial wrap for roundness + crevice AO\n  float lam = clamp(dot(n, Lo), 0.0, 1.0);\n  float wrap = clamp(dot(dir, Lo) * 0.5 + 0.5, 0.0, 1.0);\n  float ao = 0.55 + 0.45 * clamp(dot(n, dir) * 0.5 + 0.5, 0.0, 1.0);\n  float shade = (0.32 + 0.5 * wrap * wrap + 0.85 * lam * lightNow) * ao;\n\n  vec3 col;\n  if (mat < 1.5) {\n    float f = ckField(dir);\n    float h = 1.0 + uP_rough * max(f - ckSeaN, 0.0) * 1.2;\n    float depth = h - r;\n    float topF = step(depth, ckVs * 1.15);\n\n    /*\n      The climate palette. Every material the strata paint with is a\n      blend over the four climate weights: snow caps the ice world, the\n      mesa runs banded terracotta hashed per RADIAL LAYER (the same band\n      wraps the whole planet, the badlands look), desert bleaches the\n      land to sand, and lush keeps the tunable colours.\n    */\n    vec3 snow = vec3(0.92, 0.95, 1.0);\n    /*\n      Mesa strata: two-block-tall bands hashed per radial layer, weighted\n      the way real badlands run \u2014 long terracotta stretches broken by\n      thin red, white, yellow and dark-brown accent stripes. The same\n      band circles the whole planet at its height.\n    */\n    float layer = hash(vec2(floor(r / (ckVs * 2.0)) * 0.371, 5.3));\n    vec3 mesaBand = layer < 0.5 ? vec3(0.74, 0.42, 0.21)\n      : (layer < 0.68 ? vec3(0.63, 0.26, 0.15)\n      : (layer < 0.8 ? vec3(0.88, 0.79, 0.67)\n      : (layer < 0.9 ? vec3(0.84, 0.65, 0.27) : vec3(0.4, 0.25, 0.18))));\n    // mesa tops: red-sand flats low down, banded rock on the risen buttes\n    vec3 mesaTop = mix(vec3(0.72, 0.38, 0.2), mesaBand, step(1.0 + uP_rough * 0.1, h));\n    vec3 climGrass = uC_grass * ckClim.x + uC_sand * ckClim.y\n      + snow * ckClim.z + mesaTop * ckClim.w\n      + mix(uC_grass, vec3(0.62, 0.85, 0.3), 0.6) * ckCherry; // vivid meadow\n    vec3 climDirt = uC_dirt * (ckClim.x + ckClim.y + ckCherry)\n      + uC_dirt * vec3(0.75, 0.85, 1.05) * ckClim.z + mesaBand * ckClim.w;\n    vec3 climSand = uC_sand * (ckClim.x + ckClim.y + ckCherry)\n      + mix(uC_sand, snow, 0.9) * ckClim.z + vec3(0.72, 0.35, 0.2) * ckClim.w;\n    vec3 climWater = uC_water * (ckClim.x + ckClim.y + ckCherry)\n      + vec3(0.62, 0.82, 0.92) * ckClim.z\n      + mix(uC_water, vec3(0.42, 0.3, 0.22), 0.4) * ckClim.w;\n\n    if (topF > 0.5 && f < ckSeaN) {\n      // OCEAN: the surface of the perfect sphere painted as water \u2014\n      // lighter over coastal shallows, deep blue mid-ocean, with a sun\n      // glint and a shimmer on the flow clock. The ice world stills the\n      // shimmer and pales the depths: a frozen sheet.\n      float deep = clamp((ckSeaN - f) / 0.12, 0.0, 1.0) * (1.0 - 0.55 * ckClim.z);\n      vec3 wc = climWater * mix(1.3, 0.55, deep);\n      float shim = 0.85 + 0.25 * sin(uAnim * 2.5 + grain * 6.2831 + dir.x * 4.0);\n      shim = mix(shim, 1.02, ckClim.z);\n      col = wc * (0.45 + 0.55 * wrap) * shim + wc * lam * 0.35;\n    } else {\n      /*\n        LAND. Strata by radial depth below the local surface \u2014 grass or\n        desert sand on the outward faces of surface blocks, mud with\n        hashed stone patches beneath, then ore-seamed stone. Elevation\n        overrides the biome: rising ground bares brown hillsides, peaks\n        stand as naked stone, and every shore gets a sand band.\n      */\n      float dirtF = step(depth, ckVs * 2.4);\n      float up = clamp(dot(n, dir), 0.0, 1.0);\n\n      vec3 albedo = mix(uC_stone, climDirt, dirtF);\n      // stone patches in the exposed mud, below the grass line\n      albedo = mix(albedo, uC_stone, dirtF * (1.0 - topF) * step(h2, 0.3));\n\n      float bio = ckBiome(dir);\n      float desertF = step(bio, 0.3);\n      albedo = mix(albedo, climGrass, topF * step(0.45, up) * (1.0 - desertF));\n      albedo = mix(albedo, climSand, desertF * dirtF); // desert sand runs deep\n      // elevation bands: brown hillsides, then bare stone peaks \u2014 both\n      // buried under snow when the ice climate holds (frozen peaks stay\n      // white with only crevice shadow, not brown or gray)\n      albedo = mix(albedo, climDirt,\n        topF * step(1.0 + uP_rough * 0.28, h) * 0.85 * (1.0 - 0.9 * ckClim.z));\n      albedo = mix(albedo, uC_stone,\n        topF * step(1.0 + uP_rough * 0.45, h) * (1.0 - 0.85 * ckClim.z));\n      // beach: a narrow field-space band above the shoreline turns to sand\n      albedo = mix(albedo, climSand, topF * step(abs(f - ckSeaN - 0.017), 0.018));\n\n      // the coarse cluster cells serve ore veins AND glacier patches\n      vec3 oc = floor(cc / (2.5 * ckVs));\n      vec2 oseed = vec2(dot(oc, vec3(1.0, 57.0, 113.0)), dot(oc, vec3(27.0, 7.0, 91.0)));\n      float fleck = step(0.5, hash(floor(fract(uvFace / ckVs) * 4.0) * 0.53 + oseed * 0.19));\n\n      // ICE climate: packed-ice blue patches cluster over the risen\n      // ground \u2014 glacier faces streaking the snowy mountainsides\n      float icePatch = ckClim.z * step(hash(oseed * 0.023 + 9.1), 0.5)\n        * step(1.0 + uP_rough * 0.06, h);\n      albedo = mix(albedo, vec3(0.55, 0.7, 0.92), icePatch * (0.45 + 0.4 * fleck));\n\n      /*\n        Ore veins: a coarse cell grid hashes veins into the deep stone, so\n        ore comes in multi-block clusters like the cross-section dioramas.\n        Each vein rolls a type \u2014 diamond (the tunable ore colour), lapis\n        (a deep-blue remap of it), or coal (unlit) \u2014 and each ore block is\n        stone FLECKED with the hue on its texture grain, the way the\n        actual ore tile is drawn. Only the flecks glow.\n      */\n      float veinF = (1.0 - dirtF) * step(1.0 - uP_ore, hash(oseed * 0.017)) * step(h1, 0.8);\n      float oreType = hash(oseed * 0.041 + 2.9);\n      vec3 oreHue = oreType < 0.4\n        ? uC_ore\n        : (oreType < 0.75 ? uC_ore * vec3(0.25, 0.45, 1.2) : vec3(0.16));\n      float oreLit = oreType < 0.75 ? 1.0 : 0.0;\n      albedo = mix(albedo, oreHue, veinF * (0.2 + 0.65 * fleck));\n      float twinkle = 0.55 + 0.45 * sin(uP_shuffle + hash(oseed * 0.013) * 37.0); // integrated clock\n\n      // depth below the surface darkens: cave interiors and cleft walls\n      // sink into shadow, which makes the glow read as underground\n      float depthDim = mix(1.0, 0.62, clamp(depth / max(uP_rough * 0.9, 0.05), 0.0, 1.0));\n\n      // the deeper the rock, the closer to the molten core\n      float coreR = 1.0 - uP_rough * 0.6;\n      float coreF = uP_core * smoothstep(coreR + 0.15, coreR - 0.05, r);\n\n      vec3 emis = oreHue * veinF * fleck * oreLit * glowNow * twinkle\n        + uC_lava * coreF * (0.9 + 0.4 * sin(uP_shuffle * 1.6 + h1 * 51.0))\n          * (0.6 + 1.4 * uOutput);\n\n      col = albedo * shade * depthDim + emis;\n    }\n  } else if (mat < 2.5) {\n    // trunk: dark wood, derived from the mud so the palette stays small\n    col = uC_dirt * 0.5 * shade;\n  } else {\n    // leaves: heavier grain reads as foliage clumps. Under the ice climate\n    // this material IS the spikes, so it turns packed-ice blue and the\n    // grain smooths toward faceted ice.\n    vec3 climLeaf = uC_leaf * (ckClim.x + ckClim.y * 0.9)\n      + vec3(0.62, 0.76, 0.95) * ckClim.z\n      + mix(uC_leaf, vec3(0.45, 0.62, 0.25), 0.5) * ckClim.w // cactus green\n      + vec3(0.93, 0.7, 0.82) * ckCherry; // blossom pink\n    col = climLeaf * shade;\n    float leafGrain = mix(0.5 + 0.9 * grain, 0.85 + 0.3 * grain, ckClim.z);\n    texMul = mix(1.0, leafGrain, uP_texture);\n  }\n\n  col *= texMul * gainNow;\n  col = pow(max(col, 0.0), vec3(uP_contrast));\n\n  // Surface-lit orb bounded by the hit test: alpha IS coverage, and a hit\n  // is fully opaque \u2014 premultiplied output, trivially (see shdr-28).\n  gl_FragColor = vec4(col, 1.0);\n}\n",
  params: [
    { key: "spin", label: "Spin", min: 0, max: 5, step: 0.03, default: 0.22, integrate: true },
    { key: "tilt", label: "Tilt", min: 0, max: 4, step: 0.02, default: 0.45 },
    { key: "drift", label: "Terrain drift", min: 0, max: 10, step: 0.05, default: 0.12, integrate: true },
    { key: "season", label: "Season rate", min: 0, max: 10, step: 0.05, default: 0.3, integrate: true },
    { key: "shuffle", label: "Ember rate", min: 0, max: 20, step: 0.1, default: 0.8, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 1.15 },
    { key: "blocks", label: "Blocks", min: 16, max: 96, step: 1, default: 64 },
    { key: "rough", label: "Mountains", min: 0, max: 0.8, step: 0.01, default: 0.45 },
    { key: "scale", label: "Terrain scale", min: 0.5, max: 8, step: 0.05, default: 2.4 },
    { key: "sea", label: "Sea level", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "trees", label: "Trees", min: 0, max: 1, step: 0.01, default: 0.75 },
    { key: "cave", label: "Caves", min: 0, max: 1, step: 0.01, default: 0.4 },
    { key: "ore", label: "Ore density", min: 0, max: 0.6, step: 0.01, default: 0.12 },
    { key: "glow", label: "Ore glow", min: 0, max: 5, step: 0.03, default: 0.9 },
    { key: "core", label: "Molten core", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "texture", label: "Texture grain", min: 0, max: 1, step: 0.01, default: 0.6 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 1 },
    { key: "gain", label: "Gain", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 }
  ],
  colors: [
    { key: "grass", label: "Grass", default: "#6abe30" },
    { key: "dirt", label: "Mud", default: "#6f4a2f" },
    { key: "stone", label: "Stone", default: "#8a8a90" },
    { key: "sand", label: "Sand", default: "#dbcf9c" },
    { key: "water", label: "Water", default: "#2f66d0" },
    { key: "leaf", label: "Leaves", default: "#3e8f27" },
    { key: "ore", label: "Ore", default: "#4de3ff" },
    { key: "lava", label: "Lava", default: "#ff7b26" }
  ],
  /*
    Each state animates DIFFERENTLY on the integrated clocks — same palette
    and biomes throughout (no stateColors on purpose):

      idle DRIFTS      lazy spin, terrain barely morphing, embers twinkling
      thinking LOADS   the spin all but stops while the terrain field
                       streams — continents morph and blocks pop in and out
                       like chunks loading — and the ore twinkle races
      speaking ERUPTS  the planet turns fast to answer, the molten core
                       blazes through the caves, ore glow flares
  */
  statePresets: {
    idle: {
      spin: 0.22,
      drift: 0.12,
      season: 0.3,
      shuffle: 0.8,
      glow: 0.9,
      core: 0.5,
      gain: 1,
      light: 1
    },
    // thinking races the seasons as well as the terrain: the planet cycles
    // through its worlds while it considers
    thinking: {
      spin: 0.04,
      drift: 1.7,
      season: 1.8,
      shuffle: 4.5,
      glow: 1.3,
      core: 0.35,
      gain: 0.95,
      light: 0.9
    },
    speaking: {
      spin: 0.85,
      drift: 0.35,
      season: 0.6,
      shuffle: 1.6,
      glow: 1.6,
      core: 1,
      gain: 1.1,
      light: 1.15
    }
  }
},
  "shdr-25": {
  key: "shdr-25",
  label: "SHDR-25",
  note: "the folds of a warped field, drawn by their own steepness",
  frag: "\n#define OCTAVES 8\n#define AA 2\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat creaseWarp;\nfloat creaseGain;\n\n// GLSL ES 1.0 has no scalar tanh; the prelude ships the vec3 form only.\nfloat tanh1(float x) {\n  x = clamp(x, -10.0, 10.0);\n  float e = exp(2.0 * x);\n  return (e - 1.0) / (e + 1.0);\n}\n\n/*\n  The whole chain for one pixel centre: dome, stereographic wrap, then the\n  eight-octave warp. Called three times per sample so the derivative below\n  can be differenced \u2014 see the header for why fwidth is unavailable.\n*/\nvec2 creaseField(vec2 fragCoord, float t, float drift, float sw) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec2 pl = uv / max(uP_radius, 0.001);\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n\n  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n  p += drift;\n\n  /*\n    The listing's matrix, decomposed. mat2(6,-8,8,6)/9 is exactly\n    (10/9) * mat2(.6,-.8,.8,.6), and that second factor is a true rotation\n    because 6-8-10 is a Pythagorean triple \u2014 so the octave transform is a\n    rotation through the 3-4-5 angle times a clean zoom, with the zoom\n    pulled out as a slider.\n  */\n  for (int i = 0; i < OCTAVES; i++) {\n    float fi = float(i) + 1.0;\n    p += sin(p + t + fi) * creaseWarp;\n    p = uP_zoom * (mat2(0.6, -0.8, 0.8, 0.6) * p);\n  }\n\n  return p;\n}\n\nvec3 creaseRender(vec2 fragCoord) {\n  float t = uP_speed;      // integrated clock: the boil\n  float drift = uP_drift;  // integrated clock: the slow travel\n  float sw = uP_swirl;     // integrated clock\n\n  /*\n    The three taps the difference needs. uP_blur is how far apart they sit:\n    at one pixel this is fwidth exactly, and wider is a deliberate blur \u2014\n    the derivative of a folded field is a hairline, and a rim wants width.\n  */\n  vec2 p0 = creaseField(fragCoord, t, drift, sw);\n  vec2 px = creaseField(fragCoord + vec2(uP_blur, 0.0), t, drift, sw);\n  vec2 py = creaseField(fragCoord + vec2(0.0, uP_blur), t, drift, sw);\n\n  /*\n    fwidth, by hand and once per channel. The sum of the absolute\n    differences on each axis is exactly what the built-in returns \u2014 but\n    taking it three times at slightly offset ripple phases puts each\n    channel's rim in a slightly different place, which is where the warm\n    and cool fringes on the edges come from. One field evaluation still\n    serves all three.\n  */\n  vec3 e;\n  for (int c = 0; c < 3; c++) {\n    float ph = float(c) * uP_fringe;\n    vec2 v0 = sin(p0 * uP_ripple + ph);\n    vec2 d = abs(sin(px * uP_ripple + ph) - v0)\n           + abs(sin(py * uP_ripple + ph) - v0);\n    float m = tanh1(length(d) * creaseGain / max(uP_exposure, 0.001));\n    if (c == 0) e.r = m;\n    else if (c == 1) e.g = m;\n    else e.b = m;\n  }\n\n  e = pow(clamp(e, 0.0, 1.0), vec3(uP_contrast));\n\n  vec3 col = uC_tint * e;\n\n  // a dark body under the filigree, so the flat regions read as the ball\n  col += uC_body * uP_floorLevel;\n\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n\n  // dome shading keeps the ball a ball under the folds\n  vec2 pl = ((2.0 * fragCoord - uRes) / min(uRes.x, uRes.y)) / max(uP_radius, 0.001);\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n  vec3 n = vec3(pl, z);\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.62 + uP_light * lambert;\n\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice folds the field harder, the agent's\n  // steepens what counts as a crease.\n  creaseWarp = uP_warp * (1.0 + 0.4 * uInput);\n  creaseGain = uP_edgeGain * (1.0 + 0.5 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  // Twenty-four warp steps per sample \u2014 none of them worth paying for\n  // outside the silhouette.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += creaseRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = creaseRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Boil", min: 0.015, max: 20, step: 0.05, default: 3, integrate: true },
    { key: "drift", label: "Drift", min: 0, max: 8, step: 0.02, default: 0.6, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.05, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Cell scale", min: 0.3, max: 60, step: 0.1, default: 7.5 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.3 },
    { key: "warp", label: "Fold", min: 0, max: 2, step: 0.01, default: 0.4 },
    { key: "zoom", label: "Octave zoom", min: 0.6, max: 2, step: 0.005, default: 1.111 },
    { key: "ripple", label: "Ripple", min: 0.02, max: 3, step: 0.01, default: 0.3 },
    { key: "edgeGain", label: "Edge gain", min: 0.5, max: 60, step: 0.5, default: 10 },
    { key: "blur", label: "Rim width", min: 0.5, max: 12, step: 0.25, default: 2.5 },
    { key: "fringe", label: "Chromatic fringe", min: 0, max: 1.5, step: 0.005, default: 0.09 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 40, step: 0.05, default: 0.8 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 8, step: 0.05, default: 1.15 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.5 },
    { key: "floorLevel", label: "Body fill", min: 0, max: 2, step: 0.01, default: 0.16 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.35 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.45 }
  ],
  colors: [
    { key: "tint", label: "Rim", default: "#dbe8f7" },
    { key: "body", label: "Body", default: "#0d1118" },
    { key: "sheen", label: "Sheen", default: "#a8c8f0" }
  ],
  /*
    Staged on the FOLD, which is what makes creases exist at all, and on
    edge gain, which decides how steep a slope has to be to count as one.
    Cell scale moves only for the answer — it sets how much pattern is on
    the ball, and as it glides in the ball reads as inflating; that is the
    answer's entrance.
  */
  statePresets: {
    // at rest: a slow boil, folds moderate, rims clean — the octave zoom
    // pulled in a touch under the default and the edge gain a quarter up,
    // so slightly gentler slopes count as creases
    idle: {
      speed: 3,
      drift: 0.6,
      swirl: 0.05,
      warp: 0.4,
      zoom: 1.07,
      edgeGain: 12.5,
      exposure: 0.8,
      contrast: 1.15
    },
    /*
      searching: the folds RELAX a touch below idle, but the edge gain
      nearly triples so even the shallowest slope lights up as a crease,
      on a boil half again idle's. The ripple tightens, the rim widens with
      more than double the chromatic fringe, and the saturation, key light
      and rim sheen all come up — every cell rims at once in colour, and
      none of it settles.
    */
    thinking: {
      speed: 4.7,
      drift: 0.15,
      swirl: 0.02,
      bulge: 0.38,
      warp: 0.34,
      zoom: 1.12,
      ripple: 0.18,
      edgeGain: 33,
      blur: 2.75,
      fringe: 0.2,
      exposure: 0.55,
      contrast: 1.5,
      saturation: 2,
      light: 0.525,
      rim: 0.69
    },
    /*
      answering: the field FOLDS hardest of the three and the gain drops to
      under a sixth of the thinking state, so the creases are deep but only
      the steepest rims light. The cell scale is pushed past idle's and the
      dome bulged to near a hemisphere, the swirl opened an order of
      magnitude, the ripple widened — a slow, heavy, swirling boil, with
      the exposure tripled so what does light, burns.
    */
    speaking: {
      speed: 1.4,
      drift: 0.8,
      swirl: 0.6,
      scale: 11.5,
      bulge: 2.22,
      warp: 1.55,
      zoom: 0.945,
      ripple: 1.18,
      edgeGain: 5,
      blur: 2,
      fringe: 0.23,
      exposure: 2.35,
      contrast: 1.35
    }
  },
  // cool steel at rest, cold indigo for both working states — the answer
  // is told apart by its fold and scale, not its colour
  stateColors: {
    idle: { tint: "#dbe8f7", body: "#0d1118", sheen: "#a8c8f0" },
    thinking: { tint: "#c2d6f5", body: "#090d1c", sheen: "#8fb4f2" },
    speaking: { tint: "#c2d6f5", body: "#090d1c", sheen: "#8fb4f2" }
  }
},
  "shdr-26": {
  key: "shdr-26",
  label: "SHDR-26",
  note: "a crazed web of coloured threads knotted to a cell grid",
  frag: "\n#define OCTAVES 9\n#define AA 3\n\nconst float TAU = 6.28318530718;\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat latticePole;\nfloat latticeSharp;\nfloat latticeGain;\n\nvec3 latticeRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n  vec3 n = vec3(pl, z);\n\n  float t = uP_speed; // integrated clock\n\n  /*\n    Stereographic projection of the UNROTATED dome.\n\n    This orb was built on the abs(sp.z) form first \u2014 the one shdr-28\n    and shdr-29 use, which survives a 3D roll because the divisor can\n    only fall TO zero at the terminator, never through it. It renders, but\n    every quarter turn it makes the visible hemisphere an EXACT mirror\n    image about the view axis: at a roll of 90 degrees sp becomes\n    (-n.z, n.y, n.x), so the projected coordinate depends on n.z and on\n    abs(n.x), and both of those are even in screen x. A cellular grid\n    hides that. A web of long threads does not \u2014 the ball turns into a\n    Rorschach blot for a quarter of every revolution.\n\n    So the dome stays put, as in shdr-08, and all the motion below is\n    projection-safe 2D.\n  */\n  vec2 p = n.xy / (n.z + 1.0 + uP_bulge) * uP_scale;\n\n  // the plane turns while the lattice drifts across it, so the crazing\n  // migrates over the glaze instead of sitting welded to it\n  float sw = uP_swirl; // integrated clock\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n  p.x += uP_drift;     // integrated clock\n\n  /*\n    A fractional offset off the pattern origin. The listing carries the\n    resolution here; it cancels out of the pole term exactly (see the\n    header) but it does keep the lattice off centre, and without something\n    in its place a cell corner sits pinned at the dead middle of the ball.\n  */\n  p += vec2(0.37, 0.21);\n\n  // the cell the sample starts in, fixed before the warp \u2014 everything the\n  // pole term does is relative to THIS corner, not to wherever c wanders\n  vec2 cell = floor(p);\n\n  /*\n    Each cell knots on its own hashed phase, so the grid breathes instead\n    of pulsing as one sheet. The rate is a constant, not a slider: this\n    multiplies the integrated clock, and a slider there would jump the\n    phase of every cell on a state change.\n  */\n  float breathe = 1.0 + uP_pulse * sin(TAU * hash(cell) + t * 0.35);\n\n  vec2 c = p;\n  for (int j = 0; j < OCTAVES; j++) {\n    float i = float(j) + 1.0;\n\n    /*\n      The lattice pole, softened. d/(d*d+g) tracks 1/d away from the cell\n      corner and rolls over to a finite peak at it, so the phase stays\n      band-limited and the knot has a SIZE \u2014 uP_poleSoft is that size, and\n      it is the difference between crisp cell knots and a corner full of\n      aliased noise.\n    */\n    vec2 d = cell - c;\n    vec2 pole = latticePole * breathe * d / (d * d + vec2(uP_poleSoft));\n\n    c += uP_warp * cos(i * c.yx + pole + t) / i;\n  }\n\n  /*\n    The listing's tone map: a thin ridge every PI with an exponential\n    falloff. The per-channel offsets are kept as their original ratio\n    (0, 2, 1) so one slider widens the whole split, and against a ridge\n    this thin they separate the thread into three coloured filaments.\n  */\n  vec3 x = vec3(c.y) + vec3(0.0, 2.0, 1.0) * uP_split;\n  vec3 thread = exp(-latticeSharp * abs(sin(x)));\n\n  float lev = dot(thread, vec3(1.0 / 3.0));\n\n  /*\n    The exp() floor never reaches zero, so the shell is lit between the\n    threads by construction \u2014 the body colour is added under it rather\n    than filling a hole. The thread term stays PER-CHANNEL through the\n    palette multiply; collapsing it to lev first would throw away the\n    filament split, which is the only thing the vec4 phase was for.\n  */\n  vec3 col = uC_deep * uP_floor;\n  /*\n    The ramp between the two thread colours runs nearly the whole range of\n    lev deliberately. Started at 0.35 it reached uC_hot \u2014 which is near-white in\n    every state \u2014 across most of the visible web, and the state palettes,\n    which ride on uC_line, never got to the eye at all.\n\n    The other half of that fix is in the presets: the chromatic split makes\n    the three channels independent, so at a wide split THREAD sets the hue\n    and no palette can. It is staged with the rest \u2014 widest while\n    searching, nearly closed while answering, which is when the warm\n    palette has to carry.\n  */\n  col += thread * mix(uC_line, uC_hot, smoothstep(0.12, 1.0, lev)) * latticeGain;\n\n  /*\n    A tight second read of the same ridge, added on top: raising a value\n    that is already exp(-k*|sin|) to a high power is the same ridge at a\n    fraction of the width, which lands as a hot core inside each thread.\n    Taken from lev \u2014 the MEAN of the three channels \u2014 deliberately, so the\n    core is achromatic and lands only where all three filaments coincide.\n    Read per-channel it would just be a fourth colour-separated ridge, and\n    the web would stay a scatter of green and magenta flecks instead of\n    resolving into white threads with coloured shoulders. Squared twice\n    rather than pow() \u2014 pow is undefined for a negative base and this is\n    cheaper anyway (see the README).\n  */\n  float core = lev * lev;\n  core = core * core;\n  col += uC_hot * core * uP_core;\n\n  col = pow(max(col, vec3(0.0)), vec3(uP_contrast));\n\n  // dome shading keeps the ball a ball under the web\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.35 + uP_light * lambert;\n\n  // fresnel sheen: the glaze the threads are crazed into, and the thing\n  // that keeps the limb reading as a surface where the cells have\n  // compressed past resolving\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice tightens the knots, the agent's\n  // thickens the threads and brightens them.\n  latticePole = uP_pole * (1.0 + 0.8 * uInput);\n  latticeSharp = uP_sharp * (1.0 - 0.25 * uOutput);\n  latticeGain = uP_gain * (0.85 + 0.4 * uOutput);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  // Nothing outside the silhouette is ever visible, so skip AA * AA warps\n  // for it rather than shading transparent sky.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += latticeRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = latticeRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Boil", min: 0.015, max: 10, step: 0.05, default: 0.4, integrate: true },
    { key: "swirl", label: "Swirl", min: 0, max: 3, step: 0.015, default: 0.07, integrate: true },
    { key: "drift", label: "Crazing drift", min: 0, max: 5, step: 0.03, default: 0.18, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Cell scale", min: 0.3, max: 20, step: 0.1, default: 9 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.25 },
    { key: "warp", label: "Warp", min: 0, max: 3, step: 0.02, default: 0.85 },
    { key: "pole", label: "Knot strength", min: 0, max: 2, step: 0.005, default: 0.25 },
    { key: "poleSoft", label: "Knot size", min: 0.001, max: 1, step: 0.001, default: 0.012 },
    { key: "pulse", label: "Cell breathing", min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: "sharp", label: "Thread width", min: 0.3, max: 20, step: 0.05, default: 4.5 },
    { key: "split", label: "Chromatic split", min: 0, max: 1, step: 0.005, default: 0.045 },
    { key: "core", label: "Hot core", min: 0, max: 3, step: 0.015, default: 0.45 },
    { key: "floor", label: "Body fill", min: 0, max: 3, step: 0.01, default: 0.9 },
    { key: "gain", label: "Brightness", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.35 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.7 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.45 }
  ],
  /*
   * Four stops: the glaze the web is crazed into, the two ends of the thread
   * ramp, and the fresnel sheen. The chromatic split runs the threads apart
   * into three filaments on its own, so the palette only has to set the mood.
   */
  colors: [
    { key: "deep", label: "Glaze", default: "#111a2e" },
    { key: "line", label: "Thread", default: "#3fd2ff" },
    { key: "hot", label: "Hot thread", default: "#fff4d6" },
    { key: "sheen", label: "Sheen", default: "#a9d8ff" }
  ],
  /*
    Staged on the pole, which is this orb's loudest control: knot strength
    decides whether the field flows past the lattice or tears itself around
    it. Thread width is the second lever, and the two integrated clocks —
    boil and roll — carry the tempo.
  */
  statePresets: {
    /*
      at rest: slow boil, threads fine — on a dome bulged nearly all the
      way and the warp pushed to more than double, so the field wraps hard
      around the ball. The knots are halved in strength and pinched to the
      smallest size, the hot core is run up five times and the body fill
      cut to a third: a dark ball with a fierce centre.
    */
    idle: KNOT_REST,
    /*
      searching: the rest look, set MOVING. The boil runs at nearly two and
      a half times idle, the swirl four times and the drift three, so the
      web migrates over the glaze instead of sitting on it. The knots come
      up a third but breathe less, the threads soften a touch on a tighter
      split, and the contrast is pushed — busier, but no brighter.
    */
    thinking: {
      ...KNOT_REST,
      speed: 1,
      swirl: 0.3,
      drift: 0.51,
      pole: 0.18,
      pulse: 0.22,
      sharp: 3.6,
      split: 0.03,
      floor: 0.28,
      contrast: 1.6
    },
    /*
      answering: the web goes FAST and FLOODS. The boil runs at six times
      thinking and the drift more than three, the knots breathe at their
      deepest, and the threads spread to their softest, so the ridges bloom
      into broad light. The dome is flattened back toward the default and
      the warp relaxed to a third of rest, with the cell scale nudged up;
      the core is halved from rest, but the fill, gain and contrast all
      come up — the brightest, busiest state.
    */
    speaking: {
      speed: 6.45,
      swirl: 0.555,
      drift: 1.74,
      scale: 11,
      bulge: 0.78,
      warp: 0.76,
      pole: 0.195,
      poleSoft: 0.001,
      pulse: 1.39,
      sharp: 2.1,
      split: 0.045,
      core: 1.08,
      floor: 0.48,
      gain: 1.3,
      contrast: 1.95
    }
  },
  // one palette, cold cyan porcelain, across all three states — unlike the
  // sibling orbs, this one tells its states apart by the knots and the
  // tempo alone, not by colour
  stateColors: {
    idle: KNOT_PALETTE,
    thinking: KNOT_PALETTE,
    speaking: KNOT_PALETTE
  }
},
  "shdr-27": {
  key: "shdr-27",
  label: "SHDR-27",
  note: "a weather-radar mosaic, fronts of coloured pixels sweeping the ball",
  frag: "\n#define VORTICES 6\n#define FBM3_OCT 4\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat radarLoNow;\nfloat radarDensityNow;\n\n/*\n  3D value noise. The prelude's noise is 2D, and a 2D field wrapped onto\n  the ball has to be projected \u2014 and every projection either distorts\n  somewhere or seams somewhere, which is exactly what the roll dragged\n  into view. Evaluating the field ON the sphere's own points needs\n  nothing projected: the roll is just a rotation of the sample point.\n*/\nfloat hash3(vec3 p) {\n  return fract(sin(dot(p, vec3(127.1, 311.7, 74.7))) * 43758.5453123);\n}\nfloat noise3(vec3 p) {\n  vec3 i = floor(p);\n  vec3 f = fract(p);\n  f = f * f * (3.0 - 2.0 * f);\n  float n000 = hash3(i);\n  float n100 = hash3(i + vec3(1.0, 0.0, 0.0));\n  float n010 = hash3(i + vec3(0.0, 1.0, 0.0));\n  float n110 = hash3(i + vec3(1.0, 1.0, 0.0));\n  float n001 = hash3(i + vec3(0.0, 0.0, 1.0));\n  float n101 = hash3(i + vec3(1.0, 0.0, 1.0));\n  float n011 = hash3(i + vec3(0.0, 1.0, 1.0));\n  float n111 = hash3(i + vec3(1.0, 1.0, 1.0));\n  return mix(\n    mix(mix(n000, n100, f.x), mix(n010, n110, f.x), f.y),\n    mix(mix(n001, n101, f.x), mix(n011, n111, f.x), f.y),\n    f.z\n  );\n}\nfloat fbm3(vec3 p) {\n  float v = 0.0;\n  float a = 0.5;\n  for (int i = 0; i < FBM3_OCT; i++) {\n    v += a * noise3(p);\n    p = p * 2.03 + vec3(11.7, 7.3, 3.1);\n    a *= 0.5;\n  }\n  return v;\n}\n\n// rotate v about the unit axis k by angle a (Rodrigues)\nvec3 rotateAbout(vec3 v, vec3 k, float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return v * c + cross(k, v) * s + k * dot(k, v) * (1.0 - c);\n}\n\n// the precipitation intensity, 0..1, at a point of the unit sphere\nfloat intensity(vec3 sp, float t) {\n  vec3 q = sp;\n  /*\n    The vortices: hashed points on the sphere, each twisting the space\n    around itself \u2014 a rotation about the axis through it, by an angle\n    that falls off with the angular distance, alternating in sense. The\n    centres wander slowly so no spiral sits still.\n  */\n  for (int k = 0; k < VORTICES; k++) {\n    float fk = float(k);\n    vec3 c = normalize(vec3(\n      hash(vec2(fk * 3.7, 1.1)) - 0.5,\n      hash(vec2(fk * 5.9, 2.3)) - 0.5,\n      hash(vec2(fk * 7.1, 4.9)) - 0.5\n    ));\n    c = rotateAbout(c, vec3(0.0, 1.0, 0.0), sin(t * 0.09 + fk * 1.7) * 0.25);\n    float ang = acos(clamp(dot(q, c), -1.0, 1.0));\n    float fall = exp(-ang * ang / (uP_vortex * uP_vortex));\n    float a = uP_swirl * fall * (mod(fk, 2.0) < 0.5 ? 1.0 : -1.0);\n    q = rotateAbout(q, c, a);\n  }\n\n  // bend, then drift the noise through the twisted space\n  vec3 w = vec3(noise3(q * 1.3 + 2.1), noise3(q * 1.3 + 7.3), noise3(q * 1.3 + 4.4)) - 0.5;\n  q += w * uP_warp;\n  vec3 pq = q * uP_freq + vec3(t * 0.22, -t * 0.13, t * 0.07);\n\n  /*\n    Two scales multiplied, not added: a broad mask decides WHERE the storms\n    are, a finer field gives each one a core and ragged edges. Adding them\n    fills the whole sphere with mid-tones; multiplying leaves the calm\n    between systems genuinely empty and puts the peaks inside the cells,\n    which is what draws the concentric class rings.\n  */\n  float big = clamp((fbm3(pq) - 0.5) * 3.0 + 0.5, 0.0, 1.0);\n  float fine = clamp((fbm3(pq * 2.6 + 4.7) - 0.5) * 2.4 + 0.5, 0.0, 1.0);\n  float f = big * (0.55 + 0.45 * fine);\n\n  f = clamp((f - radarLoNow) / max(uP_hi - radarLoNow, 0.01), 0.0, 1.0);\n  // a response curve: the top classes are the rare peaks of a real map\n  return pow(f, uP_curve);\n}\n\nvoid main() {\n  // input lowers the window (more of the field reads as weather), output\n  // fills the dots in\n  radarLoNow = uP_lo - 0.08 * uInput;\n  radarDensityNow = uP_density * (1.0 + 0.5 * uOutput);\n\n  vec2 uv = orbUV();\n  float rd = length(uv);\n  float R = uP_radius;\n  float mask = smoothstep(0.012, -0.012, rd - R);\n\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec2 pl = uv / R;\n  float r2 = dot(pl, pl);\n  float z = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(pl, z);\n\n  float t = uP_speed; // integrated clock: the weather drifts\n\n  /*\n    The pixel grid lives on the UNROLLED dome: a stereographic wrap of the\n    front hemisphere as it faces the viewer, which compresses gently toward\n    the limb and never changes. The picture rolls underneath it \u2014 the\n    pixels are the screen, the weather is what is on it. Laying the grid on\n    the rolled dome instead put the projection's blow-up (the far side of\n    the ball) wherever the roll had turned it, and the cells smeared into\n    streaks there.\n  */\n  vec2 st = n.xy / (1.3 + n.z) * uP_scale;\n  vec2 g = st * uP_cells;\n  vec2 cell = floor(g);\n  vec2 fr = fract(g) - 0.5;\n\n  // the cell centre, back on the dome: invert the wrap, then roll it and\n  // read the field there \u2014 once per cell, so every dot is one flat colour\n  vec2 v = (cell + 0.5) / uP_cells / uP_scale;\n  float vv = dot(v, v);\n  float A = vv + 1.0;\n  float B = 2.6 * vv;\n  float C = 1.69 * vv - 1.0;\n  float zc = (-B + sqrt(max(B * B - 4.0 * A * C, 0.0))) / (2.0 * A);\n  vec3 nc = vec3(v * (1.3 + zc), zc);\n  float cr = cos(uP_spin);\n  float sr = sin(uP_spin);\n  vec3 spc = vec3(nc.x * cr - nc.z * sr, nc.y, nc.x * sr + nc.z * cr);\n\n  float f = intensity(spc, t);\n\n  // dither the class boundaries with a per-cell hash, then quantize into\n  // the legend's seven classes. The bands are NOT even: red is broad and\n  // green thin, as on the reference, and magenta is the rare peak.\n  float h = hash(cell + 11.7);\n  float fd = clamp(f + (h - 0.5) * uP_dither, 0.0, 1.0);\n  float cls = 0.0;\n  cls += step(0.10, fd);\n  cls += step(0.26, fd);\n  cls += step(0.38, fd);\n  cls += step(0.46, fd);\n  cls += step(0.78, fd);\n  cls += step(0.94, fd);\n\n  // dropout: density rises with the intensity; the hash re-rolls slowly\n  float frame = floor(uTime * uP_twinkle);\n  float roll = hash(cell + vec2(frame * 3.7, -frame * 1.3));\n  float density = mix(uP_sparse, 1.0, smoothstep(0.0, 0.6, f)) * radarDensityNow;\n  float keep = step(roll, density);\n\n  // the dot: a square inset in its cell\n  float dsq = max(abs(fr.x), abs(fr.y));\n  float dotMask = 1.0 - smoothstep(uP_dot - 0.06, uP_dot + 0.06, dsq);\n\n  // the class palette\n  vec3 ink = uC_c0;\n  ink = cls > 0.5 && cls < 1.5 ? uC_c1 : ink;\n  ink = cls > 1.5 && cls < 2.5 ? uC_c2 : ink;\n  ink = cls > 2.5 && cls < 3.5 ? uC_c3 : ink;\n  ink = cls > 3.5 && cls < 4.5 ? uC_c4 : ink;\n  ink = cls > 4.5 && cls < 5.5 ? uC_c5 : ink;\n  ink = cls > 5.5 ? uC_c6 : ink;\n\n  vec3 col = mix(uC_paper, ink, dotMask * keep);\n\n  // paper grain, so the flats are not dead\n  col *= 1.0 + (hash(floor(gl_FragCoord.xy / 2.0) + frame) - 0.5) * uP_grain;\n\n  // dome shading keeps the ball a ball under the mosaic\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  col *= 1.0 - uP_light * (1.0 - lambert);\n  float fres = pow(1.0 - z, 3.0);\n  col = mix(col, uC_c0, fres * uP_rim);\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Front speed", min: 0.015, max: 10, step: 0.05, default: 0.6, integrate: true },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.04, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Grid zoom", min: 0.3, max: 8, step: 0.05, default: 2.4 },
    { key: "cells", label: "Grid", min: 8, max: 120, step: 1, default: 34 },
    { key: "dot", label: "Dot size", min: 0.1, max: 0.5, step: 0.01, default: 0.36 },
    { key: "swirl", label: "Swirl", min: 0, max: 8, step: 0.05, default: 1.5 },
    { key: "vortex", label: "Vortex size", min: 0.1, max: 2, step: 0.01, default: 0.45 },
    { key: "freq", label: "Storm scale", min: 0.2, max: 8, step: 0.05, default: 1.6 },
    { key: "warp", label: "Bend", min: 0, max: 3, step: 0.02, default: 0.5 },
    { key: "lo", label: "Quiet threshold", min: 0, max: 1, step: 0.005, default: 0.12 },
    { key: "hi", label: "Peak threshold", min: 0, max: 1, step: 0.005, default: 0.82 },
    { key: "curve", label: "Response curve", min: 0.5, max: 4, step: 0.05, default: 1.4 },
    { key: "dither", label: "Class dither", min: 0, max: 0.6, step: 0.005, default: 0.12 },
    { key: "sparse", label: "Quiet density", min: 0, max: 1, step: 0.01, default: 0.16 },
    { key: "density", label: "Fill", min: 0, max: 1.5, step: 0.01, default: 1 },
    { key: "twinkle", label: "Twinkle rate", min: 0, max: 30, step: 0.5, default: 3 },
    { key: "grain", label: "Paper grain", min: 0, max: 1, step: 0.01, default: 0.1 },
    { key: "light", label: "Key light", min: 0, max: 1, step: 0.01, default: 0.18 },
    { key: "rim", label: "Rim", min: 0, max: 1, step: 0.01, default: 0.35 }
  ],
  /*
   * The paper and the seven classes, quiet to peak: grey, blue, cyan,
   * green, red, yellow, magenta — the radar legend of the reference.
   */
  colors: [
    { key: "paper", label: "Paper", default: "#efe9dc" },
    { key: "c0", label: "Quiet", default: "#a9a9a6" },
    { key: "c1", label: "Class 1", default: "#2e5df0" },
    { key: "c2", label: "Class 2", default: "#38d9ec" },
    { key: "c3", label: "Class 3", default: "#22c35c" },
    { key: "c4", label: "Class 4", default: "#e8322a" },
    { key: "c5", label: "Class 5", default: "#f5d020" },
    { key: "c6", label: "Peak", default: "#e030c0" }
  ],
  /*
    Staged on the drift, the swirl, the window and the fill. The grid, the
    zoom and the storm scale all multiply a coordinate or sit inside a
    floor, so they never move between states. The swirl is an angle,
    bounded, and glides safely.
  */
  statePresets: {
    // at rest: fronts drifting, the ball rolling at a steady turn, the
    // quiet areas sparse, a slow twinkle
    idle: {
      speed: 1,
      spin: 0.27,
      lo: 0.12,
      hi: 0.82,
      curve: 1.4,
      sparse: 0.16,
      density: 1,
      twinkle: 3,
      warp: 0.5,
      swirl: 1.5,
      dither: 0.12
    },
    /*
      searching: the storms go FINE and the swirl hard — the storm scale at
      three times rest, the vortices twisting at nearly three times the
      rest angle on a doubled bend, the roll doubled — with the window
      thrown open (quiet threshold at zero, peak at half), so the whole
      ball is small, tightly wound systems. The storm scale multiplies a
      coordinate, so the glide into and out of thinking passes through a
      rescale — chosen deliberately.
    */
    thinking: {
      speed: 2.4,
      spin: 0.51,
      lo: 0,
      hi: 0.545,
      curve: 1.7,
      sparse: 0.22,
      density: 0.9,
      twinkle: 12,
      freq: 5.2,
      warp: 1.06,
      swirl: 4,
      dither: 0.18
    },
    /*
      answering: the weather FILLS IN and RACES. The quiet threshold drops
      to zero so every cell reads as weather, the fronts widen into red and
      yellow with magenta peaks, the drift runs at six times rest on the
      thinking roll, and the paper grain comes up.
    */
    speaking: {
      speed: 6.5,
      spin: 0.51,
      lo: 0,
      hi: 0.8,
      curve: 1.3,
      sparse: 0.22,
      density: 1.15,
      twinkle: 5,
      warp: 0.45,
      swirl: 2,
      grain: 0.35,
      dither: 0.1
    }
  },
  // the legend holds; the paper cools while searching and warms while
  // answering
  stateColors: {
    idle: { paper: "#efe9dc" },
    thinking: { paper: "#e6e9ee" },
    speaking: { paper: "#f5e6d0" }
  }
},
  "shdr-28": {
  key: "shdr-28",
  label: "SHDR-28",
  note: "nested binary grids shuttering on a tumbling bit-sphere",
  frag: "\n#define LEVELS 20\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat bitdumbGain;\nfloat bitdumbBody;\n\nmat2 bdRot(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\nvoid main() {\n  bitdumbGain = uP_gain * (1.0 + 0.6 * uInput);\n  bitdumbBody = uP_body * (1.0 + 0.8 * uOutput);\n\n  vec2 uv = orbUV() / uP_radius;\n  float r2 = dot(uv, uv);\n\n  // analytic disc silhouette \u2014 this orb is parameterised on the dome, so\n  // the exact edge is just the unit circle, with the same tunable band as\n  // the raymarched orbs\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(1.0 - band, 1.005, length(uv));\n\n  // front dome point and its normal (view space)\n  float zc = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(uv, zc);\n\n  // tumble the sphere point with real rotations, then project. abs() on z\n  // mirror-wraps the hemisphere the tumble turns away, avoiding the\n  // stereographic pole blow-up.\n  vec3 sp = n;\n  sp.yz = bdRot(uP_tilt) * sp.yz;\n  sp.xz = bdRot(uP_spin) * sp.xz; // integrated clock\n  vec2 p = sp.xy / (abs(sp.z) + 1.0) * uP_gridScale;\n\n  /*\n    Analytic pixel footprint in grid space, in place of fwidth(): one\n    screen pixel in uv units, through the radius scale, the dome stretch\n    (grids compress toward the rim, so a pixel covers more of them there),\n    and the grid scale. Doubled alongside p every level.\n  */\n  float px = (2.0 / min(uRes.x, uRes.y)) / uP_radius / max(zc, 0.2) * uP_gridScale;\n\n  vec4 acc = vec4(0.0);\n  float phase = uP_speed * 0.2; // integrated clock, additive phase\n\n  for (int i = 0; i < LEVELS; i++) {\n    float fi = float(i) + 1.0;\n    if (fi > uP_levels) break;\n\n    // the listing's engine, kept verbatim: binary zoom\n    p += p;\n    px += px;\n\n    vec2 v = ceil(p);\n    vec2 f = fract(p);\n\n    // distance to the nearest cell line, against this level's footprint \u2014\n    // the extension-free fwidth. Deep levels saturate to solid planes,\n    // exactly like the original's aliasing.\n    vec2 e2 = 1.0 - smoothstep(vec2(0.0), vec2(px * uP_lineW), min(f, 1.0 - f));\n\n    // x-lines and y-lines separately tintable \u2014 the original's .xyy\n    vec3 edgeCol = uC_lineA * e2.x + uC_lineB * e2.y;\n\n    // the per-cell shutter value, and the under-compositing that makes\n    // level i occlude level i+1 \u2014 both straight from the listing\n    float aBit = fract(length(v) / fi - phase) * uP_shutter;\n    acc += vec4(edgeCol, aBit) * (1.0 - acc.a);\n\n    if (acc.a > 0.996) break;\n  }\n\n  vec3 col = acc.rgb * bitdumbGain;\n\n  // the ball body: a lambert-shaded base under the lattice, so the orb\n  // reads as a solid object rather than lines floating on nothing\n  vec3 L = normalize(vec3(-0.4, 0.5, 0.75));\n  float shade = 0.25 + 0.75 * clamp(dot(n, L), 0.0, 1.0);\n  col += uC_base * shade * bitdumbBody;\n\n  // fresnel rim to sell the sphere\n  col += uC_rim * pow(1.0 - zc, uP_rimPow) * uP_rim;\n\n  col = pow(max(col, 0.0), vec3(uP_contrast));\n\n  // coverage alpha; safety taper fades colour AND alpha, as always\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));\n  float a = mask * fade;\n\n  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply \u2014\n  // the opposite of the emissive orbs (see the note in shdr-31).\n  gl_FragColor = vec4(col * a, a);\n}\n",
  params: [
    { key: "speed", label: "Shutter drift", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "spin", label: "Tumble rate", min: 0, max: 5, step: 0.03, default: 0.15, integrate: true },
    { key: "tilt", label: "Tumble tilt", min: 0, max: 4, step: 0.02, default: 0.5 },
    { key: "radius", label: "Radius", min: 0.1, max: 3, step: 0.015, default: 0.9 },
    { key: "gridScale", label: "Grid scale", min: 0.5, max: 20, step: 0.1, default: 2 },
    // 12 levels / wider lines: past ~12 the deep grids alias into solid white
    // planes that swallow the line palette — the state staging below depends
    // on the coarse lines and body actually carrying their colours
    { key: "levels", label: "Bit depth", min: 4, max: 20, step: 1, default: 12 },
    { key: "lineW", label: "Line width", min: 0.5, max: 15, step: 0.1, default: 2 },
    { key: "shutter", label: "Shutter", min: 0, max: 4, step: 0.02, default: 1 },
    { key: "gain", label: "Line gain", min: 0.05, max: 10, step: 0.05, default: 1 },
    { key: "body", label: "Body glow", min: 0, max: 5, step: 0.03, default: 1 },
    { key: "rim", label: "Rim light", min: 0, max: 5, step: 0.03, default: 0.6 },
    { key: "rimPow", label: "Rim tightness", min: 0.3, max: 20, step: 0.1, default: 3 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  colors: [
    { key: "lineA", label: "X lines", default: "#ff5a4d" },
    { key: "lineB", label: "Y lines", default: "#59d8ff" },
    { key: "base", label: "Body", default: "#101528" },
    { key: "rim", label: "Rim", default: "#bcd8ff" }
  ],
  /*
    The states are staged on the two integrated clocks: thinking runs the
    shutter cascade hot AND sets the sphere tumbling — the bits computing
    furiously while the orb turns them over — and speaking tumbles harder
    still while the flicker stays moderate: the orb turning to answer. Both
    clocks integrate, so every rate change glides without a phase jump.
  */
  statePresets: {
    /*
      calm: a steady flicker at double the old rate, lazy tumble. Two bits
      shallower and the lines a quarter wider, so the grid reads bolder
      and coarser; the body glow eased down and the rim pulled tight —
      red and white lines on black, no halo.
    */
    idle: {
      speed: 1,
      spin: 0.1,
      levels: 10,
      lineW: 2.5,
      shutter: 1.02,
      gain: 1,
      body: 0.9,
      rim: 0.6,
      rimPow: 5.2,
      contrast: 1.2
    },
    // computing: the shutter cascade races (2.4x idle) and the tumble goes
    // with it, eight times idle, on wider lines and a lifted gain; the body
    // dims so the flickering cells carry the light
    thinking: {
      speed: 2.4,
      spin: 0.81,
      lineW: 2.9,
      shutter: 0.94,
      gain: 1.2,
      body: 0.85,
      rim: 0.7
    },
    /*
      answering: hard fast tumble on a grid five times finer and seven bits
      deeper, so the sphere goes dense with cells; the body is all but cut
      and the rim brought up hard and pulled tight, so the light sits on
      the limb and the circuitry, not the ball.

      gain stays LOW on purpose: the shader multiplies it by (1 + 0.6 *
      input volume), and speaking synthesizes input around 0.65 — a 1.35
      preset lands near x1.9 effective, which clamps the lines to white
      and reads as a pale wash. 0.95 keeps the effective gain near 1.3,
      where the red survives.
    */
    speaking: {
      speed: 3,
      spin: 1.1,
      gridScale: 10.3,
      levels: 17,
      shutter: 1.2,
      gain: 0.95,
      body: 0.27,
      rim: 1.53,
      rimPow: 10,
      contrast: 1.45
    }
  },
  /*
    Four stageable colours, and one palette across all three states: red
    and white circuitry on pure black. The states are told apart by the
    tumble, the grid and the line weight, not the colour.
  */
  stateColors: {
    idle: { lineA: "#ff1100", lineB: "#ffffff", base: "#000000", rim: "#000000" },
    thinking: { lineA: "#ff0000", lineB: "#ffffff", base: "#000000", rim: "#000000" },
    speaking: { lineA: "#ff0000", lineB: "#ffffff", base: "#000000", rim: "#000000" }
  }
},
  "shdr-29": {
  key: "shdr-29",
  label: "SHDR-29",
  note: "an LED tile wall lighting up in flowing blobs, wrapped on the ball",
  frag: "\nvoid main() {\n  // Volume coupling: user input widens the lit coverage, agent output turns\n  // the panel brightness up.\n  float coverNow = uP_coverage + 0.07 * uInput;\n  float gainNow = uP_gain * (0.85 + 0.5 * uOutput);\n\n  // resolution-relative tile grid \u2014 same wall at every size\n  float cellPx = max(min(uRes.x, uRes.y) / max(uP_cells, 8.0), 4.0);\n  vec2 cellIdx = floor(gl_FragCoord.xy / cellPx);\n  vec2 cellCentre = (cellIdx + 0.5) * cellPx;\n  vec2 g = fract(gl_FragCoord.xy / cellPx); // 0..1 inside the tile\n\n  vec2 suv = (2.0 * cellCentre - uRes) / min(uRes.x, uRes.y);\n  vec2 uv = suv / uP_radius;\n  float r2 = dot(uv, uv);\n\n  // blocky silhouette, cut on the tile grid like the wall itself\n  float mask = 1.0 - step(1.0, r2);\n\n  float z = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(uv, z);\n\n  // rotating dome, stereographic projection \u2014 the blobs roll around the\n  // ball as the dome turns\n  float rot = uP_spin; // integrated clock\n  float cr = cos(rot);\n  float sr = sin(rot);\n  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);\n  vec2 p2 = sp.xy / (abs(sp.z) + 1.2) * uP_scale * 3.0;\n\n  /*\n    Per-state motion, each on its own integrated clock:\n      DRIFT    the blob field streams across the wall     (idle flows)\n      CHURN    the fluid warp evolves in place            (thinking boils)\n      SHUFFLE  the confetti promotion cycles              (thinking races it)\n      PULSE    rings radiate from the centre              (speaking)\n    Rates glide; a rate at zero freezes that motion with its phase intact.\n    The pulse depth is an amplitude, so idle carries no static rings.\n  */\n  float driftT = uP_drift;     // integrated clock: blob stream\n  float churnT = uP_churn;     // integrated clock: warp evolution\n  float shuffleT = uP_shuffle; // integrated clock: confetti reshuffle\n  vec2 f1 = vec2(driftT * 0.5, -driftT * 0.35);\n  vec2 f2 = vec2(-churnT * 0.4, churnT * 0.6);\n\n  /*\n    FLUID domain warp: two decorrelated fbm channels displace the sample\n    point before the blob field reads it, and the displacement itself\n    evolves on the churn clock. The blobs curl, stretch and merge like\n    liquid instead of sliding across the wall as one rigid sheet.\n  */\n  vec2 warp = vec2(\n    fbm(p2 * 0.9 + f2),\n    fbm(p2 * 0.9 + f2.yx + 13.7)\n  ) - 0.5;\n  float field = fbm(p2 + f1 + warp * uP_swirl * 2.4);\n\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  float lum = smoothstep(1.0 - coverNow, 1.14 - coverNow, field\n    + 0.25 * uP_light * lambert\n    + uP_pulse * 0.3 * sin(length(uv) * 5.0 - driftT * 3.2));\n  lum *= gainNow;\n\n  /*\n    The tile: a bevelled square face inside a frame. The face is the lit\n    part; the frame stays dark; an unlit tile keeps a faint presence so the\n    wall reads as hardware even where nothing is lit.\n  */\n  vec2 d2 = abs(g - 0.5);\n  float d = max(d2.x, d2.y);\n  float face = 1.0 - smoothstep(0.26, 0.36, d);\n  float tile = 1.0 - smoothstep(0.42, 0.48, d);\n  // a soft centre hot-spot on the face, like an LED under a diffuser\n  float hot = 1.0 - smoothstep(0.0, 0.34, length(d2));\n\n  /*\n    Confetti: a per-tile hash cycles against the shuffle clock, and the top\n    uP_confetti slice of the cycle is promoted from warm white to a fully\n    saturated hue drawn from a second hash. Which tiles are coloured\n    therefore reshuffles continuously \u2014 slowly at rest, fast in thought.\n  */\n  float h1 = hash(cellIdx * 1.618 + 7.3);\n  float h2 = hash(cellIdx * 2.113 + 41.7);\n  float cyc = fract(h1 + shuffleT * 0.06);\n  float promoted = step(1.0 - uP_confetti, cyc);\n  vec3 confetti = 0.5 + 0.5 * cos(6.2831 * (h2 + vec3(0.0, 0.33, 0.67)));\n  confetti = normalize(confetti + 0.05) * 1.2;\n  vec3 litCol = mix(uC_lit, confetti, promoted);\n\n  // lit face over the dark wall; frames and off-tiles stay faintly present\n  vec3 offCol = uC_wall * tile;\n  vec3 onCol = litCol * (face * 1.05 + hot * 0.5) * lum;\n  vec3 col = offCol + onCol;\n\n  col = pow(max(col, 0.0), vec3(uP_contrast));\n\n  // Surface-lit orb bounded by a mask: alpha IS coverage, so premultiply \u2014\n  // the opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(col * a, a);\n}\n",
  params: [
    { key: "drift", label: "Drift", min: 0, max: 10, step: 0.05, default: 0.45, integrate: true },
    { key: "churn", label: "Churn", min: 0, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "swirl", label: "Fluidity", min: 0, max: 3, step: 0.015, default: 1.2 },
    { key: "shuffle", label: "Shuffle", min: 0, max: 20, step: 0.1, default: 0.6, integrate: true },
    { key: "pulse", label: "Pulse depth", min: 0, max: 2, step: 0.01, default: 0 },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.1, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "cells", label: "Tile grid", min: 16, max: 160, step: 2, default: 48 },
    { key: "scale", label: "Blob scale", min: 0.3, max: 10, step: 0.1, default: 1.3 },
    { key: "coverage", label: "Coverage", min: 0, max: 1.2, step: 0.01, default: 0.52 },
    { key: "confetti", label: "Confetti", min: 0, max: 1, step: 0.01, default: 0.22 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.6 },
    { key: "gain", label: "Panel gain", min: 0.05, max: 5, step: 0.05, default: 1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1 }
  ],
  colors: [
    { key: "lit", label: "Lit tile", default: "#fff2dd" },
    { key: "wall", label: "Wall", default: "#161616" }
  ],
  /*
    Each state animates DIFFERENTLY — its own motion, same palette and
    composition throughout (no stateColors on purpose).
  */
  /*
    Coverage is staged DOWN in the active states on purpose: the synthesized
    volumes push it up, and without the counterweight thinking and speaking
    flood the wall with light — the composition lives on its big dark
    voids, so every state keeps them.
  */
  statePresets: {
    // idle FLOWS: blobs streaming and curling slowly, lava-lamp pace
    idle: {
      drift: 0.45,
      churn: 0.5,
      shuffle: 0.6,
      pulse: 0,
      spin: 0.1,
      coverage: 0.52,
      gain: 1
    },
    // thinking BOILS: the stream stops but the fluid warp churns hard in
    // place while the confetti races — blobs kneading among the voids
    thinking: {
      drift: 0.1,
      churn: 1.9,
      shuffle: 5,
      pulse: 0,
      spin: 0.03,
      coverage: 0.42,
      gain: 0.95
    },
    // speaking PULSES: rings radiate through the flowing wall as the dome
    // rolls — the rings carve dark bands as much as they light bright ones
    speaking: {
      drift: 0.5,
      churn: 0.9,
      shuffle: 1.2,
      pulse: 0.55,
      spin: 0.45,
      coverage: 0.44,
      gain: 1.15
    }
  }
},
  "shdr-30": {
  key: "shdr-30",
  label: "SHDR-30",
  note: "a meadow folding into itself toward a blue vanishing point",
  frag: "\n#define AA 2\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat drosteHaze;\nfloat drosteCloud;\nfloat drosteBloom;\n\n/*\n  Arc length around the unit square, in [0,8), counter-clockwise from the\n  bottom-right corner \u2014 two units per face. Continuous everywhere except\n  its single wrap, which lands on a corner.\n*/\nfloat squareArc(vec2 q) {\n  if (abs(q.x) >= abs(q.y)) {\n    if (q.x > 0.0) return q.y + 1.0;\n    return 5.0 - q.y;\n  }\n  if (q.y > 0.0) return 3.0 - q.x;\n  return 7.0 + q.x;\n}\n\n/*\n  Flower colour by hash: mostly white daisies, then the planted warm, then\n  the cornflower blues \u2014 which reuse the SKY colour rather than adding a\n  sixth stop, because that is what keeps them reading as part of the same\n  picture instead of as confetti thrown over it.\n*/\nvec3 drosteFlower(float h) {\n  vec3 c = uC_cloud;\n  c = mix(c, uC_bloom, step(0.52, h));\n  c = mix(c, uC_sky, step(0.86, h));\n  return c;\n}\n\nvec3 drosteRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  float R = max(uP_radius, 0.001);\n\n  // the dome: the front hemisphere of a unit ball, in screen space\n  vec2 pl = uv / R;\n  float z = sqrt(max(1.0 - dot(pl, pl), 0.0));\n\n  float fall = uP_fall;   // integrated clock: the flight inward\n  float drift = uP_drift; // integrated clock: weather\n\n  /*\n    The frame tilt is a STATIC angle, not an integrated clock like the roll\n    every other orb here gets. Those clocks seed at a random phase per\n    mount, which is exactly right for a field with no preferred direction\n    and exactly wrong for a picture: it lands the sky down one side of the\n    ball and the meadow up the other. This one has an up.\n  */\n  float sw = uP_tilt;\n\n  // stereographic wrap \u2014 the tunnel is inside the ball, and compresses\n  // toward the limb the way a texture on a sphere does\n  vec2 p = pl / (z + 1.0 + uP_bulge) * uP_scale;\n  p = mat2(cos(sw), -sin(sw), sin(sw), cos(sw)) * p;\n\n  /*\n    The Chebyshev norm makes the level sets SQUARES. The floor on it is\n    what keeps the logarithm finite at the dead centre; the haze below\n    covers that last pixel anyway.\n  */\n  float m = max(max(abs(p.x), abs(p.y)), 0.002);\n\n  float K = max(uP_ratio, 1.05);\n  float L = log2(m) / log2(K) + fall;\n\n  vec2 q = p / m;                 // direction, on the unit square boundary\n  float sm = pow(K, fract(L));    // this fragment's radius in base-frame units\n  vec2 P = q * sm;                // where it lands in the base picture\n\n  float Yn = P.y / K;             // picture height, about -1 at the bottom edge\n  float arc = squareArc(q);       // distance around the frame\n\n  // ---- sky -----------------------------------------------------------\n  vec3 col = mix(uC_sky * 0.72, uC_sky, clamp(Yn * 1.3, 0.0, 1.0));\n\n  /*\n    Cloud and land are both read in BASE-PICTURE coordinates, so every\n    frame carries the same weather at its own scale \u2014 which is the whole\n    point of a picture that contains itself.\n  */\n  float skyMask = smoothstep(uP_horizon - 0.3, uP_horizon + 0.2, Yn);\n  float cl = fbm(P * uP_cloudScale + vec2(drift, drift * 0.3));\n  cl = smoothstep(drosteCloud, drosteCloud + 0.16, cl);\n  col = mix(col, uC_cloud, cl * (0.2 + 0.8 * skyMask));\n\n  // ---- land ----------------------------------------------------------\n  /*\n    The smear. Sampled on (distance around the frame, frame index) with a\n    low frequency on the second axis, so features run LONG in the\n    direction the recursion stretches them \u2014 the streaked walls of the\n    reference, straight out of the geometry.\n  */\n  float streak = fbm(vec2(arc * uP_streakFreq, L * uP_streakRad));\n\n  vec3 land = mix(uC_canopy, uC_meadow, smoothstep(0.02, -0.62, Yn));\n  land *= 0.42 + 1.25 * streak;\n\n  // water: the low ground holds it where the streak field pools\n  float water = smoothstep(0.42, 0.16, streak) * smoothstep(0.05, -0.3, Yn);\n  land = mix(land, uC_water, water * uP_water);\n\n  /*\n    Flowers, hashed one to a cell on the same (around, index) grid, jittered\n    inside it. Densest low in the picture and gone by the horizon.\n  */\n  vec2 fg = vec2(arc * uP_flowerScale, L * uP_flowerScale * 0.3);\n  vec2 fc = floor(fg);\n  vec2 ff = fract(fg) - 0.5;\n  vec2 dcv = ff - (vec2(hash(fc + 3.7), hash(fc + 19.1)) - 0.5) * 0.6;\n  float petal = smoothstep(uP_flowerSize, uP_flowerSize * 0.35, length(dcv));\n  float present = step(1.0 - drosteBloom, hash(fc + 51.3));\n  float meadow = smoothstep(0.13, -0.38, Yn);\n  land = mix(land, drosteFlower(hash(fc + 7.9)), petal * present * meadow);\n\n  float landMask = 1.0 - smoothstep(uP_horizon - 0.12, uP_horizon + 0.16, Yn);\n  col = mix(col, land, landMask);\n\n  /*\n    The picture's own edge. Darkening across the frame and resetting hard\n    at its boundary is not an artefact to smooth away \u2014 it draws the\n    nested borders the reference is built out of.\n  */\n  col *= mix(1.0, uP_frameShade, fract(L));\n\n  /*\n    Aerial perspective, from the SCREEN radius. Every frame has the same\n    fractional part, so depth cannot come from inside a frame \u2014 it has to\n    come from how far in the fragment sits. This is what makes the middle\n    read as far away instead of merely small.\n  */\n  float deep = 1.0 - smoothstep(0.0, uP_hazeRange, m);\n  col = mix(col, uC_sky, deep * drosteHaze);\n\n  col = pow(max(col, vec3(0.0)), vec3(uP_contrast)) * uP_gain;\n\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n\n  // dome shading, kept light \u2014 this is a window, not a lit surface\n  vec3 n = vec3(pl, z);\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.72))), 0.0, 1.0);\n  col *= 0.72 + uP_light * lambert;\n\n  // the glass: a strong fresnel is what turns a picture into a sphere\n  // with a world inside it\n  float fres = 1.0 - z;\n  fres = fres * fres * fres;\n  col += uC_sheen * uP_rim * fres;\n\n  return col;\n}\n\nvoid main() {\n  // Volume coupling: the user's voice thickens the weather, the agent's\n  // clears the haze and brings the meadow into flower.\n  drosteCloud = clamp(uP_cloudCover - 0.12 * uInput, 0.02, 0.98);\n  drosteHaze = uP_haze * (1.0 - 0.25 * uOutput);\n  drosteBloom = clamp(uP_flowerDensity * (1.0 + 0.5 * uOutput), 0.0, 1.0);\n\n  vec2 uv = orbUV();\n  float mask = smoothstep(0.012, -0.012, length(uv) - max(uP_radius, 0.001));\n\n  // Two fbm evaluations and a flower grid per sample \u2014 none of it worth\n  // paying for outside the silhouette.\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec3 col = vec3(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 off = (vec2(float(mx), float(my)) + 0.5) / float(AA) - 0.5;\n      col += drosteRender(gl_FragCoord.xy + off);\n    }\n  }\n  col /= float(AA * AA);\n#else\n  col = drosteRender(gl_FragCoord.xy);\n#endif\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "fall", label: "Fall speed", min: 0, max: 4, step: 0.01, default: 0.12, integrate: true },
    { key: "tilt", label: "Frame tilt", min: -1.6, max: 1.6, step: 0.01, default: 0 },
    { key: "drift", label: "Weather drift", min: 0, max: 4, step: 0.02, default: 0.2, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Tunnel scale", min: 0.3, max: 20, step: 0.1, default: 4.5 },
    { key: "bulge", label: "Dome bulge", min: 0, max: 4, step: 0.02, default: 0.25 },
    { key: "ratio", label: "Frame ratio", min: 1.1, max: 6, step: 0.02, default: 1.8 },
    { key: "horizon", label: "Horizon", min: -0.9, max: 0.9, step: 0.01, default: 0.14 },
    { key: "cloudScale", label: "Cloud scale", min: 0.1, max: 8, step: 0.05, default: 1.6 },
    { key: "cloudCover", label: "Cloud cover", min: 0.02, max: 0.98, step: 0.01, default: 0.46 },
    { key: "streakFreq", label: "Wall detail", min: 0.2, max: 20, step: 0.1, default: 5 },
    { key: "streakRad", label: "Smear", min: 0.02, max: 4, step: 0.02, default: 0.5 },
    { key: "water", label: "Water", min: 0, max: 1, step: 0.01, default: 0.7 },
    { key: "flowerScale", label: "Flower scale", min: 2, max: 120, step: 1, default: 44 },
    { key: "flowerDensity", label: "Flower density", min: 0, max: 1, step: 0.01, default: 0.55 },
    { key: "flowerSize", label: "Flower size", min: 0.05, max: 0.6, step: 0.01, default: 0.26 },
    { key: "frameShade", label: "Frame shading", min: 0.2, max: 1.4, step: 0.01, default: 0.62 },
    { key: "haze", label: "Aerial haze", min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: "hazeRange", label: "Haze reach", min: 0.005, max: 1.5, step: 0.005, default: 0.09 },
    { key: "gain", label: "Brightness", min: 0.05, max: 4, step: 0.02, default: 1.05 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 10, step: 0.05, default: 1.05 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.1 },
    { key: "light", label: "Key light", min: 0, max: 3, step: 0.015, default: 0.35 },
    { key: "rim", label: "Rim sheen", min: 0, max: 3, step: 0.015, default: 0.55 }
  ],
  /*
   * Six stops, and they are the picture rather than a palette: the sky the
   * recursion closes on, its cloud, the dark canopy, the meadow under the
   * flowers, the planted warm colour, and the glass.
   */
  colors: [
    { key: "sky", label: "Sky", default: "#4a92e0" },
    { key: "cloud", label: "Cloud", default: "#f7fbff" },
    { key: "canopy", label: "Canopy", default: "#12401f" },
    { key: "meadow", label: "Meadow", default: "#5aa63a" },
    { key: "water", label: "Water", default: "#156f6a" },
    { key: "bloom", label: "Bloom", default: "#ff6a3a" },
    { key: "sheen", label: "Sheen", default: "#cfe6ff" }
  ],
  /*
    Staged on the fall, which is the orb's whole subject, and on the haze,
    which decides how far into the recursion the eye can see. Frame ratio
    sets how many frames land on the ball; it differs only for idle, and
    the glide out of rest reads as the tunnel breathing once.
  */
  statePresets: {
    /*
      at rest: a slow fall, deep haze, weather barely moving — on a frame
      ratio nearly double the working states, so fewer, larger frames land
      on the ball, with the horizon dropped below centre. The wall detail
      is coarsened to a broad smear, the water drained entirely, and the
      meadow thinned to sparse, oversized flowers; brighter, and more
      saturated, than the states it falls into.
    */
    idle: {
      fall: 0.12,
      drift: 0.2,
      bulge: 0.2,
      ratio: 3.06,
      horizon: -0.11,
      cloudScale: 1.2,
      cloudCover: 0.42,
      streakFreq: 2.9,
      streakRad: 0.54,
      water: 0,
      flowerScale: 24,
      flowerDensity: 0.27,
      flowerSize: 0.43,
      haze: 0.8,
      hazeRange: 0.09,
      gain: 1.38,
      saturation: 1.56,
      light: 0.345,
      rim: 0.555
    },
    /*
      searching: the fall QUINTUPLES and the haze closes in over three
      times as far, so the recursion is swallowed within a frame or two of
      the middle — the eye is pulled down a tunnel it cannot see the end
      of. The weather thickens and the meadow goes out of flower. Lit hard
      against that: the key light nearly triples, and the gain, contrast
      and saturation all come up, so what the haze leaves is vivid.
    */
    thinking: {
      fall: 0.6,
      drift: 0.5,
      haze: 1,
      hazeRange: 0.3,
      cloudCover: 0.3,
      flowerDensity: 0.28,
      gain: 1.42,
      contrast: 1.45,
      saturation: 2,
      light: 0.96
    },
    /*
      answering: the fall goes FASTEST of the three — twelve times idle —
      on a drift five times as quick and a tunnel nearly doubled in scale,
      with the frames given a slight tilt. The haze lifts to less than half
      idle over a longer reach, opening the recursion to the vanishing
      point; the walls go to fine, wide-smeared detail, the clouds scale up
      threefold, and the meadow comes fully into flower on larger blooms.
      Lit and saturated hardest of the three.
    */
    speaking: {
      fall: 1.47,
      tilt: 0.03,
      drift: 1.54,
      scale: 8.7,
      horizon: 0.03,
      cloudScale: 3.65,
      cloudCover: 0.44,
      streakFreq: 11,
      streakRad: 1.48,
      flowerScale: 32,
      flowerDensity: 0.95,
      haze: 0.38,
      hazeRange: 0.315,
      gain: 1.36,
      contrast: 1.45,
      saturation: 2.32,
      light: 0.57
    }
  },
  // the picture keeps its own colours; the states move the weather and the
  // light, cooling toward overcast while searching and warming while
  // answering
  stateColors: {
    idle: {
      sky: "#4a92e0",
      cloud: "#f7fbff",
      canopy: "#12401f",
      meadow: "#5aa63a",
      water: "#156f6a",
      bloom: "#ff6a3a",
      sheen: "#cfe6ff"
    },
    thinking: {
      sky: "#3f6fa8",
      cloud: "#dde8f4",
      canopy: "#0e2c2e",
      meadow: "#3f7f5c",
      water: "#12525f",
      bloom: "#7d8cff",
      sheen: "#b6cdf0"
    },
    speaking: {
      sky: "#6fb0ec",
      cloud: "#fff6e8",
      canopy: "#204a16",
      meadow: "#7cc23f",
      water: "#1d8a76",
      bloom: "#ffb02e",
      sheen: "#ffe3c4"
    }
  }
},
  "shdr-31": {
  key: "shdr-31",
  label: "SHDR-31",
  note: "raymarched shell, volumetric godrays",
  frag: "\n#define AA 1\n#define MAX_STEPS 256\n\nmat3 transpose3(mat3 m) {\n  return mat3(\n    m[0][0], m[1][0], m[2][0],\n    m[0][1], m[1][1], m[2][1],\n    m[0][2], m[1][2], m[2][2]\n  );\n}\n\n// An artistic tumble, not an orthonormal rotation \u2014 the axes shear against each\n// other so the shell never repeats a clean spin.\nmat3 coronaRot(float a) {\n  return mat3(\n    cos(a), sin(a / 2.0) * sin(a), sin(a) * cos(a / 2.0),\n    0.0, cos(a / 2.0), -sin(a / 2.0),\n    -sin(a), sin(a / 2.0) * cos(a), cos(a / 2.0) * cos(a)\n  );\n}\n\nmat3 globalRot;\nmat3 globalInvRot;\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat shellRadius;\nfloat warpAmount;\nfloat rayGain;\nfloat warpFreqNow;\nfloat smoothKNow;\n\nfloat smin(float a, float b, float k) {\n  float h = clamp(0.5 + 0.5 * (b - a) / k, 0.0, 1.0);\n  return mix(b, a, h) - k * h * (1.0 - h);\n}\n\nfloat coronaSDF(vec3 p) {\n  vec3 p1 = p;\n  p1.zyx += sin(p.xzy * warpFreqNow) / max(warpAmount, 0.001);\n  return -smin(length(p1) - shellRadius, shellRadius - length(p), smoothKNow);\n}\n\nvec3 shellColor(vec3 p) {\n  float eps = 0.001;\n  vec3 normal = globalInvRot * normalize(vec3(\n    coronaSDF(p + vec3(eps, 0.0, 0.0)) - coronaSDF(p - vec3(eps, 0.0, 0.0)),\n    coronaSDF(p + vec3(0.0, eps, 0.0)) - coronaSDF(p - vec3(0.0, eps, 0.0)),\n    coronaSDF(p + vec3(0.0, 0.0, eps)) - coronaSDF(p - vec3(0.0, 0.0, eps))\n  ));\n\n  vec3 next = 1.0 - (normal * 0.5 + 0.5);\n  next = vec3(dot(next, vec3(1.0)) / 3.0);\n  return 1.025 - next * next;\n}\n\nvec4 coronaRender(vec2 fragCoord) {\n  vec2 uv = (fragCoord * 2.0 - uRes) / min(uRes.x, uRes.y);\n\n  vec3 ro = vec3(0.0, 0.0, -uP_camDist);\n  vec3 rd = normalize(vec3(uv, uP_fov));\n\n  ro = globalRot * ro;\n  rd = globalRot * rd;\n\n  vec3 p = ro;\n  float d = 1.0;\n  float t = 0.0;\n  float godrays = 0.0;\n\n  for (int i = 0; i < MAX_STEPS; i++) {\n    if (d <= 0.005 || t >= uP_maxDist) break;\n    p = ro + rd * t;\n    d = coronaSDF(p) / max(uP_stepScale, 0.5);\n\n    // Gate the accumulation on the shell so light bleeds out of the hollow\n    // instead of glowing uniformly through empty space.\n    float fog = length(p) > shellRadius\n      ? smoothstep(0.0, 0.5, coronaSDF(normalize(p) * shellRadius))\n      : 1.0;\n    godrays += (rayGain / (1.0 + dot(p, p) * uP_rayFalloff)) * fog;\n\n    t += d;\n  }\n\n  vec3 col = vec3(uP_ambient);\n  if (t < uP_maxDist) col = shellColor(p) * uP_surfaceLit;\n  col += godrays;\n\n  return vec4(col, 1.0);\n}\n\nvoid main() {\n  float animTime = uP_speed; // integrated clock\n  globalRot = coronaRot(animTime);\n  globalInvRot = transpose3(coronaRot(animTime));\n\n  /*\n    One shared BACK-AND-FORTH phase for the swept values. sin() of an\n    integrated clock is a true round trip \u2014 it eases through both ends\n    instead of snapping at a wrap, which fract() or mod() would do.\n\n    Every swept value is resolved HERE, once per fragment, and never read\n    straight from its uniform inside coronaSDF: the normal estimate calls\n    that SDF six more times, and a value that moved between those calls\n    would corrupt the finite difference and pit the shading.\n\n    uP_sweepRate is its own integrated clock, so the breathing rate tunes\n    without jumping the phase, and it only ever enters through sin() \u2014\n    safe for an unbounded clock. All three swings share the phase, so the\n    shell breathes as one motion rather than three unrelated wobbles.\n  */\n  float sweepPhase = sin(uP_sweepRate);\n\n  // Louder agent output pushes the godrays; user input roughens the shell and\n  // swells it slightly, so the silhouette breathes with speech.\n  shellRadius = uP_radius + uP_swell * uInput;\n  warpAmount = (uP_warp + uP_warpSwing * sweepPhase) * (1.0 - 0.25 * uInput - 0.15 * uOutput);\n  warpAmount = max(warpAmount, 0.05);\n  rayGain = uP_rayGain * (0.7 + 0.8 * uOutput + 0.3 * uInput);\n\n  warpFreqNow = max(uP_warpFreq + uP_freqSwing * sweepPhase, 0.05);\n\n  /*\n    smoothK reaches EXACTLY zero at the bottom of the speaking sweep\n    (0.25 +/- 0.25), and smin() divides by it \u2014 an unguarded zero is a\n    NaN across the whole SDF. The floor keeps the blend hard but finite.\n  */\n  smoothKNow = max(uP_smoothK + uP_smoothSwing * sweepPhase, 0.005);\n\n  vec4 acc = vec4(0.0);\n#if AA > 1\n  for (int mx = 0; mx < AA; mx++) {\n    for (int my = 0; my < AA; my++) {\n      vec2 offset = vec2(float(mx), float(my)) / float(AA) - 0.5;\n      acc += coronaRender(gl_FragCoord.xy + offset);\n    }\n  }\n  acc /= float(AA * AA);\n#else\n  acc = coronaRender(gl_FragCoord.xy);\n#endif\n\n  // Luminance becomes alpha so the orb composites onto the page instead of\n  // painting an opaque square.\n  //\n  // The colour is emitted light, so it is already premultiplied: rgb is what\n  // the orb adds, alpha is only how much background it hides. Multiplying rgb\n  // by alpha again (the usual move for a lit surface) would darken the glow\n  // quadratically and wash the godrays out.\n  vec3 col = clamp(acc.rgb, 0.0, 1.0);\n  float lum = dot(col, vec3(0.2126, 0.7152, 0.0722));\n  float a = clamp(lum * uP_alphaGain, 0.0, 1.0);\n\n  // The godrays are volumetric, so they reach the frame boundary and would\n  // otherwise show the canvas as a hard-edged glowing square. Taper radially to\n  // let the halo fall off into the page instead \u2014 colour as well as alpha,\n  // since premultiplied output would otherwise keep emitting at full brightness\n  // right up to the cutoff and leave a visible rim.\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, length(orbUV()));\n  col *= fade;\n  a *= fade;\n\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "speed", label: "Anim speed", min: 0.015, max: 10, step: 0.05, default: 1, integrate: true },
    { key: "sweepRate", label: "Sweep rate", min: 0, max: 6, step: 0.02, default: 0.5, integrate: true },
    { key: "radius", label: "Shell radius", min: 0.4, max: 10, step: 0.05, default: 2.6 },
    { key: "swell", label: "Input swell", min: 0, max: 3, step: 0.015, default: 0.18 },
    { key: "warp", label: "Warp divisor", min: 0.3, max: 10, step: 0.05, default: 0.9 },
    { key: "warpFreq", label: "Warp frequency", min: 0.15, max: 30, step: 0.15, default: 5.25 },
    { key: "warpSwing", label: "Warp swing", min: 0, max: 8, step: 0.05, default: 0 },
    { key: "freqSwing", label: "Frequency swing", min: 0, max: 15, step: 0.05, default: 0 },
    { key: "smoothSwing", label: "Softness swing", min: 0, max: 2, step: 0.005, default: 0 },
    { key: "smoothK", label: "Blend softness", min: 0.015, max: 4, step: 0.02, default: 0.42 },
    { key: "rayGain", label: "Godray gain", min: 0, max: 4, step: 0.02, default: 0.8 },
    { key: "rayFalloff", label: "Godray falloff", min: 0.3, max: 100, step: 0.5, default: 10.5 },
    { key: "surfaceLit", label: "Surface light", min: 0, max: 3, step: 0.015, default: 0.105 },
    { key: "ambient", label: "Ambient", min: 0, max: 1, step: 0.005, default: 0 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 3 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.45 },
    { key: "camDist", label: "Camera distance", min: 1.5, max: 100, step: 0.5, default: 12 },
    { key: "fov", label: "Lens", min: 0.3, max: 20, step: 0.1, default: 3.5 },
    { key: "stepScale", label: "Step safety", min: 0.3, max: 30, step: 0.5, default: 9 },
    { key: "maxDist", label: "Max distance", min: 3, max: 100, step: 1, default: 22 }
  ],
  colors: [],
  statePresets: {
    /*
      idle is the reference look, dialled in by hand: every swing at zero,
      so the shell holds still and only the tumble moves.
    */
    idle: {
      speed: 1,
      swell: 0.18,
      warp: 0.9,
      warpFreq: 5.25,
      smoothK: 0.42,
      rayGain: 0.8,
      rayFalloff: 10.5,
      alphaGain: 3,
      warpSwing: 0,
      freqSwing: 0,
      smoothSwing: 0
    },
    // thinking: warp frequency breathes 5 <-> 9 (7 +/- 2), everything else held
    thinking: {
      speed: 0.9,
      swell: 0.66,
      warp: 1,
      warpFreq: 7,
      smoothK: 0.58,
      rayGain: 0.52,
      rayFalloff: 8,
      alphaGain: 1.8,
      sweepRate: 0.5,
      freqSwing: 2,
      warpSwing: 0,
      smoothSwing: 0
    },
    /*
      speaking: three values sweep together, all of them round trips —
        warp       1.5 <-> 6     (3.75 +/- 2.25)
        warpFreq   15  <-> 24    (19.5 +/- 4.5)
        smoothK    0   <-> 0.5   (0.25 +/- 0.25, floored in the shader)
    */
    speaking: {
      speed: 0.9,
      swell: 0.66,
      warp: 3.75,
      warpSwing: 2.25,
      warpFreq: 19.5,
      freqSwing: 4.5,
      smoothK: 0.25,
      smoothSwing: 0.25,
      sweepRate: 0.8,
      rayGain: 0.52,
      rayFalloff: 8,
      alphaGain: 1.8
    }
  }
},
  "shdr-32": {
  key: "shdr-32",
  label: "SHDR-32",
  note: "a galaxy marched as gas and dust inside the ball",
  frag: "\n#define STEPS 56\n#define TURB_OCT 4\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat galDensity;\nfloat galCore;\nfloat galFalloff;\n\n/*\n  The galactic density at a point in the galaxy's own frame: the disc lies\n  in xz, the normal is y. Returns the density; writes the arm weight and the\n  cylindrical radius for the colour.\n*/\nfloat galaxy(vec3 p, float t, out float arm, out float rho) {\n  rho = length(p.xz);\n  float h = p.y;\n  // atan(0, 0) is undefined; the exact axis is all bulge anyway\n  float phi = rho > 1e-4 ? atan(p.z, p.x) : 0.0;\n  float lr = log(max(rho, 0.02));\n  float armPhase = phi * uP_arms - uP_wind * lr;\n\n  // feedback curl turbulence, shared phase\n  vec3 q = p * uP_turbScale;\n  float f = 1.0;\n  for (int k = 0; k < TURB_OCT; k++) {\n    q += cos(q.yzx * f + t) / f;\n    f *= 1.9;\n  }\n  float n = (sin(q.x) + sin(q.y) + sin(q.z)) / 3.0 * 0.5 + 0.5;\n  float clump = smoothstep(uP_threshold, 1.0, n);\n\n  arm = 0.5 + 0.5 * cos(armPhase + (n - 0.5) * uP_ragged);\n  arm = pow(arm, uP_armSharp);\n\n  float scaleH = uP_thick * (0.12 + rho);\n  float disc = exp(-rho * galFalloff) * exp(-abs(h) / scaleH);\n  float bulge = exp(-dot(p, p) * uP_bulge);\n\n  float dens = disc * (0.08 + 1.6 * arm) * (0.25 + 0.75 * clump) + bulge * galCore;\n  return dens * galDensity;\n}\n\n/*\n  One lattice of hashed stars. Each cell either carries a star or not, at a\n  hashed position, with its own twinkle rate; the 3x3 neighbourhood is\n  gathered so a star near a cell wall is not clipped.\n*/\nfloat starField(vec2 p, float density, float size, float twinkleT) {\n  vec2 id = floor(p);\n  vec2 f = fract(p);\n  float acc = 0.0;\n  for (int j = -1; j <= 1; j++) {\n    for (int i = -1; i <= 1; i++) {\n      vec2 o = vec2(float(i), float(j));\n      vec2 cid = id + o;\n      float h = hash(cid);\n      if (h > density) continue;\n      vec2 sp = o + vec2(hash(cid + 1.3), hash(cid + 2.7));\n      float dd = length(f - sp);\n      float tw = 0.55 + 0.45 * sin(twinkleT * (1.5 + 5.0 * hash(cid + 5.1)) + h * 40.0);\n      float sz = size * (0.5 + 1.2 * hash(cid + 8.9) * hash(cid + 8.9));\n      acc += tw * exp(-dd * dd / (sz * sz)) * (0.4 + 0.6 * h / max(density, 0.001));\n    }\n  }\n  return acc;\n}\n\nvec4 galaxyRender(vec2 fragCoord) {\n  vec2 uv = (2.0 * fragCoord - uRes) / min(uRes.x, uRes.y);\n  vec3 ro = vec3(0.0, 0.0, uP_camDist);\n  vec3 rd = normalize(vec3(uv, -uP_focal));\n\n  float t = uP_churn; // integrated clock: the turbulence boils\n  float spin = uP_spin; // integrated clock: the disc turns\n\n  // the galaxy frame: tip about x by the tilt, then turn about the disc's\n  // own normal\n  float ct = cos(uP_tilt);\n  float st = sin(uP_tilt);\n  float cs = cos(spin);\n  float sn = sin(spin);\n\n  vec3 acc = vec3(0.0);\n  vec3 T = vec3(1.0);\n  // extinction weighted to blue, so thick gas reddens what is behind it\n  vec3 absorb = vec3(0.7, 1.0, 1.5) * uP_absorb;\n\n  // march only the span the envelope can light\n  float z = max(uP_camDist - uP_envRadius * 1.05, 0.0);\n  float zEnd = uP_camDist + uP_envRadius * 1.05;\n  float dt = (zEnd - z) / float(STEPS);\n  // a hashed start offset per pixel hides the step banding\n  z += dt * hash(fragCoord * 0.37);\n\n  for (int i = 0; i < STEPS; i++) {\n    vec3 p = ro + rd * z;\n\n    // envelope: nothing outside the ball contributes\n    float env = 1.0 - smoothstep(uP_envRadius * 0.92, uP_envRadius, length(p));\n    if (env > 0.001) {\n      // into the galaxy frame\n      vec3 g = vec3(p.x, p.y * ct - p.z * st, p.y * st + p.z * ct);\n      g = vec3(g.x * cs - g.z * sn, g.y, g.x * sn + g.z * cs);\n\n      float arm = 0.0;\n      float rho = 0.0;\n      float d = galaxy(g / uP_envRadius, t, arm, rho) * env;\n\n      // the colour ramp, keyed to radius from the core\n      vec3 ramp = mix(uC_inner, uC_outer, smoothstep(0.12, uP_hueReach, rho));\n      float coreW = exp(-rho * rho * uP_bulge * 0.6);\n      vec3 emit = mix(ramp, uC_core, coreW) * (0.6 + 0.6 * arm);\n\n      acc += T * d * emit * dt;\n      T *= exp(-d * absorb * dt);\n    }\n\n    z += dt;\n    if (T.g < 0.004 || z > zEnd) break;\n  }\n\n  return vec4(acc, 1.0 - T.g);\n}\n\nvoid main() {\n  // The beat: one wave on the core-beat clock, shared by the core flare and\n  // the disc's breathing. Both depths are amplitudes, so they stage cleanly.\n  float wave = 0.5 + 0.5 * cos(uP_beat);\n  galDensity = uP_density * (1.0 + 0.35 * uInput);\n  galCore = uP_core * (1.0 + 0.7 * uOutput) * (1.0 + uP_pulse * wave);\n  // breathing: the disc's falloff relaxes on the wave, so the whole disc\n  // swells outward and draws back \u2014 a smooth exponential, safe to sweep\n  galFalloff = uP_falloff / (1.0 + uP_breathe * wave);\n\n  vec4 acc = galaxyRender(gl_FragCoord.xy);\n\n  /*\n    Stars, at the ray's exact hit with the galactic plane. The plane is the\n    tilted xz-plane through the origin; its world normal is the tilted y.\n    The lattice lives in the disc's own turning frame, so the stars turn\n    with the gas, and the march's transmittance dims them through the dust.\n  */\n  {\n    vec3 ro = vec3(0.0, 0.0, uP_camDist);\n    vec3 rd = normalize(vec3(orbUV(), -uP_focal));\n    float ct = cos(uP_tilt);\n    float st = sin(uP_tilt);\n    vec3 N = vec3(0.0, ct, st);\n    float denom = dot(N, rd);\n    if (abs(denom) > 1e-4) {\n      float th = -dot(N, ro) / denom;\n      vec3 q = ro + rd * th;\n      if (th > 0.0 && dot(q, q) < uP_envRadius * uP_envRadius * 0.9) {\n        vec3 g = vec3(q.x, q.y * ct - q.z * st, q.y * st + q.z * ct) / uP_envRadius;\n        float cs = cos(uP_spin);\n        float sn = sin(uP_spin);\n        vec2 gp = vec2(g.x * cs - g.z * sn, g.x * sn + g.z * cs);\n        float rho = length(gp);\n        float phi = rho > 1e-4 ? atan(gp.y, gp.x) : 0.0;\n        float armW = 0.5 + 0.5 * cos(phi * uP_arms - uP_wind * log(max(rho, 0.02)));\n        float sf = starField(gp * uP_starScale, uP_starDensity * (0.3 + 0.7 * armW), 0.12, uP_twinkle);\n        float veil = 1.0 - acc.a; // what the march let through\n        acc.rgb += vec3(1.0, 0.97, 0.9) * sf * uP_stars * exp(-rho * 1.5) * (0.25 + 0.75 * veil);\n      }\n    }\n  }\n\n  // tanh tone map per channel, tunable knee\n  vec3 col = tanh3(acc.rgb / max(uP_exposure, 0.01));\n  col = pow(clamp(col, 0.0, 1.0), vec3(uP_contrast));\n\n  // saturation about luminance, then the tint\n  float lum = dot(col, vec3(0.299, 0.587, 0.114));\n  col = mix(vec3(lum), col, uP_saturation);\n  col *= uC_tint;\n\n  // alpha from the brightest channel \u2014 emitted light (see shdr-18)\n  float peak = max(col.r, max(col.g, col.b));\n  float a = clamp(peak * uP_alphaGain, 0.0, 1.0);\n\n  // the night behind: a fill so the ball is a solid sphere, not a cut-out\n  col += uC_deep * uP_fill;\n  a = max(a, uP_fill);\n\n  // Analytic silhouette \u2014 identical construction to shdr-01: exact\n  // ray-to-centre distance against the radius, colour AND alpha.\n  vec3 mrd = normalize(vec3(orbUV(), -uP_focal));\n  float closest = length(cross(vec3(0.0, 0.0, uP_camDist), mrd));\n  float band = mix(0.35, 0.012, clamp(uP_edge, 0.0, 1.0));\n  float mask = 1.0 - smoothstep(uP_envRadius * (1.0 - band), uP_envRadius * 1.005, closest);\n  col *= mask;\n  a *= mask;\n\n  // a fresnel rim on the glass, inside the mask\n  float fres = smoothstep(uP_envRadius * 0.7, uP_envRadius, closest);\n  col += uC_rim * uP_rim * fres * fres * mask;\n\n  // safety taper at the frame boundary \u2014 colour as well as alpha\n  float r2d = length(orbUV());\n  float fade = 1.0 - smoothstep(uP_edgeFade, 1.0, r2d);\n  col *= fade;\n  a *= fade;\n\n  // Emitted light, so rgb is already premultiplied \u2014 do NOT scale by alpha\n  // again (see the same note in shdr-31).\n  gl_FragColor = vec4(col, a);\n}\n",
  params: [
    { key: "spin", label: "Disc turn", min: 0, max: 3, step: 0.01, default: 0.06, integrate: true },
    { key: "churn", label: "Gas churn", min: 0, max: 5, step: 0.02, default: 0.25, integrate: true },
    { key: "beat", label: "Core beat", min: 0, max: 12, step: 0.05, default: 0.8, integrate: true },
    { key: "twinkle", label: "Twinkle rate", min: 0, max: 12, step: 0.05, default: 1.2, integrate: true },
    { key: "camDist", label: "Camera distance", min: 1, max: 50, step: 0.3, default: 7 },
    { key: "focal", label: "Lens", min: 0.15, max: 15, step: 0.05, default: 2.25 },
    { key: "envRadius", label: "Envelope radius", min: 0.15, max: 15, step: 0.1, default: 2.6 },
    { key: "tilt", label: "Tilt (0 edge-on)", min: 0, max: 1.5, step: 0.01, default: 0.85 },
    { key: "arms", label: "Arm count", min: 1, max: 6, step: 1, default: 2 },
    { key: "wind", label: "Arm winding", min: 0, max: 8, step: 0.05, default: 3.4 },
    { key: "ragged", label: "Arm fray", min: 0, max: 12, step: 0.05, default: 3 },
    { key: "armSharp", label: "Arm sharpness", min: 0.3, max: 8, step: 0.05, default: 2.2 },
    { key: "falloff", label: "Disc falloff", min: 0.3, max: 12, step: 0.05, default: 1.7 },
    { key: "thick", label: "Disc thickness", min: 0.01, max: 1, step: 0.005, default: 0.035 },
    { key: "bulge", label: "Core tightness", min: 2, max: 200, step: 1, default: 40 },
    { key: "core", label: "Core density", min: 0, max: 20, step: 0.1, default: 5 },
    { key: "turbScale", label: "Turbulence scale", min: 0.5, max: 30, step: 0.1, default: 9 },
    { key: "threshold", label: "Clumping", min: 0, max: 1, step: 0.01, default: 0.35 },
    { key: "density", label: "Gas density", min: 0.1, max: 40, step: 0.1, default: 14 },
    { key: "absorb", label: "Dust absorption", min: 0, max: 20, step: 0.1, default: 3.5 },
    { key: "stars", label: "Stars", min: 0, max: 10, step: 0.05, default: 1.2 },
    { key: "starDensity", label: "Star density", min: 0, max: 1, step: 0.01, default: 0.5 },
    { key: "starScale", label: "Star scale", min: 5, max: 200, step: 1, default: 48 },
    { key: "hueReach", label: "Hue reach", min: 0.15, max: 1.5, step: 0.01, default: 0.6 },
    { key: "pulse", label: "Beat depth", min: 0, max: 3, step: 0.01, default: 0.2 },
    { key: "breathe", label: "Disc breathing", min: 0, max: 2, step: 0.01, default: 0 },
    { key: "exposure", label: "Exposure", min: 0.05, max: 50, step: 0.05, default: 1.1 },
    { key: "contrast", label: "Contrast", min: 0.15, max: 6, step: 0.05, default: 1.15 },
    { key: "saturation", label: "Saturation", min: 0, max: 4, step: 0.02, default: 1.35 },
    { key: "alphaGain", label: "Alpha gain", min: 0.05, max: 15, step: 0.1, default: 2 },
    { key: "fill", label: "Night fill", min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: "rim", label: "Rim light", min: 0, max: 3, step: 0.015, default: 0.35 },
    { key: "edge", label: "Edge sharpness", min: 0, max: 1, step: 0.01, default: 1 },
    { key: "edgeFade", label: "Halo falloff", min: 0.1, max: 3, step: 0.015, default: 0.98 }
  ],
  /*
   * Six stops: the overall tint, the core the bulge whitens toward, the
   * inner and outer arm colours the ramp runs between, the night the ball
   * is filled with, and the glass rim.
   */
  colors: [
    { key: "tint", label: "Tint", default: "#ffffff" },
    { key: "core", label: "Core", default: "#fff3d6" },
    { key: "inner", label: "Inner arms", default: "#7fb4ff" },
    { key: "outer", label: "Outer arms", default: "#c46bff" },
    { key: "deep", label: "Night", default: "#04050f" },
    { key: "rim", label: "Rim", default: "#8fb0ff" }
  ],
  /*
    Staged on the TILT first — each state is a different view of the disc —
    and then on the clocks and amplitudes. The tilt glides, and a tipping
    disc is the biggest, most legible motion this orb has, so the state
    change itself is the tell. The arm count and winding, the turbulence
    scale and the star scale all multiply a coordinate and are pinned.
  */
  statePresets: {
    /*
      at rest: the spiral seen about halfway between edge-on and face-on.
      A slow turn, the gas barely boiling, a lazy shallow beat on the core.
    */
    idle: {
      tilt: 0.85,
      spin: 0.06,
      churn: 0.25,
      beat: 0.8,
      twinkle: 1.2,
      pulse: 0.2,
      breathe: 0,
      ragged: 3,
      armSharp: 2.2,
      thick: 0.035,
      threshold: 0.35,
      density: 14,
      core: 5,
      absorb: 3.5,
      stars: 1.2,
      exposure: 1.1,
      contrast: 1.15,
      saturation: 1.35
    },
    /*
      searching: the disc swings FACE-ON and becomes a whirlpool. The arms
      fray to nothing and the gas boils at six times rest on a thicker
      disc, a sparser clumping and a heavier absorption, so what is left is
      filaments and shadow spinning at seven times rest — face-on, the turn
      is fully visible — with the core held down. Cold.
    */
    thinking: {
      tilt: 1.45,
      spin: 0.45,
      churn: 1.6,
      beat: 2.4,
      twinkle: 4.5,
      pulse: 0.25,
      breathe: 0,
      ragged: 8,
      armSharp: 1,
      thick: 0.07,
      threshold: 0.5,
      density: 20,
      core: 3,
      absorb: 6,
      stars: 1.8,
      exposure: 1.05,
      contrast: 1.3,
      saturation: 1.2
    },
    /*
      answering: the disc swings FACE-ON and lights up — the full spiral,
      arms sharp and wide, the core flaring on a hard beat (depth five
      times rest on a clock six times as fast) and the whole disc swelling
      outward and drawing back on the same wave. The gas is dense but the
      dust is cleared, so all of it glows, at a lower knee. Hot.
    */
    speaking: {
      tilt: 1.3,
      spin: 0.2,
      churn: 0.6,
      beat: 4.8,
      twinkle: 2.4,
      pulse: 1,
      breathe: 0.45,
      ragged: 2,
      armSharp: 1.8,
      thick: 0.04,
      threshold: 0.25,
      density: 18,
      core: 12,
      absorb: 1.6,
      stars: 2,
      exposure: 0.75,
      contrast: 1.05,
      saturation: 1.6
    }
  },
  // blue into violet at rest, ice into cyan while searching, gold into rose
  // while answering
  stateColors: {
    idle: { tint: "#ffffff", core: "#fff3d6", inner: "#7fb4ff", outer: "#c46bff", deep: "#04050f", rim: "#8fb0ff" },
    thinking: { tint: "#ffffff", core: "#e6f0ff", inner: "#6fb0ff", outer: "#4fe3ff", deep: "#030614", rim: "#7fa8ff" },
    speaking: { tint: "#ffffff", core: "#fff4c8", inner: "#ffa63c", outer: "#ff3f8e", deep: "#0a0508", rim: "#ffb98a" }
  }
},
  "shdr-33": {
  key: "shdr-33",
  label: "SHDR-33",
  note: "a thermal image, risograph-printed on the ball",
  frag: "\nconst float PI = 3.14159265359;\n\n// Volume-reactive values, resolved once per fragment in main().\nfloat heatGainNow;\nfloat heatJitterNow;\n\nfloat grainNoise(vec2 gpix, float frame, float seed) {\n  return hash(gpix + vec2(frame * 13.71 + seed, frame * 7.37 - seed));\n}\n\nmat2 rot2(float a) {\n  float c = cos(a);\n  float s = sin(a);\n  return mat2(c, -s, s, c);\n}\n\n/*\n  One ink screen. Square dots on a grid at angle a, offset o (the\n  misregistration), sized by the coverage: coverage 0 is paper, coverage 1\n  is a solid. Returns how much of this pixel the ink covers.\n\n  The grid is laid in SCREEN space, not on the wrapped plane: a print is\n  flat, and it is the picture that curves round the ball. A screen on the\n  wrapped coordinates changes pitch toward the limb and beats against the\n  other two into moire rings.\n*/\nfloat screen(vec2 uv, float a, vec2 o, float coverage, float soft) {\n  vec2 cell = rot2(a) * uv * uP_dots + o;\n  vec2 f = fract(cell) - 0.5;\n  float d = length(f); // a round dot: reads as tone, not as a grid\n  // dot half-size from coverage; sqrt so mid-tones read as mid-tones the\n  // way a real screen's area does\n  float size = 0.5 * sqrt(clamp(coverage * uP_dotGain, 0.0, 1.0));\n  return 1.0 - smoothstep(size - soft, size + soft, d);\n}\n\nvoid main() {\n  heatGainNow = uP_gain * (1.0 + 0.6 * uOutput);\n  heatJitterNow = uP_jitter * (1.0 + 1.5 * uInput);\n\n  vec2 uv = orbUV();\n  float rd = length(uv);\n  float R = uP_radius;\n  float mask = smoothstep(0.012, -0.012, rd - R);\n\n  if (mask <= 0.0) {\n    gl_FragColor = vec4(0.0);\n    return;\n  }\n\n  vec2 pl = uv / R;\n  float r2 = dot(pl, pl);\n  float z = sqrt(max(1.0 - r2, 0.0));\n  vec3 n = vec3(pl, z);\n\n  // roll the dome about Y on its own integrated clock\n  float cr = cos(uP_spin);\n  float sr = sin(uP_spin);\n  vec3 sp = vec3(n.x * cr - n.z * sr, n.y, n.x * sr + n.z * cr);\n\n  float t = uP_speed; // integrated clock: the sources drift\n\n  // stereographic wrap of the plane onto the ball\n  vec2 st = sp.xy / (1.3 + sp.z) * uP_scale;\n\n  /*\n    The heat: a drifting, domain-warped noise field with a threshold window\n    cut out of it. Two drifts at different rates so the pools travel and\n    change shape rather than slide as one sheet; the input jitter is a fast\n    wobble on top.\n  */\n  vec2 p = st * uP_freq + vec2(t * 0.11, -t * 0.07);\n  vec2 wp = st * uP_freq * 0.55 + vec2(-t * 0.05, t * 0.08);\n  vec2 warp = vec2(noise(wp + 3.1), noise(wp + 9.4)) - 0.5;\n  p += warp * uP_warp;\n  p += vec2(sin(t * 3.7), cos(t * 4.3)) * heatJitterNow;\n  float field = noise(p) * 0.62 + noise(p * 2.1 + 5.3) * 0.26 + noise(p * 4.2 + 1.7) * 0.12;\n  float heat = clamp((field - uP_lo) * heatGainNow / max(uP_hi - uP_lo, 0.01), 0.0, 1.0);\n\n  // grain tap 1: dither the field before it is banded, so the contour\n  // edges break up into speckle instead of clean steps\n  vec2 gpix = floor(gl_FragCoord.xy / max(uP_grainSize, 1.0));\n  float frame = floor(uTime * 48.0);\n  heat += (grainNoise(gpix, frame, 3.1) - 0.5) * uP_dither;\n\n  // the contours: quantize into bands, blend back with the smooth field\n  float banded = floor(heat * uP_bands + 0.5) / uP_bands;\n  heat = clamp(mix(heat, banded, uP_banding), 0.0, 1.0);\n  heat = pow(heat, uP_contrast);\n\n  // the thermal ramp\n  vec3 base = mix(uC_cold, uC_cool, smoothstep(0.0, 0.3, heat));\n  base = mix(base, uC_warm, smoothstep(0.3, 0.55, heat));\n  base = mix(base, uC_hot, smoothstep(0.55, 0.78, heat));\n  base = mix(base, uC_core, smoothstep(0.78, 0.97, heat));\n\n  /*\n    The print. Separate the palette into CMY coverage and lay each ink down\n    as its own screen; the paper shows through the gaps. The angles are the\n    classic offsets, scaled by the misregistration, plus a per-ink shift.\n  */\n  float soft = uP_dotSoft;\n  float mis = uP_misregister;\n  float cC = screen(uv, 0.035 * mis, vec2(0.22, 0.12) * mis, 1.0 - base.r, soft);\n  float cM = screen(uv, -0.03 * mis, vec2(-0.14, 0.2) * mis, 1.0 - base.g, soft);\n  float cY = screen(uv, 0.0, vec2(0.0), 1.0 - base.b, soft);\n\n  vec3 print = uC_paper;\n  print *= mix(vec3(1.0), vec3(0.05, 0.62, 0.92), cC * uP_ink);\n  print *= mix(vec3(1.0), vec3(0.92, 0.08, 0.48), cM * uP_ink);\n  print *= mix(vec3(1.0), vec3(0.98, 0.86, 0.02), cY * uP_ink);\n\n  // the unprinted palette is mixed back a little so the blacks stay black\n  // and the screens never wash the whole ball to paper\n  vec3 col = mix(base, print, uP_printMix);\n\n  // grain tap 2: paper\n  col *= 1.0 + (grainNoise(gpix, frame, 27.9) - 0.5) * uP_grain;\n\n  // dome shading keeps the ball a ball under the print\n  float lambert = clamp(dot(n, normalize(vec3(-0.45, 0.55, 0.7))), 0.0, 1.0);\n  col *= 1.0 - uP_light * (1.0 - lambert);\n  float fres = pow(1.0 - z, 2.5);\n  col += uC_paper * uP_rim * fres * 0.5;\n\n  // Surface orb bounded by a mask: alpha IS coverage, so premultiply \u2014 the\n  // opposite convention from the emissive orbs (see shdr-31).\n  float a = mask;\n  gl_FragColor = vec4(max(col, vec3(0.0)) * a, a);\n}\n",
  params: [
    { key: "speed", label: "Drift", min: 0.015, max: 10, step: 0.05, default: 0.5, integrate: true },
    { key: "spin", label: "Roll", min: 0, max: 5, step: 0.03, default: 0.05, integrate: true },
    { key: "radius", label: "Radius", min: 0.15, max: 3, step: 0.015, default: 0.9 },
    { key: "scale", label: "Zoom", min: 0.3, max: 8, step: 0.05, default: 3 },
    { key: "freq", label: "Pool scale", min: 0.2, max: 6, step: 0.05, default: 1.4 },
    { key: "warp", label: "Warp", min: 0, max: 3, step: 0.02, default: 0.6 },
    { key: "lo", label: "Cold threshold", min: 0, max: 1, step: 0.005, default: 0.42 },
    { key: "hi", label: "Hot threshold", min: 0, max: 1, step: 0.005, default: 0.74 },
    { key: "gain", label: "Heat gain", min: 0.1, max: 6, step: 0.02, default: 1 },
    { key: "jitter", label: "Heat jitter", min: 0, max: 0.5, step: 0.005, default: 0.015 },
    { key: "bands", label: "Contour bands", min: 2, max: 24, step: 1, default: 7 },
    { key: "banding", label: "Contour strength", min: 0, max: 1, step: 0.01, default: 0.85 },
    { key: "contrast", label: "Contrast", min: 0.3, max: 3, step: 0.02, default: 1 },
    { key: "dither", label: "Dither", min: 0, max: 0.6, step: 0.005, default: 0.05 },
    { key: "dots", label: "Screen pitch", min: 4, max: 120, step: 1, default: 46 },
    { key: "dotGain", label: "Dot gain", min: 0.2, max: 2, step: 0.01, default: 1 },
    { key: "dotSoft", label: "Dot softness", min: 0.01, max: 0.3, step: 0.005, default: 0.12 },
    { key: "misregister", label: "Misregistration", min: 0, max: 3, step: 0.02, default: 0.5 },
    { key: "ink", label: "Ink density", min: 0, max: 1, step: 0.01, default: 0.92 },
    { key: "printMix", label: "Print mix", min: 0, max: 1, step: 0.01, default: 0.28 },
    { key: "grain", label: "Paper grain", min: 0, max: 2, step: 0.01, default: 0.35 },
    { key: "grainSize", label: "Grain size", min: 1, max: 8, step: 1, default: 2 },
    { key: "light", label: "Key light", min: 0, max: 1, step: 0.01, default: 0.25 },
    { key: "rim", label: "Rim light", min: 0, max: 3, step: 0.015, default: 0.25 }
  ],
  /*
   * Six stops: five up the thermal ramp, and the paper the screens are
   * printed on.
   */
  colors: [
    { key: "cold", label: "Cold", default: "#0b0a1e" },
    { key: "cool", label: "Cool", default: "#3b2a9a" },
    { key: "warm", label: "Warm", default: "#f05a28" },
    { key: "hot", label: "Hot", default: "#f6b53a" },
    { key: "core", label: "Core", default: "#fff1e6" },
    { key: "paper", label: "Paper", default: "#f4ecdf" }
  ],
  /*
    All three states share the rest palette; idle is the rest preset.
    Speaking is the rest look set RACING in place — the drift at eighteen
    times rest on a roll forty times as fast, the pools slightly finer and
    the warp more than doubled, with the window dropped so more of it
    reads as hot — without the rescale thinking makes. Thinking is the
    rest look zoomed out and set racing: the plane at four times the
    zoom with the pools three times finer and the warp tripled, the drift
    at twenty times rest on a roll ten times as fast, the window dropped
    so more of it reads as hot, on fewer, softer bands and a finer screen.
    Note the zoom, the pool scale, the band count and the screen pitch all
    multiply a coordinate, so the transition into and out of thinking
    glides through a rescale — chosen deliberately.
  */
  statePresets: {
    idle: HEAT_REST,
    thinking: {
      ...HEAT_REST,
      speed: 10,
      spin: 0.51,
      scale: 4.6,
      freq: 3.1,
      warp: 1.82,
      lo: 0.3,
      hi: 0.66,
      jitter: 0,
      bands: 6,
      banding: 0.75,
      dots: 42
    },
    speaking: {
      ...HEAT_REST,
      speed: 8.8,
      spin: 2.01,
      freq: 1.3,
      warp: 1.42,
      lo: 0.345,
      hi: 0.72,
      jitter: 0
    }
  },
  stateColors: {
    idle: HEAT_PALETTE,
    thinking: HEAT_PALETTE,
    speaking: HEAT_PALETTE
  }
}
};

export const ORB_TITLES = {
  "shdr-01": "Prism Crystal",
  "shdr-02": "Scrollwork Dome",
  "shdr-03": "Rainbow Belt",
  "shdr-04": "Voxel Lattice",
  "shdr-05": "Chromatic Lenses",
  "shdr-06": "Interference Lattice",
  "shdr-07": "Twist Column",
  "shdr-08": "Pearl Contours",
  "shdr-09": "Latitude Rings",
  "shdr-10": "Knit Light",
  "shdr-11": "Quantum Chroma",
  "shdr-12": "Toy Bricks",
  "shdr-13": "Plasma Globe",
  "shdr-14": "Pixel Plasma",
  "shdr-15": "Particle Track",
  "shdr-16": "Water Caustics",
  "shdr-17": "Electric Storm",
  "shdr-18": "Folded Crystal",
  "shdr-19": "Cellular Beads",
  "shdr-20": "Fountain Film",
  "shdr-21": "Cloud Diffusion",
  "shdr-22": "Magnetic Field",
  "shdr-23": "CRT Matrix",
  "shdr-24": "Voxel Earth",
  "shdr-25": "Warped Field",
  "shdr-26": "Thread Web",
  "shdr-27": "Radar Mosaic",
  "shdr-28": "Binary Grid",
  "shdr-29": "LED Wall",
  "shdr-30": "Vanishing Meadow",
  "shdr-31": "Volumetric Rays",
  "shdr-32": "Galactic Core",
  "shdr-33": "Thermal Riso"
};

export const ORB_VARIANT_LIST = Object.values(ORB_VARIANTS).map((v) => ({
  key: v.key,
  label: ORB_TITLES[v.key] || v.label,
  code: v.label,
  note: v.note
}));
