// The gear stick on screen: an H-pattern you drag the knob through.
//
// The knob follows the pointer along the gates (input/stick.js keeps it on them). Pushed far
// enough into a slot it asks for that gear; the simulation decides whether it goes in. If it
// grinds, the knob stops at the synchro, part way into the slot, and shakes until the clutch
// goes down or the revs come to meet it.

import { project, gearAt, positionOf } from '../input/stick.js';

const NS = 'http://www.w3.org/2000/svg';
const LABELS = { '-1': 'R', 1: '1', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6' };
const SYNCHRO = 0.55; // where a grinding knob stops, as a share of the slot

export class Stick {
  // onGear(n): the gear the knob now asks for.
  constructor(svg, onGear) {
    this.svg = svg;
    this.onGear = onGear;
    this.pos = { x: 1.5, y: 0 };
    this.dragging = null;
    this.asked = 0;
    this.draw();

    svg.addEventListener('pointerdown', (e) => {
      this.dragging = e.pointerId;
      svg.setPointerCapture(e.pointerId);
      this.follow(e);
      e.preventDefault();
    });
    svg.addEventListener('pointermove', (e) => { if (e.pointerId === this.dragging) this.follow(e); });
    const up = (e) => { if (e.pointerId === this.dragging) this.dragging = null; };
    svg.addEventListener('pointerup', up);
    svg.addEventListener('pointercancel', up);
  }

  // Screen to gate units and back: four columns across, a slot above and below the rail.
  toGate(e) {
    const r = this.svg.getBoundingClientRect();
    return { x: ((e.clientX - r.left) / r.width) * 4 - 0.5, y: ((e.clientY - r.top) / r.height) * 3 - 1.5 };
  }

  follow(e) {
    const g = this.toGate(e);
    this.pos = project(g.x, g.y);
    const gear = gearAt(this.pos);
    if (gear !== this.asked) {
      this.asked = gear;
      this.onGear(gear);
    }
  }

  // Put the knob in a gear from the keyboard or a controller.
  moveTo(gear) {
    this.asked = gear;
    this.pos = positionOf(gear, this.pos.x);
  }

  draw() {
    const svg = this.svg;
    svg.setAttribute('viewBox', '-0.5 -1.5 4 3');
    const gates = document.createElementNS(NS, 'path');
    gates.setAttribute('d', 'M0 0 H3 M0 -1 V0 M1 -1 V1 M2 -1 V1 M3 -1 V1');
    gates.setAttribute('class', 'gates');
    svg.appendChild(gates);
    for (const [gear, label] of Object.entries(LABELS)) {
      const p = positionOf(Number(gear));
      const t = document.createElementNS(NS, 'text');
      t.setAttribute('x', String(p.x));
      t.setAttribute('y', String(p.y < 0 ? -1.3 : 1.32));
      t.textContent = label;
      svg.appendChild(t);
    }
    this.knob = document.createElementNS(NS, 'circle');
    this.knob.setAttribute('r', '0.2');
    this.knob.setAttribute('class', 'knob');
    svg.appendChild(this.knob);
  }

  // engaged: the gear the box is in; grinding: it refused the one asked for.
  update(engaged, grinding, now) {
    let { x, y } = this.pos;
    if (!this.dragging) {
      // Let go, the knob rests where the box put it: in its gear, or on the rail.
      if (engaged !== 0) ({ x, y } = positionOf(engaged));
      else if (this.asked === 0) y = 0;
    }
    if (grinding && Math.abs(y) > SYNCHRO) {
      y = Math.sign(y) * SYNCHRO + Math.sin(now / 18) * 0.04;
    }
    this.knob.setAttribute('cx', String(x));
    this.knob.setAttribute('cy', String(y));
    this.svg.classList.toggle('grinding', grinding);
  }
}
