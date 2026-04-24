(() => {
  const modal = document.querySelector("[data-dc-modal]");
  if (!modal) return;

  const titleEl = modal.querySelector("[data-dc-title]");
  const msgEl = modal.querySelector("[data-dc-message]");
  const btnClose = modal.querySelector("[data-dc-close]");
  const btnCancel = modal.querySelector("[data-dc-cancel]");
  const btnOk = modal.querySelector("[data-dc-ok]");

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

      if (!form.hasAttribute("data-dc-confirm")) return;

      if (form.__dcSkip === true) return;

      e.preventDefault();
      e.stopPropagation();

      pendingForm = form;

      openModal({
        title: form.getAttribute("data-dc-title") || "Löschen bestätigen",
        message:
          form.getAttribute("data-dc-message") ||
          "Möchtest du das wirklich löschen?",
        okText: form.getAttribute("data-dc-ok") || "Ja, löschen",
      });
    },
    true,
  );

  btnOk?.addEventListener("click", () => {
    if (!pendingForm) return;
    pendingForm.__dcSkip = true;
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
