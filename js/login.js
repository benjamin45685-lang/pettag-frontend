(() => {
  const loginForm = document.getElementById("loginForm");
  const loginError = document.getElementById("loginError");
  const authSubtitle = document.getElementById("authSubtitle");
  const modeButtons = Array.from(document.querySelectorAll("[data-auth-mode]"));
  const registerOnlyFields = Array.from(document.querySelectorAll("[data-register-only]"));
  const submitBtn = loginForm.querySelector("button[type='submit']");
  const configuredApiBase = String(window.PETTAG_CONFIG?.API_BASE_URL || "").trim();
  const apiBase = (configuredApiBase || localStorage.getItem("pettag_api_base") || "").trim().replace(/\/$/, "");
  const REQUEST_TIMEOUT_MS = 15000;
  let authMode = "login";
  let pendingGlobalLoads = 0;

  if (localStorage.getItem("pettag_token")) {
    window.location.replace("app.html");
    return;
  }

  const ensureGlobalLoader = () => {
    let loader = document.getElementById("globalLoader");
    if (loader) return loader;

    loader = document.createElement("div");
    loader.id = "globalLoader";
    loader.className = "global-loader";
    loader.style.display = "none";
    loader.setAttribute("role", "status");
    loader.setAttribute("aria-live", "polite");
    loader.setAttribute("aria-label", "Cargando contenido");
    loader.innerHTML = `
      <div class="global-loader-card">
        <img class="global-loader-logo" src="assets/images/horlogo.png" alt="PetTag" />
        <div class="global-loader-spinner" aria-hidden="true"></div>
        <div class="global-loader-text">Sincronizando informacion...</div>
      </div>
    `;
    document.body.appendChild(loader);
    return loader;
  };

  const beginGlobalLoad = () => {
    pendingGlobalLoads += 1;
    const loader = ensureGlobalLoader();
    loader.style.display = "grid";
  };

  const endGlobalLoad = () => {
    pendingGlobalLoads = Math.max(0, pendingGlobalLoads - 1);
    const loader = ensureGlobalLoader();
    loader.style.display = pendingGlobalLoads > 0 ? "grid" : "none";
  };

  const setLoading = (loading) => {
    submitBtn.disabled = loading;
    if (loading) {
      submitBtn.textContent = authMode === "register" ? "Creando cuenta..." : "Ingresando...";
      return;
    }

    submitBtn.textContent = authMode === "register" ? "Crear cuenta" : "Entrar";
  };

  const getApiUrl = (path) => `${apiBase}${path}`;

  const setMode = (nextMode) => {
    authMode = nextMode === "register" ? "register" : "login";

    modeButtons.forEach((button) => {
      const active = button.dataset.authMode === authMode;
      button.classList.toggle("active", active);
      button.setAttribute("aria-pressed", String(active));
    });

    registerOnlyFields.forEach((container) => {
      container.classList.toggle("hidden", authMode !== "register");
      const input = container.querySelector("input");
      if (input) {
        input.required = authMode === "register";
      }
    });

    loginForm.password.autocomplete = authMode === "register" ? "new-password" : "current-password";
    if (authSubtitle) {
      authSubtitle.textContent = authMode === "register"
        ? "Crea tu cuenta para solicitar acceso y registrar tus mascotas."
        : "Ingresa para administrar tus placas QR y el monitoreo GPS.";
    }

    setLoading(false);
    loginError.textContent = "";
  };

  modeButtons.forEach((button) => {
    button.addEventListener("click", () => {
      setMode(button.dataset.authMode || "login");
    });
  });

  setMode("login");

  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    loginError.textContent = "";

    const email = String(loginForm.email.value || "").trim().toLowerCase();
    const password = String(loginForm.password.value || "").trim();
    const confirmPassword = String(loginForm.confirmPassword?.value || "").trim();
    const name = String(loginForm.name?.value || "").trim();
    const phone = String(loginForm.phone?.value || "").trim();
    const district = String(loginForm.district?.value || "").trim();

    if (!email || !password) {
      loginError.textContent = "Ingresa correo y contrasena.";
      return;
    }

    if (authMode === "register" && (!name || !phone || !district)) {
      loginError.textContent = "Completa nombre, telefono y distrito para registrarte.";
      return;
    }

    if (authMode === "register" && password.length < 6) {
      loginError.textContent = "La contrasena debe tener al menos 6 caracteres.";
      return;
    }

    if (authMode === "register" && password !== confirmPassword) {
      loginError.textContent = "Las contrasenas no coinciden.";
      return;
    }

    try {
      setLoading(true);
      beginGlobalLoad();
      const endpoint = authMode === "register" ? "/api/auth/register" : "/api/auth/login";
      const payload = authMode === "register"
        ? { name, email, password, phone, district }
        : { email, password };

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

      const response = await fetch(getApiUrl(endpoint), {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(payload),
        signal: controller.signal
      }).finally(() => {
        clearTimeout(timeoutId);
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        loginError.textContent = data.error || "No se pudo iniciar sesion.";
        return;
      }

      if (authMode === "register") {
        loginError.style.color = "#1f7a3a";
        loginError.textContent = "Cuenta creada. Un administrador debe aprobar tu acceso antes de ingresar.";
        loginForm.password.value = "";
        if (loginForm.confirmPassword) {
          loginForm.confirmPassword.value = "";
        }
        setMode("login");
        return;
      }

      if (!data.token) {
        loginError.textContent = "No se pudo iniciar sesion.";
        return;
      }

      localStorage.setItem("pettag_token", data.token);
      window.location.replace("app.html");
      return;
    } catch (error) {
      if (error?.name === "AbortError") {
        loginError.textContent = "La conexion tardo demasiado. Revisa API/Internet e intenta de nuevo.";
      } else {
        loginError.textContent = "No se pudo conectar con el backend.";
      }
    } finally {
      endGlobalLoad();
      if (!loginError.textContent || authMode === "login") {
        loginError.style.color = "";
      }
      setLoading(false);
    }
  });
})();
