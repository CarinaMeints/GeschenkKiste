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

    toggleById(cb.dataset.rangeTarget, cb.checked);

    const isMovable = cb.dataset.movable === "true";
    if (isMovable) {
      toggleById(cb.dataset.dateTarget, cb.checked);
    }
  });
})();
