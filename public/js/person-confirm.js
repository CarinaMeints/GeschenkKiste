(() => {
  const modal = document.querySelector("[data-pc-modal]");
  if (!modal) return;

  const titleEl = modal.querySelector("[data-pc-title]");
  const msgEl = modal.querySelector("[data-pc-message]");

  const btnOk = modal.querySelector("[data-pc-ok]");
  const btnCancel = modal.querySelector("[data-pc-cancel]");
  const btnClose = modal.querySelector("[data-pc-close]");

  let pendingForm = null;

  function openWithForm(form) {
    pendingForm = form;

    const title = form.getAttribute("data-pc-title") || "Bestätigen";
    const message =
      form.getAttribute("data-pc-message") || "Möchtest du das wirklich tun?";
    const okLabel = form.getAttribute("data-pc-ok") || "OK";

    if (titleEl) titleEl.textContent = title;
    if (msgEl) msgEl.textContent = message;

    if (btnOk) btnOk.textContent = okLabel;

    modal.classList.remove("hidden");
    modal.classList.add("flex");
  }

  function close() {
    modal.classList.add("hidden");
    modal.classList.remove("flex");
    pendingForm = null;
  }

  document.addEventListener("submit", (e) => {
    const form = e.target;
    if (!(form instanceof HTMLFormElement)) return;
    if (!form.hasAttribute("data-pc-confirm")) return;

    e.preventDefault();
    openWithForm(form);
  });

  btnOk?.addEventListener("click", () => {
    if (pendingForm) pendingForm.submit();
    close();
  });

  btnCancel?.addEventListener("click", close);
  btnClose?.addEventListener("click", close);

  modal.addEventListener("click", (e) => {
    if (e.target === modal) close();
  });

  document.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && !modal.classList.contains("hidden")) close();
  });
})();
