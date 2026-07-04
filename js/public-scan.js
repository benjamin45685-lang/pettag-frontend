(() => {
  const params = new URLSearchParams(window.location.search || "");
  const petId = String(params.get("scan") || "").trim();
  const ownerId = String(params.get("owner") || "").trim();

  const configuredApiBase = String(window.PETTAG_CONFIG?.API_BASE_URL || "").trim();
  const apiBase = (configuredApiBase || localStorage.getItem("pettag_api_base") || "").trim().replace(/\/$/, "");

  const stateEl = document.getElementById("scanState");
  const petCard = document.getElementById("petCard");
  const shareBtn = document.getElementById("shareBtn");

  const e = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const getApiUrl = (path) => `${apiBase}${path}`;

  const setState = (message, isError = false) => {
    stateEl.textContent = message;
    stateEl.style.color = isError ? "#9d2f2f" : "";
  };

  const renderPet = (payload) => {
    const pet = payload?.pet || {};
    const owner = pet.owner || {};

    petCard.innerHTML = `
      <div class="card-body">
        <h2 style="margin-top: 0;">${e(pet.name || "Mascota")}</h2>
        <p class="muted">${e(pet.type || "")} ${pet.breed ? `· ${e(pet.breed)}` : ""}</p>
        <p><strong>Distrito:</strong> ${e(pet.district || "No definido")}</p>
        <p><strong>Estado:</strong> ${e(pet.status || "safe")}</p>
        <hr style="opacity:.2;" />
        <p><strong>Propietario:</strong> ${e(owner.name || "No disponible")}</p>
        <p><strong>Telefono:</strong> ${e(owner.phone || "No disponible")}</p>
      </div>
    `;

    petCard.style.display = "block";
  };

  const postScan = async (latitude, longitude, accuracy, device) => {
    const response = await fetch(getApiUrl("/api/public/scans"), {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        petId,
        ownerId,
        latitude,
        longitude,
        accuracy,
        note: null,
        device
      })
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data.error || "No se pudo registrar la ubicacion.");
    }

    return data;
  };

  const shareLocation = () => {
    if (!navigator.geolocation) {
      setState("Este dispositivo no soporta geolocalizacion.", true);
      return;
    }

    shareBtn.disabled = true;
    shareBtn.textContent = "Enviando ubicacion...";

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude, accuracy } = position.coords;
          await postScan(latitude, longitude, accuracy ?? null, `PublicScan (${(accuracy || 0).toFixed(0)}m)`);
          setState("Ubicacion enviada correctamente. Gracias por ayudar.");
        } catch (error) {
          setState(error.message || "No se pudo enviar la ubicacion.", true);
          shareBtn.disabled = false;
          shareBtn.textContent = "Compartir mi ubicacion";
        }
      },
      async () => {
        try {
          await postScan(-12.0464, -77.0428, null, "PublicScan fallback");
          setState("No se pudo leer GPS, se envio una ubicacion aproximada.");
        } catch (error) {
          setState(error.message || "No se pudo enviar la ubicacion.", true);
          shareBtn.disabled = false;
          shareBtn.textContent = "Compartir mi ubicacion";
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const boot = async () => {
    if (!petId || !ownerId) {
      setState("QR invalido: faltan parametros de identificacion.", true);
      return;
    }

    try {
      setState("Cargando informacion de la mascota...");
      const response = await fetch(getApiUrl(`/api/public/pets/${encodeURIComponent(petId)}?owner=${encodeURIComponent(ownerId)}`));
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar la mascota.");
      }

      renderPet(data);
      setState("Mascota verificada. Puedes compartir tu ubicacion.");
      shareBtn.disabled = false;
    } catch (error) {
      setState(error.message || "No se pudo cargar el escaneo.", true);
    }
  };

  shareBtn.addEventListener("click", shareLocation);
  boot();
})();
