(() => {
  const modal = document.querySelector("[data-ce-modal]");
  if (!modal) return;

  const form = modal.querySelector("[data-ce-form]");
  const btnCancel = modal.querySelector("[data-ce-cancel]");
  const btnClose = modal.querySelector("[data-ce-close]");

  const addGiftCb = modal.querySelector("[data-ce-add-gift]");
  const giftFields = modal.querySelector("[data-ce-gift-fields]");
  const giftSelect = modal.querySelector("[data-ce-gift-select]");

  const ideasWrapEl = modal.querySelector("[data-ce-ideas-wrap]");
  const ideasListEl = modal.querySelector("[data-ce-ideas-list]");
  const ideasCountEl = modal.querySelector("[data-ce-ideas-count]");

  const interestsListEl = modal.querySelector("[data-ce-interests-list]");
  const newInterestNameEl = modal.querySelector("[data-ce-new-interest-name]");
  const newInterestIconEl = modal.querySelector("[data-ce-new-interest-icon]");

  const newTitleEl = modal.querySelector("[data-ce-new-title]");
  const newDescEl = modal.querySelector("[data-ce-new-description]");
  const newLinkEl = modal.querySelector("[data-ce-new-link]");
  const notesEl = modal.querySelector("[data-ce-notes]");

  const newGiftIsPublicEl = modal.querySelector("[data-ce-new-gift-is-public]");
  const newInterestIsPublicEl = modal.querySelector(
    "[data-ce-new-interest-is-public]",
  );

  const errorEl = modal.querySelector("[data-ce-error]");

  let ctx = null;
  let sourceCheckbox = null;
  let giftsLoaded = false;
  let giftsLoadingPromise = null;

  let interestsLoaded = false;
  let interestsLoadingPromise = null;

  const assignmentsCacheByEventId = new Map();
  const assignmentsLoadingPromise = new Map();

  function escapeHtml(s) {
    return String(s || "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

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

  function safeReturnTo(rt) {
    if (typeof rt === "string" && rt.startsWith("/")) return rt;
    return window.location.pathname + window.location.search;
  }

  function setGiftFieldsVisible(visible) {
    if (!giftFields || !addGiftCb) return;
    addGiftCb.checked = !!visible;
    giftFields.classList.toggle("hidden", !visible);
  }

  function resetNewGiftFields() {
    if (newTitleEl) newTitleEl.value = "";
    if (newDescEl) newDescEl.value = "";
    if (newLinkEl) newLinkEl.value = "";

    if (interestsListEl) {
      interestsListEl
        .querySelectorAll('input[type="checkbox"][data-ce-interest-id]')
        .forEach((cb) => {
          cb.checked = false;
        });
    }

    if (newInterestNameEl) newInterestNameEl.value = "";
    if (newInterestIconEl) newInterestIconEl.value = "";

    if (newGiftIsPublicEl) newGiftIsPublicEl.checked = false;
    if (newInterestIsPublicEl) newInterestIsPublicEl.checked = false;
  }

  function postForm(url, body) {
    const f = document.createElement("form");
    f.method = "POST";
    f.action = url;

    for (const [k, v] of Object.entries(body || {})) {
      if (Array.isArray(v)) {
        v.forEach((item) => {
          const input = document.createElement("input");
          input.type = "hidden";
          input.name = k;
          input.value = String(item ?? "");
          f.appendChild(input);
        });
      } else {
        const input = document.createElement("input");
        input.type = "hidden";
        input.name = k;
        input.value = String(v ?? "");
        f.appendChild(input);
      }
    }

    document.body.appendChild(f);
    f.submit();
  }

  function submitMarkComplete(eventId, returnTo) {
    const url = `/events/${encodeURIComponent(eventId)}/complete?returnTo=${encodeURIComponent(returnTo)}`;
    postForm(url, { _method: "PATCH" });
  }

  function submitCompleteWithGift(eventId, returnTo, payload) {
    const url = `/events/${encodeURIComponent(eventId)}/complete-with-gift?returnTo=${encodeURIComponent(returnTo)}`;
    postForm(url, payload);
  }

  function openModal({ eventId, returnTo }, checkbox = null) {
    ctx = {
      eventId,
      returnTo: safeReturnTo(returnTo),
    };
    sourceCheckbox = checkbox;

    clearError();
    form?.reset();

    if (giftFields) giftFields.classList.add("hidden");
    if (addGiftCb) addGiftCb.checked = false;

    resetNewGiftFields();

    if (ideasWrapEl) ideasWrapEl.classList.remove("hidden");

    const cached = assignmentsCacheByEventId.get(eventId);
    if (cached) {
      renderIdeas(cached);
    } else {
      if (ideasListEl)
        ideasListEl.innerHTML =
          '<div class="text-sm text-slate-500">lädt…</div>';
      void loadEventAssignments(eventId);
    }

    modal.classList.remove("hidden");
    modal.classList.add("flex");

    void loadGifts();
    void loadInterests();
    void loadEventAssignments(eventId);
  }

  function closeModal({ revertCheckbox } = { revertCheckbox: true }) {
    modal.classList.add("hidden");
    modal.classList.remove("flex");

    if (revertCheckbox && sourceCheckbox) {
      sourceCheckbox.checked = false;
    }
    sourceCheckbox = null;
    ctx = null;
    clearError();
  }

  async function loadGifts() {
    if (!giftSelect) return;
    if (giftsLoaded) return;
    if (giftsLoadingPromise) return giftsLoadingPromise;

    giftsLoadingPromise = fetch("/api/gifts/options", {
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
        giftsLoadingPromise = null;
      });

    return giftsLoadingPromise;
  }

  async function loadInterests() {
    if (!interestsListEl) return;
    if (interestsLoaded) return;
    if (interestsLoadingPromise) return interestsLoadingPromise;

    interestsLoadingPromise = fetch("/api/interests/options", {
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
                <input type="checkbox" class="h-4 w-4" data-ce-interest-id="${id}">
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
        interestsLoadingPromise = null;
      });

    return interestsLoadingPromise;
  }

  function renderIdeas(assignments = []) {
    if (!ideasListEl) return;

    const all = Array.isArray(assignments) ? assignments : [];
    const ideas = all.filter((a) => a.status === "Idee" && a.gift);

    if (ideasCountEl)
      ideasCountEl.textContent = ideas.length ? String(ideas.length) : "";

    if (!ideas.length) {
      if (ideasWrapEl) ideasWrapEl.classList.add("hidden");
      ideasListEl.innerHTML = "";
      return;
    }

    if (ideasWrapEl) ideasWrapEl.classList.remove("hidden");

    ideasListEl.innerHTML = ideas
      .map((a) => {
        const title = escapeHtml(a.gift.title);
        const notes = escapeHtml(a.notes || "");

        const img = a.gift.imageUrl
          ? `<img src="${escapeHtml(a.gift.imageUrl)}" class="w-10 h-10 rounded object-cover border border-slate-200" alt="">`
          : `<div class="w-10 h-10 rounded border border-slate-200 bg-slate-50 flex items-center justify-center font-bold text-slate-500">🎁</div>`;

        const interestLine =
          a.gift.interests && a.gift.interests.length
            ? `<div class="text-xs text-slate-600 mt-1">${a.gift.interests
                .slice(0, 4)
                .map((i) => `${escapeHtml(i.icon)} ${escapeHtml(i.name)}`)
                .join(" · ")}</div>`
            : "";

        const notesLine = notes
          ? `<div class="text-xs text-slate-500 mt-1">💬 ${notes}</div>`
          : "";

        return `
          <button type="button"
                  class="w-full text-left p-3 rounded-lg border border-slate-200 bg-white hover:bg-slate-50 transition flex gap-3 items-start"
                  data-ce-pick-idea
                  data-gift-id="${escapeHtml(a.gift._id)}"
                  data-notes="${escapeHtml(a.notes || "")}">
            ${img}
            <div class="min-w-0">
              <div class="font-semibold text-slate-800 truncate">${title}</div>
              ${interestLine}
              ${notesLine}
            </div>
          </button>
        `;
      })
      .join("");
  }

  async function loadEventAssignments(eventId) {
    if (!ideasListEl) return;
    if (!eventId) return;

    if (assignmentsCacheByEventId.has(eventId)) {
      renderIdeas(assignmentsCacheByEventId.get(eventId));
      return;
    }

    if (assignmentsLoadingPromise.get(eventId))
      return assignmentsLoadingPromise.get(eventId);

    if (ideasWrapEl) ideasWrapEl.classList.remove("hidden");
    ideasListEl.innerHTML = '<div class="text-sm text-slate-500">lädt…</div>';

    const p = fetch(`/api/events/${encodeURIComponent(eventId)}/assignments`, {
      headers: { Accept: "application/json" },
    })
      .then(async (r) => {
        if (!r.ok) throw new Error(`event assignments failed: ${r.status}`);
        return r.json();
      })
      .then((data) => {
        const all = data?.assignments || [];
        assignmentsCacheByEventId.set(eventId, all);
        renderIdeas(all);
      })
      .catch((err) => {
        console.error(err);
        if (ideasCountEl) ideasCountEl.textContent = "";
        ideasListEl.innerHTML =
          '<div class="text-sm text-slate-500">(Fehler beim Laden der Ideen)</div>';
      })
      .finally(() => {
        assignmentsLoadingPromise.delete(eventId);
      });

    assignmentsLoadingPromise.set(eventId, p);
    return p;
  }

  addGiftCb?.addEventListener("change", () => {
    if (!giftFields) return;
    giftFields.classList.toggle("hidden", !addGiftCb.checked);
    clearError();
  });

  ideasListEl?.addEventListener("click", async (e) => {
    const btn = e.target.closest("[data-ce-pick-idea]");
    if (!btn) return;

    const giftId = btn.getAttribute("data-gift-id");
    const notes = btn.getAttribute("data-notes") || "";
    if (!giftId) return;

    clearError();
    setGiftFieldsVisible(true);

    await loadGifts();

    if (giftSelect) {
      const hasOpt = giftSelect.querySelector(
        `option[value="${CSS.escape(giftId)}"]`,
      );
      if (!hasOpt) {
        const opt = document.createElement("option");
        opt.value = giftId;
        opt.textContent = "(aus Idee übernommen)";
        giftSelect.appendChild(opt);
      }
      giftSelect.value = giftId;
    }

    resetNewGiftFields();

    if (notesEl) notesEl.value = notes;
  });

  form?.addEventListener("submit", (e) => {
    e.preventDefault();
    if (!ctx?.eventId) return;

    clearError();

    const eventId = ctx.eventId;
    const returnTo = ctx.returnTo;

    if (!addGiftCb?.checked) {
      closeModal({ revertCheckbox: false });
      submitMarkComplete(eventId, returnTo);
      return;
    }

    const giftId = (giftSelect?.value || "").trim();
    const newGiftTitle = (newTitleEl?.value || "").trim();

    const newGiftDescription = (newDescEl?.value || "").trim();
    const newGiftLink = (newLinkEl?.value || "").trim();
    const notes = (notesEl?.value || "").trim();

    if (!giftId && !newGiftTitle) {
      showError(
        "Bitte ein Geschenk auswählen ODER ein neues Geschenk anlegen.",
      );
      return;
    }

    if (giftId && newGiftTitle) {
      showError(
        "Bitte entweder vorhandenes Geschenk wählen ODER neues Geschenk ausfüllen (nicht beides).",
      );
      return;
    }

    closeModal({ revertCheckbox: false });

    if (giftId) {
      submitCompleteWithGift(eventId, returnTo, { giftId, notes });
      return;
    }

    const interestIds = interestsListEl
      ? Array.from(
          interestsListEl.querySelectorAll(
            'input[type="checkbox"][data-ce-interest-id]:checked',
          ),
        )
          .map((cb) => cb.getAttribute("data-ce-interest-id"))
          .filter(Boolean)
      : [];

    const newInterestName = (newInterestNameEl?.value || "").trim();
    const newInterestIcon = (newInterestIconEl?.value || "").trim();

    const newGiftIsPublic =
      newGiftIsPublicEl && newGiftIsPublicEl.checked ? "true" : "";
    const newInterestIsPublic =
      newInterestIsPublicEl && newInterestIsPublicEl.checked ? "true" : "";

    const payload = {
      newGiftTitle,
      newGiftDescription,
      newGiftLink,
      notes,
      newInterestName,
      newInterestIcon,
    };

    if (newGiftIsPublic) payload.newGiftIsPublic = "true";
    if (newInterestIsPublic) payload.newInterestIsPublic = "true";

    payload["interestIds[]"] = interestIds;

    submitCompleteWithGift(eventId, returnTo, payload);
  });

  btnCancel?.addEventListener("click", () =>
    closeModal({ revertCheckbox: true }),
  );
  btnClose?.addEventListener("click", () =>
    closeModal({ revertCheckbox: true }),
  );

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal({ revertCheckbox: true });
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) {
      closeModal({ revertCheckbox: true });
    }
  });

  document.addEventListener("change", (e) => {
    const t = e.target;
    if (!(t instanceof HTMLInputElement)) return;
    if (!t.classList.contains("js-complete-event")) return;

    if (!t.checked) return;

    const eventId = t.dataset.eventId;
    const returnTo =
      t.dataset.returnTo || window.location.pathname + window.location.search;

    if (!eventId) {
      console.warn("Missing data-event-id");
      t.checked = false;
      return;
    }

    openModal({ eventId, returnTo }, t);
  });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ce-open]");
    if (!btn) return;

    const eventId = btn.getAttribute("data-event-id");
    const returnTo =
      btn.getAttribute("data-return-to") ||
      window.location.pathname + window.location.search;

    if (!eventId) return;
    openModal({ eventId, returnTo }, null);
  });
})();
