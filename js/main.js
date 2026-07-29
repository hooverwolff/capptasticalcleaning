// Shared behavior across all pages: the floating booking bubble.
document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('bubbleToggle');
  const panel = document.getElementById('bubblePanel');
  const closeBtn = document.getElementById('bubbleClose');

  if (btn && panel) {
    btn.addEventListener('click', () => panel.classList.toggle('open'));
  }
  if (closeBtn && panel) {
    closeBtn.addEventListener('click', () => panel.classList.remove('open'));
  }
  document.addEventListener('click', (e) => {
    if (!panel || !panel.classList.contains('open')) return;
    if (panel.contains(e.target) || (btn && btn.contains(e.target))) return;
    panel.classList.remove('open');
  });
});
