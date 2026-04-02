(() => {
  function onPickInterestClick(e) {
    const btn = e.target.closest("[data-pick-interest-id]");
    if (!btn) return;

    const id = btn.getAttribute("data-pick-interest-id");
    if (!id) return;

    const checkbox = document.querySelector(
      'input[type="checkbox"][name="interests"][value="' + id + '"]',
    );
    if (!checkbox) return;

    checkbox.checked = true;

    const label = checkbox.closest("label");
    if (label) {
      try {
        label.scrollIntoView({ block: "center", behavior: "smooth" });
      } catch (_) {}

      label.classList.add("js-interest-picked");
      window.setTimeout(
        () => label.classList.remove("js-interest-picked"),
        900,
      );
    }
  }

  function toggleById(id, show) {
    if (!id) return;
    const el = document.getElementById(id);
    if (!el) return;
    el.classList.toggle("hidden", !show);
  }

  function onOccasionCheckboxChange(e) {
    const cb = e.target;
    if (!(cb instanceof HTMLInputElement)) return;
    if (!cb.classList.contains("occ-checkbox")) return;

    toggleById(cb.dataset.rangeTarget, cb.checked);
  }

  document.addEventListener("click", onPickInterestClick);
  document.addEventListener("change", onOccasionCheckboxChange);
})();
