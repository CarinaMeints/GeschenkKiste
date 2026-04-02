(() => {
  function closeAll() {
    document.querySelectorAll("[data-icon-panel]").forEach((p) => {
      p.classList.add("hidden");
      p.classList.remove("flex");
    });
  }

  function init(root) {
    const input = root.querySelector("[data-icon-input]");
    const btnOpen = root.querySelector("[data-icon-open]");
    const btnClose = root.querySelector("[data-icon-close]");
    const panel = root.querySelector("[data-icon-panel]");
    const picker = root.querySelector("emoji-picker");

    if (!input || !btnOpen || !panel || !picker) return;

    function open() {
      closeAll();
      panel.classList.remove("hidden");
      panel.classList.add("flex");
    }
    function close() {
      panel.classList.add("hidden");
      panel.classList.remove("flex");
    }

    btnOpen.addEventListener("click", (e) => {
      e.preventDefault();
      e.stopPropagation();
      open();
    });

    btnClose?.addEventListener("click", (e) => {
      e.preventDefault();
      close();
    });

    picker.addEventListener("emoji-click", (event) => {
      const emoji = event?.detail?.unicode;
      if (!emoji) return;
      input.value = emoji;
      close();
    });

    panel.addEventListener("click", (e) => {
      if (e.target === panel) close();
    });

    document.addEventListener("keydown", (e) => {
      if (e.key === "Escape") close();
    });
  }

  document.addEventListener("DOMContentLoaded", () => {
    document.querySelectorAll("[data-icon-picker]").forEach(init);
  });
})();
