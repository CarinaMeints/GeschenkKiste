document.addEventListener("DOMContentLoaded", () => {
  const modal = document.querySelector("[data-ph-modal]");
  const btnOpen = document.querySelector("[data-ph-open]");
  const btnClose = document.querySelector("[data-ph-close]");
  const btnCancel = document.querySelector("[data-ph-cancel]");
  if (!modal || !btnOpen) return;

  const form = modal.querySelector("[data-ph-form]");
  if (!form) return;

  const occasionSelect = form.querySelector("[data-ph-occasion]");
  const freeWrap = form.querySelector("[data-ph-date-free-wrap]");
  const freeDateEl = form.querySelector("[data-ph-date-free]");
  const fixedWrap = form.querySelector("[data-ph-date-fixed-wrap]");
  const fixedLabelEl = form.querySelector("[data-ph-fixed-label]");
  const yearEl = form.querySelector("[data-ph-year]");
  const finalDateEl = form.querySelector("[data-ph-date-final]");
  const dateHintEl = form.querySelector("[data-ph-date-hint]");
  const submitBtn = form.querySelector("[data-ph-submit]");

  const giftSelect = form.querySelector("[data-ph-gift-select]");
  const errorEl = form.querySelector("[data-ph-error]");

  const interestsListEl = form.querySelector("[data-ph-interests-list]");
  const newInterestNameEl = form.querySelector("[data-ph-new-interest-name]");
  const newInterestIconEl = form.querySelector("[data-ph-new-interest-icon]");

  const newGiftIsPublicEl = form.querySelector('input[name="newGiftIsPublic"]');
  const newInterestIsPublicEl = form.querySelector(
    'input[name="newInterestIsPublic"]',
  );

  let giftsLoaded = false;
  let giftsLoading = null;

  let interestsLoaded = false;
  let interestsLoading = null;

  function showError(msg) {
    if (!errorEl) return;
    errorEl.textContent = msg;
    errorEl.classList.remove("hidden");
  }

  function clearError() {
    if (!errorEl) return;
    errorEl.textContent = "";
    errorEl.classList.add("hidden");
  }

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function pad2(n) {
    return String(n).padStart(2, "0");
  }

  function buildISODate(y, m, d) {
    if (!y || !m || !d) return "";
    return `${String(y).padStart(4, "0")}-${pad2(m)}-${pad2(d)}`;
  }

  function showDateHint(msg) {
    if (!dateHintEl) return;
    if (!msg) {
      dateHintEl.textContent = "";
      dateHintEl.classList.add("hidden");
      return;
    }
    dateHintEl.textContent = msg;
    dateHintEl.classList.remove("hidden");
  }

  function setSubmitEnabled(enabled) {
    if (!submitBtn) return;
    submitBtn.disabled = !enabled;
    submitBtn.classList.toggle("opacity-60", !enabled);
    submitBtn.classList.toggle("cursor-not-allowed", !enabled);
  }

  function getSelectedOccasionMeta() {
    const opt = occasionSelect?.selectedOptions?.[0];
    if (!opt) return { isSelected: false };

    const isBirthday = opt.dataset.isBirthday === "true";

    let day = opt.dataset.day ? parseInt(opt.dataset.day, 10) : null;
    let month = opt.dataset.month ? parseInt(opt.dataset.month, 10) : null;

    if (isBirthday) {
      const bd = form.dataset.phBdayDay
        ? parseInt(form.dataset.phBdayDay, 10)
        : null;
      const bm = form.dataset.phBdayMonth
        ? parseInt(form.dataset.phBdayMonth, 10)
        : null;
      day = bd;
      month = bm;
    }

    const hasFixed = day != null && month != null;

    return {
      isSelected: !!opt.value,
      isBirthday,
      hasFixed,
      day,
      month,
    };
  }

  function updateFinalDateFromFree() {
    const v = (freeDateEl?.value || "").trim();
    if (finalDateEl) finalDateEl.value = v;
  }

  function updateFinalDateFromFixed() {
    const { day, month } = getSelectedOccasionMeta();
    const y = (yearEl?.value || "").trim();

    const yyyy = y ? parseInt(y, 10) : null;
    if (!yyyy || !day || !month) {
      if (finalDateEl) finalDateEl.value = "";
      return;
    }

    if (finalDateEl) finalDateEl.value = buildISODate(yyyy, month, day);
  }

  function syncDateUI() {
    const meta = getSelectedOccasionMeta();

    if (!meta.isSelected) {
      freeWrap?.classList.remove("hidden");
      fixedWrap?.classList.add("hidden");
      showDateHint("Bitte zuerst einen Anlass auswählen.");
      setSubmitEnabled(false);
      if (finalDateEl) finalDateEl.value = "";
      return;
    }

    if (meta.hasFixed) {
      freeWrap?.classList.add("hidden");
      fixedWrap?.classList.remove("hidden");

      if (fixedLabelEl) fixedLabelEl.textContent = `${meta.day}.${meta.month}.`;

      let yearToUse = new Date().getFullYear();

      const currentFinal = (finalDateEl?.value || "").trim();
      if (currentFinal && /^\d{4}-\d{2}-\d{2}$/.test(currentFinal)) {
        yearToUse = parseInt(currentFinal.slice(0, 4), 10);
      } else if (
        freeDateEl?.value &&
        /^\d{4}-\d{2}-\d{2}$/.test(freeDateEl.value)
      ) {
        yearToUse = parseInt(freeDateEl.value.slice(0, 4), 10);
      }

      if (yearEl && !yearEl.value) yearEl.value = String(yearToUse);

      updateFinalDateFromFixed();

      if (!yearEl?.value) {
        showDateHint("Bitte Jahr ergänzen.");
        setSubmitEnabled(false);
      } else {
        showDateHint("");
        setSubmitEnabled(true);
      }
      return;
    }

    fixedWrap?.classList.add("hidden");
    freeWrap?.classList.remove("hidden");

    updateFinalDateFromFree();

    if (!freeDateEl?.value) {
      showDateHint("Bitte ein Datum auswählen.");
      setSubmitEnabled(false);
    } else {
      showDateHint("");
      setSubmitEnabled(true);
    }
  }

  function resetPublicCheckboxes() {
    if (newGiftIsPublicEl) newGiftIsPublicEl.checked = false;
    if (newInterestIsPublicEl) newInterestIsPublicEl.checked = false;
  }

  function resetInterestSelection() {
    if (!interestsListEl) return;
    interestsListEl
      .querySelectorAll('input[type="checkbox"][name="interestIds[]"]')
      .forEach((cb) => {
        cb.checked = false;
      });
  }

  function resetGiftSelect() {
    if (giftSelect) giftSelect.value = "";
  }

  function show() {
    clearError();
    showDateHint("");

    modal.classList.remove("hidden");
    modal.classList.add("flex");

    void loadGifts();
    void loadInterests();

    if (finalDateEl) finalDateEl.value = "";
    if (freeDateEl) freeDateEl.value = "";
    if (yearEl) yearEl.value = "";
    if (occasionSelect) occasionSelect.value = "";

    resetGiftSelect();
    resetInterestSelection();

    if (newInterestNameEl) newInterestNameEl.value = "";
    if (newInterestIconEl) newInterestIconEl.value = "";
    resetPublicCheckboxes();

    syncDateUI();
  }

  function hide() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    clearError();
    showDateHint("");
  }

  async function loadGifts() {
    if (!giftSelect) return;
    if (giftsLoaded) return;
    if (giftsLoading) return giftsLoading;

    giftsLoading = fetch("/api/gifts/options", {
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`gifts options failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const gifts = data?.gifts || [];
        giftSelect.innerHTML =
          '<option value="">– auswählen –</option>' +
          gifts
            .map(
              (g) =>
                `<option value="${escapeHtml(g._id)}">${escapeHtml(g.title)}</option>`,
            )
            .join("");
        giftsLoaded = true;
      })
      .catch((err) => {
        console.error(err);
        giftSelect.innerHTML = '<option value="">(Fehler beim Laden)</option>';
      })
      .finally(() => {
        giftsLoading = null;
      });

    return giftsLoading;
  }

  async function loadInterests() {
    if (!interestsListEl) return;
    if (interestsLoaded) return;
    if (interestsLoading) return interestsLoading;

    interestsLoading = fetch("/api/interests/options", {
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`interests options failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const interests = data?.interests || [];

        interestsListEl.innerHTML = interests
          .map((i) => {
            const id = escapeHtml(i._id);
            const label = `${i.icon || "🎁"} ${i.name || ""}`.trim();

            return `
            <label class="flex items-center gap-2 p-2 rounded hover:bg-white transition cursor-pointer">
              <input type="checkbox" class="h-4 w-4" name="interestIds[]" value="${id}">
              <span class="text-sm font-semibold text-slate-700">${escapeHtml(label)}</span>
            </label>
          `;
          })
          .join("");

        if (!interests.length) {
          interestsListEl.innerHTML =
            '<div class="text-sm text-slate-500">Keine Interessen vorhanden.</div>';
        }

        interestsLoaded = true;
      })
      .catch((err) => {
        console.error(err);
        interestsListEl.innerHTML =
          '<div class="text-sm text-slate-500">(Fehler beim Laden)</div>';
      })
      .finally(() => {
        interestsLoading = null;
      });

    return interestsLoading;
  }

  btnOpen.addEventListener("click", show);
  btnClose?.addEventListener("click", hide);
  btnCancel?.addEventListener("click", hide);

  occasionSelect?.addEventListener("change", () => {
    if (yearEl) yearEl.value = "";
    syncDateUI();
  });

  freeDateEl?.addEventListener("change", () => {
    updateFinalDateFromFree();
    syncDateUI();
  });

  yearEl?.addEventListener("input", () => {
    updateFinalDateFromFixed();
    syncDateUI();
  });

  modal.addEventListener("click", (e) => {
    if (e.target === modal) hide();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) hide();
  });

  form.addEventListener("submit", (e) => {
    clearError();

    syncDateUI();
    const finalDate = String(finalDateEl?.value || "").trim();
    if (!finalDate) {
      e.preventDefault();
      showDateHint("Bitte Datum vollständig angeben.");
      return;
    }

    const fd = new FormData(form);
    const giftId = String(fd.get("giftId") || "").trim();
    const newTitle = String(fd.get("newGiftTitle") || "").trim();

    if (!giftId && !newTitle) {
      e.preventDefault();
      showError(
        "Bitte ein Geschenk auswählen ODER ein neues Geschenk anlegen.",
      );
      return;
    }
    if (giftId && newTitle) {
      e.preventDefault();
      showError(
        "Bitte entweder vorhandenes Geschenk wählen ODER neues Geschenk ausfüllen (nicht beides).",
      );
      return;
    }
  });
});
