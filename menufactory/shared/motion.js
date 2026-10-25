// Less motion / more motion: one setting every look reads, and the visible button that
// changes it. The button is on every page - render.js adds it, so a look cannot leave it out.
//
// The starting level follows the guest's device (prefers-reduced-motion). A choice made with
// the button is remembered in this browser only; nothing is sent anywhere.
//
// Looks read the level from <html data-motion="more|less">, from getMotion(), or by
// listening with onMotionChange().

const KEY = 'motion-level';
let level = 'more';
let started = false;
const buttons = new Set();

function saved() {
  try {
    const value = localStorage.getItem(KEY);
    return value === 'more' || value === 'less' ? value : null;
  } catch {
    return null;
  }
}

function deviceLevel() {
  return matchMedia('(prefers-reduced-motion: reduce)').matches ? 'less' : 'more';
}

function apply() {
  document.documentElement.dataset.motion = level;
  for (const button of buttons) paint(button);
  document.dispatchEvent(new CustomEvent('motionchange', { detail: level }));
}

function paint(button) {
  // The label says what the button will do.
  button.textContent = level === 'more' ? 'Less motion' : 'More motion';
  button.dataset.level = level;
}

export function initMotion() {
  if (started) return level;
  started = true;
  level = saved() ?? deviceLevel();
  matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', () => {
    if (!saved()) {
      level = deviceLevel();
      apply();
    }
  });
  apply();
  return level;
}

export function getMotion() {
  return level;
}

export function setMotion(next) {
  if (next !== 'more' && next !== 'less') throw new Error(`motion level must be more or less, not ${next}`);
  level = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // Private windows and blocked storage: the choice lasts for this page only.
  }
  apply();
}

export function onMotionChange(callback) {
  const listener = (event) => callback(event.detail);
  document.addEventListener('motionchange', listener);
  return () => document.removeEventListener('motionchange', listener);
}

export function mountMotionButton(parent = document.body) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'motion-toggle';
  button.addEventListener('click', () => setMotion(level === 'more' ? 'less' : 'more'));
  buttons.add(button);
  paint(button);
  parent.append(button);
  return button;
}
