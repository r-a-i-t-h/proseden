function enhanceForms(): void {
  document.querySelectorAll<HTMLFormElement>("form[data-confirm]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      const message = form.dataset.confirm;
      if (message && !window.confirm(message)) {
        event.preventDefault();
        event.stopImmediatePropagation();
      }
    });
  });

  document.querySelectorAll<HTMLFormElement>("form[data-method]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      const method = (form.dataset.method || "POST").toUpperCase();
      if (method === "POST") return;

      event.preventDefault();
      const action = form.getAttribute("action") || window.location.href;
      const body = new FormData(form);

      const payload: Record<string, unknown> = {};
      body.forEach((value, key) => {
        // When hidden+checkbox share a name, keep the last value (checkbox if checked).
        payload[key] = value;
      });

      // Explicit boolean-ish fields for JSON PUT (FormData omits unchecked boxes).
      if (form.querySelector('input[name="visibility"][type="checkbox"]')) {
        const checked = form.querySelector<HTMLInputElement>(
          'input[name="visibility"][type="checkbox"]',
        )?.checked;
        payload.visibility = checked ? "public" : "private";
      }
      if (form.querySelector('input[name="isJunction"][type="checkbox"]')) {
        const checked = form.querySelector<HTMLInputElement>(
          'input[name="isJunction"][type="checkbox"]',
        )?.checked;
        payload.isJunction = !!checked;
      }
      if (form.querySelector('input[name="retainSnapshot"][type="checkbox"]')) {
        const checked = form.querySelector<HTMLInputElement>(
          'input[name="retainSnapshot"][type="checkbox"]',
        )?.checked;
        payload.retainSnapshot = !!checked;
      }

      const response = await fetch(action, {
        method,
        headers: {
          Accept: "application/json, text/html",
          "Content-Type": "application/json",
        },
        body: JSON.stringify(payload),
        redirect: "follow",
      });

      if (response.redirected) {
        window.location.href = response.url;
        return;
      }
      if (response.ok) {
        window.location.reload();
        return;
      }
      const err = await response.json().catch(() => ({ error: response.statusText }));
      alert(err.error || "Request failed");
    });
  });
}

enhanceForms();
