(() => {
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const submitBtn = loginForm.querySelector("button[type='submit']");
  const configuredApiBase = String(window.PETTAG_CONFIG?.API_BASE_URL || "").trim();
  const apiBase = (configuredApiBase || localStorage.getItem("pettag_api_base") || "").trim().replace(/\/$/, "");

  if (localStorage.getItem("pettag_token")) {
    window.location.replace("app.html");
    return;
  }

  const setLoading = (loading) => {
    submitBtn.disabled = loading;
    submitBtn.textContent = loading ? "Ingresando..." : "Entrar";
  };

  const getApiUrl = (path) => `${apiBase}${path}`;

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";

    const email = String(loginForm.email.value || "").trim().toLowerCase();
    const password = String(loginForm.password.value || "").trim();

    if (!email || !password) {
      loginError.textContent = "Ingresa correo y contrasena.";
      return;
    }

    try {
      setLoading(true);
      const response = await fetch(getApiUrl("/api/auth/login"), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify({ email, password })
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok || !data.token) {
        loginError.textContent = data.error || "No se pudo iniciar sesion.";
        return;
      }

      localStorage.setItem("pettag_token", data.token);
      window.location.replace("app.html");
      return;
    } catch {
      loginError.textContent = "No se pudo conectar con el backend.";
    } finally {
      setLoading(false);
    }
  });
})();
