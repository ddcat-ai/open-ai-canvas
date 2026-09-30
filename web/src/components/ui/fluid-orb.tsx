import { useEffect, useRef, useState, type CSSProperties } from "react";

import { cn } from "@/lib/utils";
import "./fluid-orb.css";

type FluidOrbProps = {
    size?: number;
    color?: string;
    className?: string;
};

const VERTEX_SHADER = `
attribute vec2 a_position;
void main() {
  gl_Position = vec4(a_position, 0.0, 1.0);
}`;

const FRAGMENT_SHADER = `
precision highp float;
uniform vec2 u_resolution;
uniform float u_time;
uniform vec3 u_color;

vec3 mod289(vec3 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 mod289(vec4 x) { return x - floor(x * (1.0 / 289.0)) * 289.0; }
vec4 permute(vec4 x) { return mod289(((x * 34.0) + 1.0) * x); }
vec4 taylorInvSqrt(vec4 r) { return 1.79284291400159 - 0.85373472095314 * r; }

float snoise(vec3 v) {
  const vec2 C = vec2(1.0 / 6.0, 1.0 / 3.0);
  const vec4 D = vec4(0.0, 0.5, 1.0, 2.0);
  vec3 i = floor(v + dot(v, C.yyy));
  vec3 x0 = v - i + dot(i, C.xxx);
  vec3 g = step(x0.yzx, x0.xyz);
  vec3 l = 1.0 - g;
  vec3 i1 = min(g.xyz, l.zxy);
  vec3 i2 = max(g.xyz, l.zxy);
  vec3 x1 = x0 - i1 + C.xxx;
  vec3 x2 = x0 - i2 + C.yyy;
  vec3 x3 = x0 - D.yyy;
  i = mod289(i);
  vec4 p = permute(permute(permute(
      i.z + vec4(0.0, i1.z, i2.z, 1.0))
    + i.y + vec4(0.0, i1.y, i2.y, 1.0))
    + i.x + vec4(0.0, i1.x, i2.x, 1.0));
  float n_ = 0.142857142857;
  vec3 ns = n_ * D.wyz - D.xzx;
  vec4 j = p - 49.0 * floor(p * ns.z * ns.z);
  vec4 x_ = floor(j * ns.z);
  vec4 y_ = floor(j - 7.0 * x_);
  vec4 x = x_ * ns.x + ns.yyyy;
  vec4 y = y_ * ns.x + ns.yyyy;
  vec4 h = 1.0 - abs(x) - abs(y);
  vec4 b0 = vec4(x.xy, y.xy);
  vec4 b1 = vec4(x.zw, y.zw);
  vec4 s0 = floor(b0) * 2.0 + 1.0;
  vec4 s1 = floor(b1) * 2.0 + 1.0;
  vec4 sh = -step(h, vec4(0.0));
  vec4 a0 = b0.xzyw + s0.xzyw * sh.xxyy;
  vec4 a1 = b1.xzyw + s1.xzyw * sh.zzww;
  vec3 p0 = vec3(a0.xy, h.x);
  vec3 p1 = vec3(a0.zw, h.y);
  vec3 p2 = vec3(a1.xy, h.z);
  vec3 p3 = vec3(a1.zw, h.w);
  vec4 norm = taylorInvSqrt(vec4(dot(p0, p0), dot(p1, p1), dot(p2, p2), dot(p3, p3)));
  p0 *= norm.x; p1 *= norm.y; p2 *= norm.z; p3 *= norm.w;
  vec4 m = max(0.6 - vec4(dot(x0, x0), dot(x1, x1), dot(x2, x2), dot(x3, x3)), 0.0);
  m *= m;
  return 42.0 * dot(m * m, vec4(dot(p0, x0), dot(p1, x1), dot(p2, x2), dot(p3, x3)));
}

float fbm(vec3 p) {
  float value = 0.0;
  float amplitude = 0.5;
  for (int i = 0; i < 5; i++) {
    value += amplitude * snoise(p);
    p *= 2.0;
    amplitude *= 0.5;
  }
  return value;
}

void main() {
  // Center on the pixel grid. Dividing by the canvas size and then
  // stretching x by the aspect ratio shifts the disc whenever the
  // backing store is not square (border box, DPR rounding).
  vec2 p = (gl_FragCoord.xy - u_resolution.xy * 0.5) / (0.5 * min(u_resolution.x, u_resolution.y));
  float r = length(p);
  if (r > 1.0) discard;
  float y = p.y * 0.5 + 0.5;
  float t = u_time * 0.18;
  float n1 = fbm(vec3(p * 1.28, t));
  float n2 = fbm(vec3(p * 2.35 + n1 * 0.55, t * 1.22));
  float shape = smoothstep(1.0, 0.16, r + n2 * 0.2);
  float topGlow = smoothstep(0.16, 0.92, y);
  vec3 white = vec3(1.0);
  vec3 color = mix(u_color * 0.66, u_color * 1.17, n1 * 0.5 + 0.5);
  color = mix(color, white, topGlow * 0.96);
  color += vec3(0.11, 0.06, 0.17) * max(n2, 0.0) * (1.0 - topGlow);
  float rim = smoothstep(0.78, 0.99, r);
  color = mix(color, white, rim * 0.2);
  gl_FragColor = vec4(color, shape);
}`;

export function FluidOrb({ size = 56, color = "#6d5dfc", className }: FluidOrbProps) {
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const [fallback, setFallback] = useState(false);

    useEffect(() => {
        const canvas = canvasRef.current;
        if (!canvas) return;
        const gl = canvas.getContext("webgl", { alpha: true, antialias: true, premultipliedAlpha: true });
        if (!gl) {
            setFallback(true);
            return;
        }

        const compile = (type: number, source: string) => {
            const shader = gl.createShader(type);
            if (!shader) throw new Error("无法创建 Fluid Orb shader");
            gl.shaderSource(shader, source);
            gl.compileShader(shader);
            if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
                const detail = gl.getShaderInfoLog(shader) || "未知 shader 错误";
                gl.deleteShader(shader);
                throw new Error(detail);
            }
            return shader;
        };

        let frame = 0;
        let removeMotionListener = () => {};
        let program: WebGLProgram | null = null;
        let vertexShader: WebGLShader | null = null;
        let fragmentShader: WebGLShader | null = null;
        let buffer: WebGLBuffer | null = null;
        try {
            vertexShader = compile(gl.VERTEX_SHADER, VERTEX_SHADER);
            fragmentShader = compile(gl.FRAGMENT_SHADER, FRAGMENT_SHADER);
            program = gl.createProgram();
            if (!program) throw new Error("无法创建 Fluid Orb program");
            gl.attachShader(program, vertexShader);
            gl.attachShader(program, fragmentShader);
            gl.linkProgram(program);
            if (!gl.getProgramParameter(program, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(program) || "Fluid Orb link 失败");
            gl.useProgram(program);

            buffer = gl.createBuffer();
            gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
            gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]), gl.STATIC_DRAW);
            const position = gl.getAttribLocation(program, "a_position");
            gl.enableVertexAttribArray(position);
            gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);

            const resolution = gl.getUniformLocation(program, "u_resolution");
            const time = gl.getUniformLocation(program, "u_time");
            const colorUniform = gl.getUniformLocation(program, "u_color");
            const [red, green, blue] = hexToRgb(color);
            gl.uniform3f(colorUniform, red / 255, green / 255, blue / 255);

            const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
            const startedAt = performance.now();
            const render = (now: number) => {
                const ratio = Math.min(window.devicePixelRatio || 1, 2);
                const width = Math.max(1, Math.round(canvas.clientWidth * ratio));
                const height = Math.max(1, Math.round(canvas.clientHeight * ratio));
                if (canvas.width !== width || canvas.height !== height) {
                    canvas.width = width;
                    canvas.height = height;
                }
                gl.viewport(0, 0, width, height);
                gl.clearColor(0, 0, 0, 0);
                gl.clear(gl.COLOR_BUFFER_BIT);
                gl.uniform2f(resolution, width, height);
                gl.uniform1f(time, motionPreference.matches ? 0.8 : (now - startedAt) / 1000);
                gl.drawArrays(gl.TRIANGLES, 0, 6);
                if (!motionPreference.matches) frame = window.requestAnimationFrame(render);
            };
            const updateMotion = () => { window.cancelAnimationFrame(frame); frame = window.requestAnimationFrame(render); };
            motionPreference.addEventListener("change", updateMotion);
            removeMotionListener = () => motionPreference.removeEventListener("change", updateMotion);
            frame = window.requestAnimationFrame(render);
        } catch (error) {
            console.warn("Fluid Orb WebGL 初始化失败，已切换为 CSS 降级效果", error);
            setFallback(true);
        }

        return () => {
            window.cancelAnimationFrame(frame);
            removeMotionListener();
            if (buffer) gl.deleteBuffer(buffer);
            if (program) gl.deleteProgram(program);
            if (vertexShader) gl.deleteShader(vertexShader);
            if (fragmentShader) gl.deleteShader(fragmentShader);
        };
    }, [color]);

    return <span className={cn("fluid-orb", fallback && "is-fallback", className)} style={{ width: size, height: size, "--fluid-orb-color": color } as CSSProperties} aria-hidden="true">
        <canvas ref={canvasRef} />
        {fallback ? <span className="fluid-orb-fallback" /> : null}
    </span>;
}

function hexToRgb(value: string): [number, number, number] {
    const normalized = value.trim().replace(/^#/, "");
    const expanded = normalized.length === 3 ? normalized.split("").map((item) => item + item).join("") : normalized;
    const parsed = Number.parseInt(expanded, 16);
    if (!Number.isFinite(parsed) || expanded.length !== 6) return [109, 93, 252];
    return [(parsed >> 16) & 255, (parsed >> 8) & 255, parsed & 255];
}
