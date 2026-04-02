(() => {
  const modal = document.querySelector("[data-es-confirm-modal]");
  if (!modal) return;

  const titleEl = modal.querySelector("[data-es-confirm-title]");
  const msgEl = modal.querySelector("[data-es-confirm-message]");

  const btnClose = modal.querySelector("[data-es-confirm-close]");
  const btnCancel = modal.querySelector("[data-es-confirm-cancel]");
  const btnOk = modal.querySelector("[data-es-confirm-ok]");

  let pendingForm = null;

  function openModal({ title, message, okText }) {
    if (titleEl) titleEl.textContent = title || "Bestätigen";
    if (msgEl) msgEl.textContent = message || "Möchtest du das wirklich tun?";
    if (btnOk) btnOk.textContent = okText || "Bestätigen";

    modal.classList.remove("hidden");
    modal.classList.add("flex");
    btnOk?.focus();
  }

  function closeModal() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    pendingForm = null;
  }

  document.addEventListener(
    "submit",
    (e) => {
      const form = e.target;
      if (!(form instanceof HTMLFormElement)) return;

      if (!form.hasAttribute("data-es-confirm")) return;

      if (form.__esSkip === true) return;

      e.preventDefault();
      e.stopPropagation();

      pendingForm = form;

      openModal({
        title: form.getAttribute("data-es-title") || "Bestätigen",
        message:
          form.getAttribute("data-es-message") ||
          "Möchtest du das wirklich tun?",
        okText: form.getAttribute("data-es-ok") || "Bestätigen",
      });
    },
    true,
  );

  btnOk?.addEventListener("click", () => {
    if (!pendingForm) return;
    pendingForm.__esSkip = true;
    pendingForm.submit();
    closeModal();
  });

  btnCancel?.addEventListener("click", closeModal);
  btnClose?.addEventListener("click", closeModal);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) closeModal();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) closeModal();
  });
})();
