const button = document.querySelector('#orb');
const canvas = document.querySelector('#orb-dust');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const forcedColors = matchMedia('(forced-colors: active)');
let status = 'idle';
let time = 18;
let warmth = 0;
let failure = 0;
let speed = 0.8;
let lastFrame = 0;
let frame;
let scene;

function createScene() {
  const gl = canvas.getContext('webgl', {
    alpha: true,
    antialias: true,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    depth: false,
    powerPreference: 'low-power',
  });
  if (!gl) throw new Error('WebGL unavailable');
  const program = gl.createProgram();
  const sources = [
    [
      gl.VERTEX_SHADER,
      `attribute vec2 p; varying vec2 uv;
      void main(){uv=p;gl_Position=vec4(p,0.,1.);}`,
    ],
    [
      gl.FRAGMENT_SHADER,
      `
      precision highp float;
      varying vec2 uv;
      uniform float t, energy, failure;
      mat2 turn(float a){return mat2(cos(a),-sin(a),sin(a),cos(a));}
      void main(){
        vec2 p=turn(t*.055)*(uv*.9);
        p.x+=.055*sin(p.y*6.+t*.4);p.y+=.07*sin(p.x*5.-t*.32);
        float r=length(p),a=atan(p.y,p.x);
        float ring=.44+.047*sin(a*3.+t*.5)+.028*cos(a*5.-t*.36);
        float d=r-ring;
        float orbit=exp(-d*d/(.087*.087));
        float swirl=.55+.45*sin(a*3.-t*.64+r*15.+sin(a*2.+t*.4));
        float fine=pow(.5+.5*sin(d*160.+a*7.-t*.8),7.);
        float vapor=exp(-d*d/(.16*.16))*(.5+.5*sin(a*4.-t*.3+r*23.))*.17;
        vec3 aCol=mix(vec3(.30,.43,.68),vec3(.82,.32,.21),energy);
        vec3 bCol=mix(vec3(.72,.8,.92),vec3(1.,.79,.52),energy);
        aCol=mix(aCol,vec3(.72,.17,.18),failure);
        bCol=mix(bCol,vec3(1.,.57,.50),failure);
        vec3 color=mix(aCol,bCol,swirl)+vec3(.24,.29,.33)*fine;
        float alpha=clamp(orbit*(.24+swirl*.5+fine*.25)+vapor,0.,1.);
        alpha*=smoothstep(.2,.3,r)*(1.-failure*(.12+.12*cos(t*2.)));
        gl_FragColor=vec4(color,alpha);
      }`,
    ],
  ];
  for (const [type, source] of sources) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS))
      throw new Error(gl.getShaderInfoLog(shader));
    gl.attachShader(program, shader);
    gl.deleteShader(shader);
  }
  gl.linkProgram(program);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS))
    throw new Error(gl.getProgramInfoLog(program));
  gl.useProgram(program);
  gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer());
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 1, -1, -1, 1, -1, 1, 1, -1, 1, 1]),
    gl.STATIC_DRAW,
  );
  const position = gl.getAttribLocation(program, 'p');
  gl.enableVertexAttribArray(position);
  gl.vertexAttribPointer(position, 2, gl.FLOAT, false, 0, 0);
  return {
    gl,
    time: gl.getUniformLocation(program, 't'),
    energy: gl.getUniformLocation(program, 'energy'),
    failure: gl.getUniformLocation(program, 'failure'),
  };
}

function draw(delta) {
  if (!scene || forcedColors.matches) return;
  const blend = reducedMotion.matches ? 1 : 1 - Math.exp(-delta * 3.5);
  warmth += (Number(status === 'attention') - warmth) * blend;
  failure += (Number(status === 'error') - failure) * blend;
  const targetSpeed = status === 'attention' ? 1.6 : status === 'error' ? 0.42 : 0.8;
  speed += (targetSpeed - speed) * blend;
  if (!reducedMotion.matches) time += delta * speed;
  scene.gl.uniform1f(scene.time, time);
  scene.gl.uniform1f(scene.energy, warmth);
  scene.gl.uniform1f(scene.failure, failure);
  scene.gl.drawArrays(scene.gl.TRIANGLES, 0, 6);
}

function animate(now) {
  if (now - lastFrame >= 1000 / 30 - 1) {
    draw(Math.min((now - lastFrame) / 1000, 0.1));
    lastFrame = now;
  }
  frame = requestAnimationFrame(animate);
}

function refresh() {
  cancelAnimationFrame(frame);
  if (!scene || document.hidden) return;
  const pixels = Math.round(88 * Math.min(devicePixelRatio || 1, 2));
  if (canvas.width !== pixels) canvas.width = canvas.height = pixels;
  scene.gl.viewport(0, 0, pixels, pixels);
  draw(0);
  if (!reducedMotion.matches && !forcedColors.matches) {
    lastFrame = performance.now();
    frame = requestAnimationFrame(animate);
  }
}

function initialize() {
  try {
    scene = createScene();
    button.classList.remove('fallback');
  } catch (error) {
    scene = null;
    button.classList.add('fallback');
    console.warn('Desktop orb uses its static fallback:', error.message);
  }
  refresh();
}
canvas.addEventListener('webglcontextlost', (event) => {
  event.preventDefault();
  cancelAnimationFrame(frame);
  scene = null;
  button.classList.add('fallback');
});
canvas.addEventListener('webglcontextrestored', initialize);
reducedMotion.addEventListener('change', refresh);
forcedColors.addEventListener('change', refresh);
document.addEventListener('visibilitychange', refresh);
window.addEventListener('resize', refresh);
initialize();

let start;
let moved = false;
let target;
let hideCard;
const card = document.querySelector('#orb-card');
window.orb.onLayout((layout) => {
  card.hidden = !layout;
  button.style.left = `${(layout?.x || 0) + 6}px`;
  button.style.top = `${(layout?.y || 0) + 6}px`;
  card.style.left = `${layout?.cardX || 0}px`;
});
button.addEventListener('pointerenter', () => {
  clearTimeout(hideCard);
  window.orb.card(true);
});
card.addEventListener('pointerenter', () => clearTimeout(hideCard));
document.body.addEventListener('pointerleave', () => {
  hideCard = setTimeout(() => window.orb.card(false), 120);
});
document.addEventListener('focusin', () => window.orb.card(true));
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') window.orb.card(false);
});
card.addEventListener('click', () => window.orb.open(target));
window.orb.onState((state) => {
  target = state.target;
  document.querySelector('#card-project').textContent = state.project;
  document.querySelector('#card-checkout').textContent = state.checkout;
  document.querySelector('#card-reason').textContent = state.reason;
  card.setAttribute(
    'aria-label',
    `${state.project} · ${state.checkout} · ${state.reason} · Return to session`,
  );
  const { label } = state;
  const count = state.count;
  status = state.status || (count ? 'attention' : 'idle');
  button.dataset.status = status;
  button.classList.toggle('attention', status === 'attention');
  button.classList.toggle('error', status === 'error');
  document.querySelector('#orb-core').textContent =
    status === 'attention' || status === 'error' ? '!' : '·';
  const badge = document.querySelector('#orb-count');
  badge.hidden = count < 2;
  badge.textContent = count;
  const subject = label || 'Claude';
  const suffix = count ? ` (${count})` : '';
  const title =
    status === 'error'
      ? `${subject} encountered an error${suffix}`
      : status === 'attention'
        ? `${subject} needs attention${suffix}`
        : status === 'working'
          ? 'Claude is working · Open Dwell'
          : 'Open Dwell';
  button.setAttribute('aria-label', `${title} · ${state.reason || ''}`);
  button.title = `${title} · Drag to move · Right-click to hide`;
  if (reducedMotion.matches && !document.hidden) draw(0);
});
button.addEventListener('pointerdown', (event) => {
  if (event.button !== 0) return;
  start = { x: event.screenX, y: event.screenY };
  moved = false;
  button.setPointerCapture(event.pointerId);
  window.orb.drag('start');
});
button.addEventListener('pointermove', (event) => {
  if (!start) return;
  if (Math.hypot(event.screenX - start.x, event.screenY - start.y) > 4) moved = true;
  if (moved) window.orb.drag('move');
});
button.addEventListener('lostpointercapture', () => {
  start = null;
  window.orb.drag('end');
});
button.addEventListener('click', () => {
  if (!moved) window.orb.open(target);
});
button.addEventListener('keydown', () => {
  moved = false;
});
