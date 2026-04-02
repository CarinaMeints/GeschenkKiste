(() => {
  const monthNames = [
    "Januar",
    "Februar",
    "März",
    "April",
    "Mai",
    "Juni",
    "Juli",
    "August",
    "September",
    "Oktober",
    "November",
    "Dezember",
  ];

  const cache = new Map();

  function escapeHtml(s) {
    return String(s ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
      .replaceAll("'", "&#039;");
  }

  function yyyymmKey(year, monthIndex) {
    const mm = String(monthIndex + 1).padStart(2, "0");
    return `${year}-${mm}`;
  }

  function parseISODateLocal(iso) {
    const [y, m, d] = iso.split("-").map(Number);
    return new Date(y, m - 1, d);
  }

  function toISODateLocal(d) {
    const yyyy = d.getFullYear();
    const mm = String(d.getMonth() + 1).padStart(2, "0");
    const dd = String(d.getDate()).padStart(2, "0");
    return `${yyyy}-${mm}-${dd}`;
  }

  function addDays(date, days) {
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d;
  }

  function badgeClass(state) {
    if (state === "done") return "cal-badge badge-done";
    if (state === "planning") return "cal-badge badge-planning";
    return "cal-badge badge-no-gift";
  }

  function initCalendar(root) {
    const gridEl = root.querySelector("[data-cal-grid]");
    const titleEl = root.querySelector("[data-cal-title]");
    if (!gridEl || !titleEl) return;

    const apiUrl = root.dataset.calApi || "/api/calendar/month";
    const returnTo = root.dataset.returnTo || "/events/calendar";

    const prevBtn = root.querySelector("[data-cal-prev]");
    const nextBtn = root.querySelector("[data-cal-next]");
    const todayBtn = root.querySelector("[data-cal-today]");

    const modalEl = root.querySelector("[data-cal-modal]");
    const modalTitleEl = root.querySelector("[data-cal-modal-title]");
    const modalContentEl = root.querySelector("[data-cal-modal-content]");
    const modalCloseBtn = root.querySelector("[data-cal-modal-close]");

    let currentDate = new Date();

    async function loadMonth(year, monthIndex) {
      const key = yyyymmKey(year, monthIndex);
      if (cache.has(key)) return cache.get(key);

      const month = monthIndex + 1;
      const url = `${apiUrl}?year=${encodeURIComponent(year)}&month=${encodeURIComponent(month)}`;

      const res = await fetch(url, { headers: { Accept: "application/json" } });
      if (!res.ok) {
        throw new Error(`Calendar API error: ${res.status}`);
      }

      const data = await res.json();
      cache.set(key, data);
      return data;
    }

    function groupEventsByDate(events) {
      const map = new Map();
      for (const ev of events) {
        const iso = toISODateLocal(new Date(ev.date));
        if (!map.has(iso)) map.set(iso, []);
        map.get(iso).push(ev);
      }
      return map;
    }

    function openModal(dateStr, events) {
      if (!modalEl || !modalTitleEl || !modalContentEl) return;

      const date = parseISODateLocal(dateStr);
      modalTitleEl.textContent = date.toLocaleDateString("de-DE", {
        weekday: "long",
        day: "2-digit",
        month: "long",
        year: "numeric",
      });

      const statusLabel = (s) =>
        s === "done"
          ? "abgeschlossen"
          : s === "planning"
            ? "in Planung"
            : "kein Geschenk";

      modalContentEl.innerHTML = (events || [])
        .map((ev) => {
          const iconRaw = ev?.personOccasion?.occasion?.icon ?? "";
          const occRaw = ev?.personOccasion?.occasion?.name ?? "Anlass";
          const personRaw = ev?.personOccasion?.person?.name ?? "Unbekannt";

          const personId = ev?.personOccasion?.person?._id ?? "";
          const eventId = ev?._id ?? "";

          const icon = escapeHtml(iconRaw);
          const occ = escapeHtml(occRaw);
          const person = escapeHtml(personRaw);

          const personIdEnc = encodeURIComponent(String(personId));
          const eventIdEnc = encodeURIComponent(String(eventId));
          const returnToEnc = encodeURIComponent(returnTo);

          return `
          <div class="mb-3 p-4 bg-gray-50 rounded-lg border border-gray-200">
            <div class="font-semibold truncate">
              ${icon} ${occ} – ${person}
            </div>

            <div class="mt-1 inline-block ${badgeClass(ev.giftState)}">
              ${escapeHtml(statusLabel(ev.giftState))}
            </div>

            <div class="mt-3 flex gap-3 text-sm">
              <a class="app-link" href="/events/${eventIdEnc}?returnTo=${returnToEnc}">Event →</a>
              <a class="app-link" href="/persons/${personIdEnc}">Person →</a>
            </div>
          </div>
        `;
        })
        .join("");

      modalEl.classList.remove("hidden");
      modalEl.classList.add("flex");
    }

    function closeModal() {
      if (!modalEl) return;
      modalEl.classList.add("hidden");
      modalEl.classList.remove("flex");
    }

    async function render() {
      const year = currentDate.getFullYear();
      const monthIndex = currentDate.getMonth();

      titleEl.textContent = `${monthNames[monthIndex]} ${year}`;
      gridEl.innerHTML = "";

      let data;
      try {
        data = await loadMonth(year, monthIndex);
      } catch (err) {
        console.error(err);
        gridEl.innerHTML = `<div class="col-span-7 text-white/90 text-sm">Kalender konnte nicht geladen werden.</div>`;
        return;
      }

      const rangeStart = parseISODateLocal(data.rangeStart);
      const rangeEnd = parseISODateLocal(data.rangeEnd);
      const byDate = groupEventsByDate(data.events || []);

      let cursor = new Date(rangeStart);
      const today = new Date();
      today.setHours(0, 0, 0, 0);

      while (cursor <= rangeEnd) {
        const iso = toISODateLocal(cursor);
        const inCurrentMonth = cursor.getMonth() === monthIndex;

        const isToday =
          new Date(cursor).setHours(0, 0, 0, 0) === today.getTime();
        const dayEvents = byDate.get(iso) || [];

        const cell = document.createElement("div");
        cell.className = inCurrentMonth ? "cal-cell" : "cal-cell-outside";
        if (isToday) cell.classList.add("cal-cell-today");
        if (dayEvents.length) cell.classList.add("cursor-pointer");

        const badges = dayEvents
          .slice(0, 3)
          .map((ev) => {
            const iconRaw = ev?.personOccasion?.occasion?.icon ?? "";
            const nameRaw = ev?.personOccasion?.person?.name ?? "Unbekannt";
            const icon = escapeHtml(iconRaw);
            const name = escapeHtml(nameRaw);
            return `<div class="${badgeClass(ev.giftState)}">${icon} ${name}</div>`;
          })
          .join("");

        const more =
          dayEvents.length > 3
            ? `<div class="text-[11px] text-white/80 mt-1 font-semibold">+${dayEvents.length - 3} mehr</div>`
            : "";

        cell.innerHTML = `<div class="cal-day-number">${cursor.getDate()}</div>${badges}${more}`;

        if (dayEvents.length) {
          cell.addEventListener("click", () => openModal(iso, dayEvents));
        }

        gridEl.appendChild(cell);
        cursor = addDays(cursor, 1);
      }
    }

    prevBtn?.addEventListener("click", async () => {
      currentDate.setMonth(currentDate.getMonth() - 1);
      await render();
    });

    nextBtn?.addEventListener("click", async () => {
      currentDate.setMonth(currentDate.getMonth() + 1);
      await render();
    });

    todayBtn?.addEventListener("click", async () => {
      currentDate = new Date();
      await render();
    });

    modalEl?.addEventListener("click", (e) => {
      if (e.target === modalEl) closeModal();
    });
    modalCloseBtn?.addEventListener("click", closeModal);

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") closeModal();
    });

    render();
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-calendar]").forEach(initCalendar);
  });
})();
