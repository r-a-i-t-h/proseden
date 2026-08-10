function enhanceForms(): void {
  document.querySelectorAll<HTMLFormElement>("form[data-method]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      const method = (form.dataset.method || "POST").toUpperCase();
      if (method === "POST") return;

      event.preventDefault();
      const action = form.getAttribute("action") || window.location.href;
      const body = new FormData(form);

      // Prefer JSON for non-GET mutations from the sidebar so checkboxes serialize cleanly
      const payload: Record<string, unknown> = {};
      body.forEach((value, key) => {
        payload[key] = value;
      });

      // Explicit visibility for edit forms
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

  // Ensure checkbox visibility is sent on ordinary POST edit/create forms too
  document.querySelectorAll<HTMLFormElement>("form.stack").forEach((form) => {
    form.addEventListener("submit", () => {
      const checkbox = form.querySelector<HTMLInputElement>(
        'input[name="visibility"][type="checkbox"]',
      );
      if (!checkbox) return;
      let hidden = form.querySelector<HTMLInputElement>('input[name="visibility"][type="hidden"]');
      if (!hidden) {
        hidden = document.createElement("input");
        hidden.type = "hidden";
        hidden.name = "visibility";
        form.appendChild(hidden);
      }
      if (checkbox.checked) {
        hidden.value = "public";
        checkbox.disabled = true; // avoid duplicate field names
      } else {
        hidden.value = "private";
      }
    });
  });
}

enhanceForms();
