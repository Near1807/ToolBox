// The short flight of a file towards its tile after « Ranger » (or the
// Arrivée counter). Off with the setting « Animations », or when the system
// asks for less motion (prefers-reduced-motion).
export const motionAllowed = (enabled: boolean) =>
  enabled &&
  !(
    typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches
  );

export function fly(
  from: DOMRect | null,
  target: Element | null,
  label: string,
  enabled: boolean,
): void {
  if (!from || !target || !motionAllowed(enabled)) return;
  const to = target.getBoundingClientRect();
  if (!to.width) return;
  const ghost = document.createElement('div');
  ghost.className = 'coffre-fly';
  ghost.textContent = label;
  const size = 120;
  ghost.style.left = `${from.left + from.width / 2 - size / 2}px`;
  ghost.style.top = `${from.top + from.height / 2 - 24}px`;
  ghost.style.width = `${size}px`;
  document.body.appendChild(ghost);
  const dx = to.left + to.width / 2 - (from.left + from.width / 2);
  const dy = to.top + to.height / 2 - (from.top + from.height / 2);
  const flight = ghost.animate(
    [
      { transform: 'translate(0, 0) scale(1)', opacity: 1 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.25)`, opacity: 0.3 },
    ],
    { duration: 520, easing: 'cubic-bezier(0.5, 0, 0.3, 1)' },
  );
  flight.onfinish = () => {
    ghost.remove();
    target.classList.add('coffre-landed');
    setTimeout(() => target.classList.remove('coffre-landed'), 600);
  };
}
