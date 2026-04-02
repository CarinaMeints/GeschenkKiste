(() => {
  const sel = document.getElementById("occasionSelect");
  const wrap = document.getElementById("customDateWrap");
  if (!sel || !wrap) return;

  function updateWrap() {
    const opt = sel.options[sel.selectedIndex];
    const isMovable = opt && opt.dataset && opt.dataset.movable === "true";
    wrap.classList.toggle("hidden", !isMovable);
  }

  sel.addEventListener("change", updateWrap);
  updateWrap();
})();
