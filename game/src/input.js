// Keyboard and mouse, and the pointer lock that turns the mouse into look. Plain
// browser APIs only. Besides the held-key set, this file reports edges: keys
// pressed since the last frame (for buying and weapon switching) and mouse clicks
// (for semi-automatic weapons), both consumed once by main.js.
export function createInput(canvas, onLockChange) {
  const keys = new Set();
  const pressed = new Set();
  const state = { keys, locked: false, firing: false, lookX: 0, lookY: 0 };
  let clicked = false;
  // Reused edge buffers: the hot loop must not allocate a fresh array or
  // object every frame just to report what changed.
  const pressedOut = [];
  const lookOut = { x: 0, y: 0 };

  function setKey(event, down) {
    if (down) {
      if (!event.repeat) pressed.add(event.code);
      keys.add(event.code);
    } else {
      keys.delete(event.code);
    }
    if (event.code === 'Space') event.preventDefault();
  }

  window.addEventListener('keydown', (event) => setKey(event, true));
  window.addEventListener('keyup', (event) => setKey(event, false));
  window.addEventListener('blur', () => {
    keys.clear();
    pressed.clear();
    state.firing = false;
  });
  window.addEventListener('mousemove', (event) => {
    if (!state.locked) return;
    state.lookX += event.movementX;
    state.lookY += event.movementY;
  });
  window.addEventListener('mousedown', (event) => {
    if (state.locked && event.button === 0) {
      state.firing = true;
      clicked = true;
    }
  });
  window.addEventListener('mouseup', (event) => {
    if (event.button === 0) state.firing = false;
  });
  document.addEventListener('pointerlockchange', () => {
    state.locked = document.pointerLockElement === canvas;
    if (!state.locked) {
      keys.clear();
      state.firing = false;
    }
    onLockChange(state.locked);
  });

  return {
    state,
    requestLock() {
      // Chrome rejects the promise when the lock is requested too soon after
      // an Esc exit; a rejection here is not a game error, so swallow it.
      const result = canvas.requestPointerLock();
      if (result && result.catch) result.catch(() => {});
    },
    takeLook() {
      lookOut.x = state.lookX;
      lookOut.y = state.lookY;
      state.lookX = 0;
      state.lookY = 0;
      return lookOut;
    },
    takePressed() {
      pressedOut.length = 0;
      for (const code of pressed) pressedOut.push(code);
      pressed.clear();
      return pressedOut;
    },
    takeClick() {
      const was = clicked;
      clicked = false;
      return was;
    },
  };
}
