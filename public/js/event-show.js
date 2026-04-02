(() => {
  const btn = document.querySelector("[data-share-event]");
  const container = document.getElementById("shareUrlContainer");
  const input = document.getElementById("shareUrl");
  const link = document.getElementById("shareUrlLink");
  const btnCopy = document.querySelector("[data-share-copy]");

  function isHttpUrl(u) {
    try {
      const url = new URL(u);
      return url.protocol === "http:" || url.protocol === "https:";
    } catch {
      return false;
    }
  }

  if (btn) {
    btn.addEventListener("click", async () => {
      const eventId = btn.getAttribute("data-event-id");
      if (!eventId) return;

      try {
        const response = await fetch("/share/event/" + eventId, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
        });

        const data = await response.json();
        if (!data.success) {
          alert(data.error || "Fehler beim Erstellen des Links");
          return;
        }

        if (input) input.value = data.shareUrl;

        if (link) {
          if (isHttpUrl(data.shareUrl)) {
            link.href = data.shareUrl;
            link.rel = "noopener noreferrer";
          } else {
            link.removeAttribute("href");
          }
        }

        if (container) container.classList.remove("hidden");
      } catch (err) {
        console.error(err);
        alert("Fehler beim Erstellen des Links");
      }
    });
  }

  if (btnCopy) {
    btnCopy.addEventListener("click", async () => {
      if (!input) return;
      try {
        input.select();
        await navigator.clipboard.writeText(input.value);
      } catch (e) {
        document.execCommand("copy");
      }
    });
  }
})();
