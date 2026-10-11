// Everything the driver can press: the keyboard, the on-screen pedals and buttons (mouse or
// fingers, several at once), and a game controller if one is plugged in.
//
//   Up arrow or W        throttle            Down arrow or S    brake
//   Shift (held)         gentler pedals      K or Space (held)  start key
//   P R N D              the lever           Q / E              lever up / down a notch
//   T                    traction control    [ and ]            previous / next engine
//
// A controller with the standard layout: right trigger throttle, left trigger brake, A the
// start key, the bumpers move the lever, Y toggles traction control.

import { createPedal, rampPedal, pedalPosition, dragPosition } from './pedals.js';
import { notch } from './lever.js';

const KEYS = {
  thr: ['ArrowUp', 'KeyW'],
  brake: ['ArrowDown', 'KeyS'],
  start: ['KeyK', 'Space'],
};

export class Controls {
  // elements: { pedals: { thr, brake }, start, lever: { P, R, N, D }, tc }
  // on: { lever(wanted), tc(), cycle(by) } - what the page does when asked
  constructor(elements, on) {
    this.on = on;
    this.pedals = { thr: createPedal('thr'), brake: createPedal('brake') };
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

    for (const [name, el] of Object.entries(elements.pedals)) this.attachPedal(el, this.pedals[name]);
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
    for (const name of ['thr', 'brake']) {
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
      const letter = { KeyP: 'P', KeyR: 'R', KeyN: 'N', KeyD: 'D' }[code];
      if (letter) this.on.lever(letter);
      if (code === 'KeyQ') this.on.lever(notch(this.lever, -1));
      if (code === 'KeyE') this.on.lever(notch(this.lever, 1));
      if (code === 'KeyT') this.on.tc();
      if (code === 'BracketLeft') this.on.cycle(-1);
      if (code === 'BracketRight') this.on.cycle(1);
      handled = handled || Boolean(letter) || ['KeyQ', 'KeyE', 'KeyT'].includes(code);
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
      this.pedals.thr.pad = 0;
      this.pedals.brake.pad = 0;
      this.startPad = false;
      return;
    }
    const b = pad.buttons;
    this.pedals.thr.pad = b[7]?.value ?? 0;
    this.pedals.brake.pad = b[6]?.value ?? 0;
    this.startPad = Boolean(b[0]?.pressed);
    const edge = (i) => b[i]?.pressed && !this.padButtons[i];
    if (edge(5)) this.on.lever(notch(this.lever, 1));
    if (edge(4)) this.on.lever(notch(this.lever, -1));
    if (edge(3)) this.on.tc();
    this.padButtons = b.map((x) => x.pressed);
  }

  // Once a frame: the pedal positions, 0 to 1, and whether the start key is held.
  read(dt) {
    this.pollPad();
    for (const p of Object.values(this.pedals)) rampPedal(p, dt, this.gentle);
    return {
      thr: pedalPosition(this.pedals.thr),
      brake: pedalPosition(this.pedals.brake),
      key: this.startKey || this.startPointer || this.startPad,
    };
  }

  // Any control in use: a demo playing stops when the driver takes over.
  busy() {
    return this.startKey || this.startPointer || this.startPad
      || Object.values(this.pedals).some((p) => p.held || p.pointer !== null || p.pad > 0.05);
  }
}
