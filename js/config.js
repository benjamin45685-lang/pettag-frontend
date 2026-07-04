(() => {
  const normalize = (value) => String(value || "").trim().replace(/\/$/, "");
  const isPrivateIpv4Host = (value) => {
    const match = String(value || "").trim().match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (!match) return false;

    const octets = match.slice(1).map((item) => Number(item));
    if (octets.some((item) => Number.isNaN(item) || item < 0 || item > 255)) return false;

    return octets[0] === 10
      || octets[0] === 127
      || (octets[0] === 192 && octets[1] === 168)
      || (octets[0] === 172 && octets[1] >= 16 && octets[1] <= 31);
  };
  // Nombre del servicio backend en Render (sin https ni dominio).
  // Cambialo si tu servicio en Render tiene otro nombre.
  const RENDER_BACKEND_SERVICE = "pettag-backend";

  const hostname = String(window.location.hostname || "").toLowerCase();
  const isLocal = hostname === "localhost" || hostname === "::1" || isPrivateIpv4Host(hostname);
  const isRender = hostname.endsWith(".onrender.com");

  // Permite override manual para pruebas puntuales.
  const manualOverride = normalize(localStorage.getItem("pettag_api_base") || "");

  let apiBase = "";
  if (manualOverride) {
    apiBase = manualOverride;
  } else if (isLocal) {
    // En local usamos ruta relativa y el proxy del dev server hacia BACKEND_URL.
    apiBase = "";
  } else if (isRender && RENDER_BACKEND_SERVICE && !RENDER_BACKEND_SERVICE.startsWith("TU_")) {
    apiBase = `https://${RENDER_BACKEND_SERVICE}.onrender.com`;
  }

  window.PETTAG_CONFIG = {
    API_BASE_URL: normalize(apiBase)
  };
})();
