(() => {
  function toggleById(id, show) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  document.addEventListener("change", (e) => {
    const cb = e.target;
    if (!(cb instanceof HTMLInputElement)) return;
    if (!cb.classList.contains("occ-checkbox")) return;

    const checked = cb.checked;

    toggleById(cb.dataset.rangeTarget, checked);

    const isMovable = cb.dataset.movable === "true";

    if (isMovable) {
      toggleById(cb.dataset.dateTarget, checked);
      toggleById(cb.dataset.target, checked);
    }
  });
})();
