// Keyboard and mouse, with pointer lock turning the mouse into look. Hardening
// against lost key-up events (alt-tab mid-press, a modifier interrupting the
// stream): opposite directions never stay held together, any modifier press
// clears stuck keys except Shift (sprint), and blur / focus / visibility
// changes clear the whole set. Edge presses are consumed once per frame.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };

  const OPPOSITES = [
    ['KeyA', 'KeyD'],
    ['KeyW', 'KeyS'],
  ];

  function dropOpposite(code) {
    for (const [a, b] of OPPOSITES) {
      if (code === a) keys.delete(b);
      if (code === b) keys.delete(a);
    }
  }

  function clearAll() {
    keys.clear();
    pressed.clear();
    state.firing = false;
  }

  function setKey(event, down) {
    if (event.repeat) return;
    if (down) {
      dropOpposite(event.code);
      if (!keys.has(event.code)) pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => {
    if (event.code.startsWith('Control') || event.code.startsWith('Alt') || event.code === 'MetaLeft' || event.code === 'MetaRight') {
      keys.clear();
    }
    setKey(event, true);
  });
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', clearAll);
  window.addEventListener('focus', clearAll);
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) clearAll();
  });
  window.addEventListener('pagehide', clearAll);
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) state.firing = true;
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  window.addEventListener('contextmenu', (event) => event.preventDefault());
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) clearAll();
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      canvas.requestPointerLock();
    },
    releaseLock() {
      if (document.pointerLockElement) document.exitPointerLock();
    },
    takeLook() {
      const x = state.lookX;
      const y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return { x, y };
    },
    // One-frame edge: true only on the frame the key went down.
    wasPressed(code) {
      return pressed.has(code);
    },
    endFrame() {
      pressed.clear();
    },
    // Debug / verification injection: pretend a key went down or up.
    injectDown(code) {
      dropOpposite(code);
      pressed.add(code);
      keys.add(code);
    },
    injectUp(code) {
      keys.delete(code);
    },
    injectLook(dx, dy) {
      state.lookX += dx;
      state.lookY += dy;
    },
  };
}
