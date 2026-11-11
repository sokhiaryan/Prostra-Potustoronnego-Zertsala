// Thin WebGL2 helpers: context creation with capability checks, programs, render targets.

/** An error whose message is safe and useful to show to the user. */
export class GpuError extends Error {
  constructor(
    readonly title: string,
    message: string,
    readonly detail = '',
  ) {
    super(message);
    this.name = 'GpuError';
  }
}

export interface Caps {
  /** RGBA32F render targets with linear filtering (used for the accumulation buffer). */
  float32: boolean;
  /** EXT_disjoint_timer_query_webgl2, or null. */
  timer: { TIME_ELAPSED_EXT: number; GPU_DISJOINT_EXT: number } | null;
  renderer: string;
}

export function createContext(canvas: HTMLCanvasElement): { gl: WebGL2RenderingContext; caps: Caps } {
  const gl = canvas.getContext('webgl2', {
    antialias: false,
    alpha: false,
    depth: false,
    stencil: false,
    powerPreference: 'high-performance',
    preserveDrawingBuffer: false,
  });
  if (!gl) {
    throw new GpuError(
      'WebGL2 is not available',
      'This explorer renders on the GPU through WebGL2, which this browser or device did not provide. ' +
        'Try a current version of Chrome, Edge, Firefox or Safari, and make sure hardware acceleration is enabled.',
    );
  }
  const full = gl.getExtension('EXT_color_buffer_float');
  const half = full ?? gl.getExtension('EXT_color_buffer_half_float');
  if (!half) {
    throw new GpuError(
      'HDR render targets are not supported',
      'The GPU driver does not allow rendering to floating-point textures, which the HDR pipeline needs.',
    );
  }
  const linear = gl.getExtension('OES_texture_float_linear');
  const dbg = gl.getExtension('WEBGL_debug_renderer_info');
  return {
    gl,
    caps: {
      float32: !!full && !!linear,
      timer: gl.getExtension('EXT_disjoint_timer_query_webgl2'),
      renderer: dbg ? String(gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL)) : 'unknown',
    },
  };
}

function compileShader(gl: WebGL2RenderingContext, type: number, src: string): WebGLShader {
  const sh = gl.createShader(type);
  if (!sh) throw new GpuError('GPU error', 'Could not create a shader object (context lost?).');
  gl.shaderSource(sh, src);
  gl.compileShader(sh);
  return sh;
}

export class Program {
  private readonly locs = new Map<string, WebGLUniformLocation | null>();

  constructor(
    private readonly gl: WebGL2RenderingContext,
    readonly handle: WebGLProgram,
  ) {}

  use(): void {
    this.gl.useProgram(this.handle);
  }

  /** Cached uniform lookup; null (inactive uniform) is cached too and is a no-op to set. */
  loc(name: string): WebGLUniformLocation | null {
    let l = this.locs.get(name);
    if (l === undefined) {
      l = this.gl.getUniformLocation(this.handle, name);
      this.locs.set(name, l);
    }
    return l;
  }
}

export function createProgram(gl: WebGL2RenderingContext, vsSrc: string, fsSrc: string, label: string): Program {
  const vs = compileShader(gl, gl.VERTEX_SHADER, vsSrc);
  const fs = compileShader(gl, gl.FRAGMENT_SHADER, fsSrc);
  const prog = gl.createProgram();
  if (!prog) throw new GpuError('GPU error', 'Could not create a shader program (context lost?).');
  gl.attachShader(prog, vs);
  gl.attachShader(prog, fs);
  gl.linkProgram(prog);
  if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) {
    const log = [gl.getShaderInfoLog(vs), gl.getShaderInfoLog(fs), gl.getProgramInfoLog(prog)]
      .filter((s) => s && s.trim().length > 0)
      .join('\n');
    throw new GpuError(
      'A shader failed to compile',
      `The "${label}" shader was rejected by the GPU driver, so the image cannot be drawn.`,
      log,
    );
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  return new Program(gl, prog);
}

export interface Target {
  tex: WebGLTexture;
  fbo: WebGLFramebuffer;
  w: number;
  h: number;
}

export function createTarget(
  gl: WebGL2RenderingContext,
  w: number,
  h: number,
  float32: boolean,
  filter: number,
): Target {
  const tex = gl.createTexture();
  const fbo = gl.createFramebuffer();
  if (!tex || !fbo) throw new GpuError('GPU error', 'Could not allocate a render target (context lost?).');
  gl.bindTexture(gl.TEXTURE_2D, tex);
  gl.texStorage2D(gl.TEXTURE_2D, 1, float32 ? gl.RGBA32F : gl.RGBA16F, w, h);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
  gl.bindFramebuffer(gl.FRAMEBUFFER, fbo);
  gl.framebufferTexture2D(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.TEXTURE_2D, tex, 0);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new GpuError(
      'HDR render targets are not supported',
      'The GPU refused a floating-point framebuffer that the HDR pipeline needs.',
      `framebuffer status 0x${status.toString(16)}`,
    );
  }
  return { tex, fbo, w, h };
}

export function deleteTarget(gl: WebGL2RenderingContext, t: Target): void {
  gl.deleteTexture(t.tex);
  gl.deleteFramebuffer(t.fbo);
}
