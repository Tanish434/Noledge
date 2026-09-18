/**
 * Universal WebGL Orb Engine for Orbkit Variants (SHDR-01 to SHDR-33)
 * Renders on a SINGLE WebGL Canvas & Context without context drops or GPU exhaustion.
 * Dynamically swaps shader programs and uniforms on demand.
 */

import { ORB_VARIANTS, ORB_GLSL_HELPERS, paramUniformDecls } from "./orb-variants.js";

const VERT_SRC = `
attribute vec2 aPos;
void main() {
  gl_Position = vec4(aPos, 0.0, 1.0);
}
`;

function clamp01(v) {
  return Math.max(0.0, Math.min(1.0, v));
}

function hexToRgb(hex) {
  if (!hex) return [1, 1, 1];
  let h = hex.replace("#", "").trim();
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  const n = parseInt(h, 16);
  if (h.length !== 6 || Number.isNaN(n)) return [1, 1, 1];
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

const PARAM_EASE = 4.0;
const springOut = { x: 0, v: 0 };
function springStep(x, v, target, dt, omega) {
  const f = 1 + 2 * dt * omega;
  const oo = omega * omega;
  const hoo = dt * oo;
  const hhoo = dt * hoo;
  const detInv = 1 / (f + hhoo);
  springOut.x = (f * x + dt * v + hhoo * target) * detInv;
  springOut.v = (v + hoo * (target - x)) * detInv;
}

export class OrbEngine {
  constructor(canvas, initialVariantKey = "shdr-01") {
    this.canvas = canvas;
    this.gl = canvas.getContext("webgl", {
      alpha: true,
      antialias: false,
      premultipliedAlpha: true,
      powerPreference: "high-performance"
    });

    if (!this.gl) {
      console.error("[OrbEngine] WebGL 1.0 is not supported in this browser!");
      return;
    }

    const gl = this.gl;
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.ONE, gl.ONE_MINUS_SRC_ALPHA);

    // Full-screen triangle buffer
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW);

    // Shared compiled vertex shader
    this.vs = this.compileShader(gl.VERTEX_SHADER, VERT_SRC);

    // Program cache: variantKey -> { program, fs, uniforms }
    this.programCache = new Map();

    // State & timing
    this.currentState = "idle";
    this.previewOverride = false;
    this.tSec = 0;
    this.anim = 0;
    this.speed = 0.5;
    this.speedVel = 0;
    this.lastTime = performance.now();

    // Volume channels
    this.curIn = 0.0;
    this.curOut = 0.0;
    this.liveAudioInput = 0.0;
    this.liveAudioOutput = 0.0;

    // Per-variant parameter storage
    this.currentVariant = null;
    this.activeProgram = null;
    this.paramCur = {};
    this.paramVel = {};
    this.paramClocks = {};
    this.colorCur = {};

    // Initial variant
    const saved = localStorage.getItem("selected_orb_variant");
    const startKey = (saved && ORB_VARIANTS[saved]) ? saved : initialVariantKey;
    this.switchVariant(startKey);

    this.destroyed = false;
    this.animFrameId = null;
    this.resize = this.resize.bind(this);
    this.render = this.render.bind(this);
    window.addEventListener("resize", this.resize);
    this.resize();

    this.animFrameId = requestAnimationFrame(this.render);
  }

  destroy() {
    this.destroyed = true;
    if (this.animFrameId) {
      cancelAnimationFrame(this.animFrameId);
    }
    window.removeEventListener("resize", this.resize);
  }

  compileShader(type, src) {
    const gl = this.gl;
    const shader = gl.createShader(type);
    gl.shaderSource(shader, src);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("[OrbEngine] Shader compile error:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
      return null;
    }
    return shader;
  }

  switchVariant(key) {
    const variant = ORB_VARIANTS[key];
    if (!variant) {
      console.warn(`[OrbEngine] Variant "${key}" not found.`);
      return false;
    }

    const gl = this.gl;

    // Check if program already cached
    let entry = this.programCache.get(key);
    if (!entry) {
      const fsSrc = ORB_GLSL_HELPERS + paramUniformDecls(variant) + variant.frag;
      const fs = this.compileShader(gl.FRAGMENT_SHADER, fsSrc);
      if (!fs) {
        console.error(`[OrbEngine] Failed to compile fragment shader for ${key}`);
        return false;
      }

      const program = gl.createProgram();
      gl.attachShader(program, this.vs);
      gl.attachShader(program, fs);
      gl.linkProgram(program);

      if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
        console.error(`[OrbEngine] Link error for ${key}:`, gl.getProgramInfoLog(program));
        gl.deleteShader(fs);
        gl.deleteProgram(program);
        return false;
      }

      // Query uniform locations
      const uniforms = {
        uRes: gl.getUniformLocation(program, "uRes"),
        uTime: gl.getUniformLocation(program, "uTime"),
        uAnim: gl.getUniformLocation(program, "uAnim"),
        uInput: gl.getUniformLocation(program, "uInput"),
        uOutput: gl.getUniformLocation(program, "uOutput"),
        params: (variant.params || []).map((p) => ({
          key: p.key,
          def: p,
          loc: gl.getUniformLocation(program, `uP_${p.key}`)
        })),
        colors: (variant.colors || []).map((c) => ({
          key: c.key,
          def: c,
          loc: gl.getUniformLocation(program, `uC_${c.key}`)
        }))
      };

      entry = { program, fs, uniforms };
      this.programCache.set(key, entry);
    }

    this.currentVariant = variant;
    this.activeProgram = entry.program;
    this.activeUniforms = entry.uniforms;

    // Initialize/sync parameter values
    const statePresets = variant.statePresets || {};
    const activePreset = statePresets[this.currentState] || {};

    for (const p of variant.params || []) {
      const target = typeof activePreset[p.key] === "number" ? activePreset[p.key] : p.default;
      if (this.paramCur[p.key] === undefined) {
        this.paramCur[p.key] = target;
      }
      this.paramVel[p.key] = 0;
      if (this.paramClocks[p.key] === undefined) {
        this.paramClocks[p.key] = Math.random() * 50;
      }
    }

    for (const c of variant.colors || []) {
      const targetHex = (variant.stateColors && variant.stateColors[this.currentState] && variant.stateColors[this.currentState][c.key]) || c.default;
      this.colorCur[c.key] = hexToRgb(targetHex);
    }

    localStorage.setItem("selected_orb_variant", key);
    this.resize();
    return true;
  }

  resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(1, Math.floor((rect.width || 240) * dpr));
    const height = Math.max(1, Math.floor((rect.height || 240) * dpr));

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
      this.gl.viewport(0, 0, width, height);
    }

    if (this.activeProgram && this.activeUniforms && this.activeUniforms.uRes) {
      this.gl.useProgram(this.activeProgram);
      this.gl.uniform2f(this.activeUniforms.uRes, width, height);
    }
  }

  setState(state) {
    if (state !== "idle" && state !== "thinking" && state !== "speaking") return;
    this.currentState = state;
  }

  setAudioInput(level) {
    this.liveAudioInput = clamp01(level);
  }

  setAudioOutput(level) {
    this.liveAudioOutput = clamp01(level);
  }

  getSynthesizedVolumes(tSec) {
    switch (this.currentState) {
      case "idle":
        return [0.0, 0.22];

      case "thinking": {
        // Active, distinct thinking wave oscillation
        // Modulates both channels with harmonic sines so the shader ripples & breathes actively
        const base = 0.42 + 0.12 * Math.sin(tSec * 1.8);
        const wander = 0.08 * Math.sin(tSec * 3.1) * Math.sin(tSec * 0.8 + 1.2);
        const inVol = clamp01(base + wander);
        const outVol = clamp01(0.52 + 0.20 * Math.sin(tSec * 2.4 + 0.7));
        return [inVol, outVol];
      }

      case "speaking": {
        // High energy expressive speaking pulse
        const inVol = clamp01(0.60 + Math.sin(tSec * 4.8) * 0.25);
        const outVol = clamp01(0.72 + Math.sin(tSec * 3.6) * 0.25);
        return [inVol, outVol];
      }

      default:
        return [0.0, 0.2];
    }
  }

  render(now) {
    if (this.destroyed) return;

    const dt = Math.min((now - this.lastTime) / 1000, 0.05);
    this.lastTime = now;
    this.tSec += dt;

    if (!this.activeProgram || !this.currentVariant) {
      if (!this.destroyed) {
        this.animFrameId = requestAnimationFrame(this.render);
      }
      return;
    }

    const gl = this.gl;
    const variant = this.currentVariant;
    const uniforms = this.activeUniforms;

    // Resolve volume targets
    const [synIn, synOut] = this.getSynthesizedVolumes(this.tSec);
    const targetIn = this.liveAudioInput > 0.01 ? this.liveAudioInput : synIn;
    const targetOut = this.liveAudioOutput > 0.01 ? this.liveAudioOutput : synOut;

    // Smooth volume channels
    const kVol = 1 - Math.exp(-dt * 12.0);
    this.curIn += (targetIn - this.curIn) * kVol;
    this.curOut += (targetOut - this.curOut) * kVol;

    // Flow speed multiplier
    let targetSpeed = 0.1 + (1 - Math.pow(this.curOut - 1, 2)) * 0.9;
    if (this.currentState === "thinking") {
      // Dynamic thinking tempo acceleration
      targetSpeed = 1.30 + 0.35 * Math.sin(this.tSec * 2.5);
    }
    springStep(this.speed, this.speedVel, targetSpeed, dt, PARAM_EASE);
    this.speed = springOut.x;
    this.speedVel = springOut.v;

    this.anim += dt * this.speed;

    // Render pass
    gl.clearColor(0, 0, 0, 0);
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.useProgram(this.activeProgram);

    // Bind vertex quad
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    const aPos = gl.getAttribLocation(this.activeProgram, "aPos");
    if (aPos >= 0) {
      gl.enableVertexAttribArray(aPos);
      gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);
    }

    // Upload core engine uniforms
    gl.uniform2f(uniforms.uRes, this.canvas.width, this.canvas.height);
    gl.uniform1f(uniforms.uTime, this.tSec * 0.5);
    gl.uniform1f(uniforms.uAnim, this.anim);
    gl.uniform1f(uniforms.uInput, this.curIn);
    gl.uniform1f(uniforms.uOutput, this.curOut);

    // Easing per-variant params
    const statePreset = (variant.statePresets && variant.statePresets[this.currentState]) || {};

    for (const p of uniforms.params) {
      const def = p.def;
      const target = typeof statePreset[def.key] === "number" ? statePreset[def.key] : def.default;
      const cur = this.paramCur[def.key] ?? target;

      springStep(cur, this.paramVel[def.key] ?? 0, target, dt, PARAM_EASE);
      this.paramCur[def.key] = springOut.x;
      this.paramVel[def.key] = springOut.v;

      if (def.integrate) {
        const clock = (this.paramClocks[def.key] ?? 0) + dt * this.speed * springOut.x;
        this.paramClocks[def.key] = clock;
        gl.uniform1f(p.loc, clock);
      } else {
        gl.uniform1f(p.loc, springOut.x);
      }
    }

    // Easing per-variant colors
    for (const c of uniforms.colors) {
      const def = c.def;
      const targetHex = (variant.stateColors && variant.stateColors[this.currentState] && variant.stateColors[this.currentState][def.key]) || def.default;
      const targetRgb = hexToRgb(targetHex);
      const curRgb = this.colorCur[def.key] || targetRgb;

      const lerpRate = Math.min(dt * 5.0, 1.0);
      curRgb[0] += (targetRgb[0] - curRgb[0]) * lerpRate;
      curRgb[1] += (targetRgb[1] - curRgb[1]) * lerpRate;
      curRgb[2] += (targetRgb[2] - curRgb[2]) * lerpRate;

      gl.uniform3f(c.loc, curRgb[0], curRgb[1], curRgb[2]);
    }

    gl.drawArrays(gl.TRIANGLES, 0, 3);

    if (!this.destroyed) {
      this.animFrameId = requestAnimationFrame(this.render);
    }
  }
}

// Backward compatibility export
export { OrbEngine as Shdr31Orb };
