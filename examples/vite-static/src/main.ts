import './style.css';

const counter = document.querySelector<HTMLButtonElement>('#counter');
const count = document.querySelector<HTMLElement>('#count');
const status = document.querySelector<HTMLElement>('#status');
const build = document.querySelector<HTMLElement>('#build');
const host = document.querySelector<HTMLElement>('#host');

let clicks = 0;

counter?.addEventListener('click', () => {
  clicks += 1;
  if (count) count.textContent = String(clicks);
  if (status) {
    status.textContent =
      clicks === 1 ? 'JavaScript respondió: la release está viva.' : `Interacciones: ${clicks}.`;
  }
});

if (build) build.textContent = new Date().toISOString();
if (host) host.textContent = window.location.host || 'local';
