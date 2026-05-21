// WebGL liquid-mercury background animation.
// GPU-driven — runs independently of React's render cycle.
// Colors use the Finvastra brand palette (navy → gold).

import { useRef, useEffect } from 'react';

// ─── Vertex shader ────────────────────────────────────────────────────────────
const VS = `
  attribute vec2 a_pos;
  void main() { gl_Position = vec4(a_pos, 0.0, 1.0); }
`;

// ─── Fragment shader ──────────────────────────────────────────────────────────
const FS = `
  precision highp float;

  uniform vec2  u_res;
  uniform float u_time;
  uniform vec2  u_mouse;
  uniform vec2  u_clicks[8];
  uniform float u_click_times[8];

  float hash(vec2 p) {
    p = fract(p * vec2(234.34, 435.345));
    p += dot(p, p + 34.23);
    return fract(p.x * p.y);
  }

  float noise(vec2 p) {
    vec2 i = floor(p);
    vec2 f = fract(p);
    vec2 u = f * f * (3.0 - 2.0 * f);
    return mix(
      mix(hash(i),               hash(i + vec2(1.0, 0.0)), u.x),
      mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x),
      u.y
    );
  }

  float fbm(vec2 p) {
    float v = 0.0;
    float a = 0.5;
    for (int i = 0; i < 6; i++) {
      v += a * noise(p);
      p  = p * 2.1 + vec2(1.7, 9.2);
      a *= 0.5;
    }
    return v;
  }

  void main() {
    vec2 uv = gl_FragCoord.xy / u_res;
    vec2 p  = uv * 2.0 - 1.0;
    p.x    *= u_res.x / u_res.y;

    float t = u_time * 0.25;

    // Mouse position in same coordinate space
    vec2  mouse = u_mouse * 2.0 - 1.0;
    mouse.x    *= u_res.x / u_res.y;
    float dm    = length(p - mouse);

    // Double-FBM distortion
    vec2 q = vec2(
      fbm(p + t),
      fbm(p + vec2(5.2, 1.3) + t)
    );
    vec2 r = vec2(
      fbm(p + q + vec2(1.7, 9.2) + t * 0.8),
      fbm(p + q + vec2(8.3, 2.8) + t * 0.6)
    );

    // Mouse well — pulls the fluid toward the cursor
    vec2  md = mouse - p;
    float ml = length(md) + 0.001;
    r += (md / ml) * 0.05 * exp(-ml * 2.0);

    // Click ripples (8 slots; inactive slots have u_click_times[i] = -1000.0)
    for (int i = 0; i < 8; i++) {
      float age   = u_time - u_click_times[i];
      float alive = step(0.0, age) * (1.0 - step(3.0, age));
      vec2  cp    = u_clicks[i] * 2.0 - 1.0;
      cp.x       *= u_res.x / u_res.y;
      vec2  dc    = p - cp;
      float dcl   = length(dc) + 0.001;
      float wave  = sin(dcl * 12.0 - age * 7.0)
                    * exp(-dcl * 2.5) * exp(-age * 1.2) * alive;
      r += (dc / dcl) * wave * 0.04;
    }

    float n = fbm(p + r);

    // Finvastra brand ramp: deep navy → mid navy → gold-deep → gold
    vec3 c0 = vec3(0.043, 0.082, 0.219); // #0B1538 deep navy
    vec3 c1 = vec3(0.106, 0.165, 0.306); // #1B2A4E mid navy
    vec3 c2 = vec3(0.576, 0.451, 0.200); // #9A7E3F gold-deep
    vec3 c3 = vec3(0.788, 0.663, 0.380); // #C9A961 gold

    vec3 col = mix(c0,  c1, smoothstep(0.0,  0.33, n));
    col      = mix(col, c2, smoothstep(0.33, 0.66, n));
    col      = mix(col, c3, smoothstep(0.66, 1.0,  n));

    // Cool/warm micro-shift
    col += vec3(0.02,  0.01, -0.03) * (1.0 - n);
    col += vec3(0.08,  0.05, -0.02) * smoothstep(0.85, 1.0, n);

    // Specular highlight near mouse — gold tint
    col += vec3(0.78, 0.65, 0.35) * exp(-dm * 5.0) * 0.22;

    // Vignette
    col *= 1.0 - smoothstep(0.35, 1.3, length(uv - 0.5) * 1.6);

    gl_FragColor = vec4(clamp(col, 0.0, 1.0), 1.0);
  }
`;

// ─── Component ────────────────────────────────────────────────────────────────
export function MercuryBackground() {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;

    const gl = canvas.getContext('webgl');
    if (!gl) return;

    // Compile vertex shader
    const vert = gl.createShader(gl.VERTEX_SHADER);
    if (!vert) return;
    gl.shaderSource(vert, VS);
    gl.compileShader(vert);
    if (!gl.getShaderParameter(vert, gl.COMPILE_STATUS)) {
      console.error('[MercuryBackground] VS:', gl.getShaderInfoLog(vert));
      return;
    }

    // Compile fragment shader
    const frag = gl.createShader(gl.FRAGMENT_SHADER);
    if (!frag) return;
    gl.shaderSource(frag, FS);
    gl.compileShader(frag);
    if (!gl.getShaderParameter(frag, gl.COMPILE_STATUS)) {
      console.error('[MercuryBackground] FS:', gl.getShaderInfoLog(frag));
      return;
    }

    // Link program
    const prog = gl.createProgram();
    if (!prog) return;
    gl.attachShader(prog, vert);
    gl.attachShader(prog, frag);
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
      console.error('[MercuryBackground] Link:', gl.getProgramInfoLog(prog));
      return;
    }
    gl.useProgram(prog);

    // Fullscreen quad — two triangles covering clip space
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([
      -1, -1,  1, -1,  -1,  1,
      -1,  1,  1, -1,   1,  1,
    ]), gl.STATIC_DRAW);

    const aPos = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(aPos);
    gl.vertexAttribPointer(aPos, 2, gl.FLOAT, false, 0, 0);

    // Uniform locations — use [0] suffix for array uniforms
    const uRes        = gl.getUniformLocation(prog, 'u_res');
    const uTime       = gl.getUniformLocation(prog, 'u_time');
    const uMouse      = gl.getUniformLocation(prog, 'u_mouse');
    const uClicks     = gl.getUniformLocation(prog, 'u_clicks[0]');
    const uClickTimes = gl.getUniformLocation(prog, 'u_click_times[0]');

    // Mutable state (mutated in event handlers, read in render loop)
    let mouseX = 0.5;
    let mouseY = 0.5;
    const clicksData     = new Float32Array(16); // 8 × vec2
    const clickTimesData = new Float32Array(8).fill(-1000); // inactive = far past
    let   clickIdx       = 0;

    const startTime = performance.now();
    let   rafId     = 0;

    function resize() {
      canvas.width  = window.innerWidth;
      canvas.height = window.innerHeight;
      gl.viewport(0, 0, canvas.width, canvas.height);
    }
    resize();

    function render() {
      const t = (performance.now() - startTime) / 1000;
      gl.uniform2f(uRes,   canvas.width, canvas.height);
      gl.uniform1f(uTime,  t);
      gl.uniform2f(uMouse, mouseX, mouseY);
      gl.uniform2fv(uClicks,     clicksData);
      gl.uniform1fv(uClickTimes, clickTimesData);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
      rafId = requestAnimationFrame(render);
    }
    render();

    // Event handlers
    const onMove = (e: PointerEvent) => {
      mouseX = e.clientX / window.innerWidth;
      mouseY = 1 - e.clientY / window.innerHeight; // WebGL Y is flipped
    };
    const onDown = (e: PointerEvent) => {
      const t = (performance.now() - startTime) / 1000;
      const i = clickIdx % 8;
      clicksData[i * 2]     = e.clientX / window.innerWidth;
      clicksData[i * 2 + 1] = 1 - e.clientY / window.innerHeight;
      clickTimesData[i]     = t;
      clickIdx++;
    };
    const onResize = () => resize();

    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerdown', onDown);
    window.addEventListener('resize',      onResize);

    return () => {
      cancelAnimationFrame(rafId);
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerdown', onDown);
      window.removeEventListener('resize',      onResize);
    };
  }, []);

  return (
    <canvas
      ref={canvasRef}
      style={{
        position: 'fixed',
        inset:    0,
        width:    '100vw',
        height:   '100vh',
        display:  'block',
        zIndex:   0,
      }}
    />
  );
}
