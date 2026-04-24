(() => {
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

  const btnReset = $("[data-export-reset]");
  const btnExpand = $("[data-export-expand]");
  const btnCollapse = $("[data-export-collapse]");

  const selPerson = $("[data-export-person]");
  const selOccasion = $("[data-export-occasion]");
  const selInterest = $("[data-export-interest]");
  const selGift = $("[data-export-gift]");
  const selStatus = $("[data-export-status]");
  const selTime = $("[data-export-time]");
  const selYear = $("[data-export-year]");

  const togglePersons = $("[data-export-toggle-persons]");
  const toggleGifts = $("[data-export-toggle-gifts]");
  const toggleOccasions = $("[data-export-toggle-occasions]");

  const sectionPersons = $('[data-export-section="persons"]');
  const sectionGifts = $('[data-export-section="gifts"]');
  const sectionOccasions = $('[data-export-section="occasions"]');
  const emptyPersonsEl = $("[data-export-empty-persons]");

  function parseISODateLocal(iso) {
    const [y, m, d] = String(iso).split("-").map(Number);
    return new Date(y, (m || 1) - 1, d || 1);
  }

  function addMonths(date, months) {
    const d = new Date(date);
    d.setMonth(d.getMonth() + months);
    return d;
  }

  function applySectionToggles() {
    if (sectionPersons)
      sectionPersons.classList.toggle(
        "hidden",
        togglePersons && !togglePersons.checked,
      );
    if (sectionGifts)
      sectionGifts.classList.toggle(
        "hidden",
        toggleGifts && !toggleGifts.checked,
      );
    if (sectionOccasions)
      sectionOccasions.classList.toggle(
        "hidden",
        toggleOccasions && !toggleOccasions.checked,
      );
  }

  function applyFilters() {
    const timeMode = selTime?.value || "all";
    if (selYear) selYear.classList.toggle("hidden", timeMode !== "year");

    const filterPerson = selPerson?.value || "";
    const filterOccasion = selOccasion?.value || "";
    const filterInterest = selInterest?.value || "";
    const filterGift = selGift?.value || "";
    const filterStatus = selStatus?.value || "";
    const filterYear = timeMode === "year" ? selYear?.value || "" : "";

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const until6 = addMonths(today, 6);

    const events = $$("[data-export-event]");
    events.forEach((el) => {
      let ok = true;

      if (filterPerson && el.dataset.personId !== filterPerson) ok = false;
      if (filterOccasion && el.dataset.occasionId !== filterOccasion)
        ok = false;
      if (filterStatus && el.dataset.status !== filterStatus) ok = false;

      if (filterGift) {
        const ids = (el.dataset.giftIds || "").split(",").filter(Boolean);
        if (!ids.includes(filterGift)) ok = false;
      }

      if (filterInterest) {
        const ids = (el.dataset.interestIds || "").split(",").filter(Boolean);
        if (!ids.includes(filterInterest)) ok = false;
      }

      if (timeMode === "year" && filterYear) {
        if (String(el.dataset.year || "") !== String(filterYear)) ok = false;
      }

      if (timeMode === "next6") {
        const d = parseISODateLocal(el.dataset.date);
        if (!(d >= today && d <= until6)) ok = false;
      }

      el.classList.toggle("hidden", !ok);
    });

    const personBlocks = $$("[data-export-person-block]");
    personBlocks.forEach((pb) => {
      const pid = pb.dataset.personId || "";
      const visible = !filterPerson || String(pid) === String(filterPerson);
      pb.classList.toggle("hidden", !visible);
    });

    const anyVisibleEvent = $$("[data-export-event]:not(.hidden)").length > 0;
    if (emptyPersonsEl) {
      emptyPersonsEl.classList.toggle("hidden", anyVisibleEvent);
    }

    const giftCards = $$("[data-export-gift-card]");
    giftCards.forEach((gc) => {
      let ok = true;

      if (filterGift && gc.dataset.giftId !== filterGift) ok = false;

      if (filterInterest) {
        const ids = (gc.dataset.interestIds || "").split(",").filter(Boolean);
        if (!ids.includes(filterInterest)) ok = false;
      }

      gc.classList.toggle("hidden", !ok);
    });

    const occasionCards = $$("[data-export-occasion-card]");
    occasionCards.forEach((oc) => {
      let ok = true;
      if (filterOccasion && oc.dataset.occasionId !== filterOccasion)
        ok = false;
      oc.classList.toggle("hidden", !ok);
    });
  }

  function resetFilters() {
    if (selPerson) selPerson.value = "";
    if (selOccasion) selOccasion.value = "";
    if (selInterest) selInterest.value = "";
    if (selGift) selGift.value = "";
    if (selStatus) selStatus.value = "";
    if (selTime) selTime.value = "all";
    if (selYear) selYear.value = "";

    if (togglePersons) togglePersons.checked = true;
    if (toggleGifts) toggleGifts.checked = true;
    if (toggleOccasions) toggleOccasions.checked = true;

    applySectionToggles();
    applyFilters();
  }

  function setAllDetails(open) {
    $$("[data-export-details]").forEach((d) => {
      d.open = open;
    });
  }

  btnReset?.addEventListener("click", resetFilters);
  btnExpand?.addEventListener("click", () => setAllDetails(true));
  btnCollapse?.addEventListener("click", () => setAllDetails(false));

  [
    selPerson,
    selOccasion,
    selInterest,
    selGift,
    selStatus,
    selTime,
    selYear,
  ].forEach((el) => {
    el?.addEventListener("change", applyFilters);
  });

  [togglePersons, toggleGifts, toggleOccasions].forEach((cb) => {
    cb?.addEventListener("change", () => {
      applySectionToggles();
      applyFilters();
    });
  });

  applySectionToggles();
  applyFilters();
})();
