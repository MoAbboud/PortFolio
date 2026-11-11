// Everything the driver can press: the keyboard, the on-screen pedals and buttons (mouse or
// fingers, several at once), and a game controller if one is plugged in.
//
//   Up arrow or W        throttle            Down arrow or S    brake
//   Shift (held)         gentler pedals      K or Space (held)  start key
//   T                    traction control    [ and ]            previous / next engine
//   M                    automatic / manual    V                  sound on / off
//   G                    a 0 to 60 run    H                  the maths panel
//
//   automatic:  P R N D the lever, Q / E a notch up or down
//   manual:     C or A (held) the clutch, 1 to 6 the gears, R reverse, N neutral,
//               Q / E down or up a gear
//
// A controller with the standard layout: right trigger throttle, left trigger brake, A the
// start key, X the clutch, the bumpers move the lever or the gears, Y toggles traction control.

import { createPedal, rampPedal, pedalPosition, dragPosition } from './pedals.js';
import { notch } from './lever.js';
import { sequential } from './stick.js';

const KEYS = {
  thr: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  start: ['KeyK', 'Space'],
  clutch: ['KeyC', 'KeyA'],
};

export class Controls {
  // elements: { pedals: { thr, brake, clutch }, start, lever: { P, R, N, D }, tc }
  // on: { lever(wanted), gear(n), tc(), cycle(by), box() } - what the page does when asked
  constructor(elements, on) {
    this.on = on;
    this.box = 'auto';
    this.gear = 0; // the manual gear the driver is asking for
    this.pedals = { thr: createPedal('thr'), brake: createPedal('brake'), clutch: createPedal('clutch') };
    this.gentle = false;
    this.startKey = false;
    this.startPointer = false;
    this.startPad = false;
    this.lever = 'P';
    this.padButtons = [];

    window.addEventListener('keydown', (e) => this.key(e, true));
    window.addEventListener('keyup', (e) => this.key(e, false));
    // A window that loses focus would otherwise keep a held key held for ever.
    window.addEventListener('blur', () => {
      for (const p of Object.values(this.pedals)) p.held = false;
      this.startKey = false;
      this.gentle = false;
    });

    for (const [name, el] of Object.entries(elements.pedals)) if (el) this.attachPedal(el, this.pedals[name]);
    this.attachHold(elements.start, (down) => { this.startPointer = down; });
    for (const [pos, el] of Object.entries(elements.lever)) {
      el.addEventListener('click', () => this.on.lever(pos));
    }
    elements.tc.addEventListener('click', () => this.on.tc());
  }

  key(e, down) {
    if (e.target instanceof HTMLInputElement) return;
    const code = e.code;
    if (code === 'ShiftLeft' || code === 'ShiftRight') this.gentle = down;
    let handled = false;
    for (const name of ['thr', 'brake', 'clutch']) {
      if (KEYS[name].includes(code)) {
        this.pedals[name].held = down;
        handled = true;
      }
    }
    if (KEYS.start.includes(code)) {
      this.startKey = down;
      handled = true;
    }
    if (down && !e.repeat) {
      if (this.box === 'auto') {
        const letter = { KeyP: 'P', KeyR: 'R', KeyN: 'N', KeyD: 'D' }[code];
        if (letter) this.on.lever(letter);
        if (code === 'KeyQ') this.on.lever(notch(this.lever, -1));
        if (code === 'KeyE') this.on.lever(notch(this.lever, 1));
        handled = handled || Boolean(letter);
      } else {
        const gear = { KeyR: -1, KeyN: 0 }[code] ?? (/^Digit[1-6]$/.test(code) ? Number(code[5]) : undefined);
        if (gear !== undefined) this.on.gear(gear);
        if (code === 'KeyQ') this.on.gear(sequential(this.gear, -1));
        if (code === 'KeyE') this.on.gear(sequential(this.gear, 1));
        handled = handled || gear !== undefined;
      }
      if (code === 'KeyT') this.on.tc();
      if (code === 'KeyM') this.on.box();
      if (code === 'KeyV') this.on.sound?.();
      if (code === 'KeyG') this.on.run?.();
      if (code === 'KeyH') this.on.maths?.();
      if (code === 'BracketLeft') this.on.cycle(-1);
      if (code === 'BracketRight') this.on.cycle(1);
      handled = handled || ['KeyQ', 'KeyE', 'KeyT', 'KeyM', 'KeyV', 'KeyG', 'KeyH'].includes(code);
    }
    // Arrows and Space would otherwise scroll the page while driving.
    if (handled) e.preventDefault();
  }

  // A pedal pressed anywhere along it: near the top is a little, near the bottom is a lot, and
  // a finger can slide. Each pointer keeps its own pedal, so two thumbs work two pedals.
  attachPedal(el, pedal) {
    let id = null;
    const at = (e) => {
      const r = el.getBoundingClientRect();
      pedal.pointer = dragPosition(r.top, e.clientY, r.height);
    };
    el.addEventListener('pointerdown', (e) => {
      id = e.pointerId;
      el.setPointerCapture(id);
      at(e);
      e.preventDefault();
    });
    el.addEventListener('pointermove', (e) => { if (e.pointerId === id) at(e); });
    const up = (e) => {
      if (e.pointerId !== id) return;
      id = null;
      pedal.pointer = null;
    };
    el.addEventListener('pointerup', up);
    el.addEventListener('pointercancel', up);
  }

  attachHold(el, set) {
    el.addEventListener('pointerdown', (e) => {
      el.setPointerCapture(e.pointerId);
      set(true);
      e.preventDefault();
    });
    for (const type of ['pointerup', 'pointercancel']) el.addEventListener(type, () => set(false));
  }

  // The first controller with the standard layout, if any.
  pollPad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    const pad = [...pads].find((p) => p && p.mapping === 'standard');
    if (!pad) {
      for (const p of Object.values(this.pedals)) p.pad = 0;
      this.startPad = false;
      return;
    }
    const b = pad.buttons;
    this.pedals.thr.pad = b[7]?.value ?? 0;
    this.pedals.brake.pad = b[6]?.value ?? 0;
    this.pedals.clutch.pad = b[2]?.pressed ? 1 : 0;
    this.startPad = Boolean(b[0]?.pressed);
    const edge = (i) => b[i]?.pressed && !this.padButtons[i];
    if (this.box === 'auto') {
      if (edge(5)) this.on.lever(notch(this.lever, 1));
      if (edge(4)) this.on.lever(notch(this.lever, -1));
    } else {
      if (edge(5)) this.on.gear(sequential(this.gear, 1));
      if (edge(4)) this.on.gear(sequential(this.gear, -1));
    }
    if (edge(3)) this.on.tc();
    this.padButtons = b.map((x) => x.pressed);
  }

  // Once a frame: the pedal positions, 0 to 1, and whether the start key is held. `moving`:
  // the car is rolling, so the clutch key comes up at shift speed rather than launch speed.
  read(dt, moving = false) {
    this.pollPad();
    for (const p of Object.values(this.pedals)) rampPedal(p, dt, this.gentle, moving);
    return {
      thr: pedalPosition(this.pedals.thr),
      brake: pedalPosition(this.pedals.brake),
      clutch: pedalPosition(this.pedals.clutch),
      key: this.startKey || this.startPointer || this.startPad,
    };
  }

  // Any control in use: a demo playing stops when the driver takes over.
  busy() {
    return this.startKey || this.startPointer || this.startPad
      || Object.values(this.pedals).some((p) => p.held || p.pointer !== null || p.pad > 0.05);
  }
}
