(() => {
  const params = new URLSearchParams(window.location.search || "");
  const pathParts = String(window.location.pathname || "")
    .split("/")
    .filter(Boolean);
  const pathPetId = pathParts[0] === "s" ? String(pathParts[1] || "").trim() : "";
  const pathOwnerId = pathParts[0] === "s" ? String(pathParts[2] || "").trim() : "";

  const petId = String(pathPetId || params.get("s") || params.get("scan") || "").trim();
  const ownerId = String(pathOwnerId || params.get("o") || params.get("owner") || "").trim();

  const configuredApiBase = String(window.PETTAG_CONFIG?.API_BASE_URL || "").trim();
  const apiBase = (configuredApiBase || localStorage.getItem("pettag_api_base") || "").trim().replace(/\/$/, "");

  const stateEl = document.getElementById("scanState");
  const petCard = document.getElementById("petCard");
  const shareBtn = document.getElementById("shareBtn");
  let pendingGlobalLoads = 0;

  const e = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const normalizePetPhoto = (value) => {
    const photo = String(value || "").trim();
    if (!photo) return "";

    if (photo.startsWith("data:")) {
      return "";
    }

    const lowerPhoto = photo.toLowerCase();
    const blockedPhotoFragments = [
      "assets/images/logo.png",
      "/assets/images/logo.png",
      "assets/images/horlogo.png",
      "/assets/images/horlogo.png"
    ];

    if (blockedPhotoFragments.some((fragment) => lowerPhoto.includes(fragment))) {
      return "";
    }

    return photo;
  };

  const normalizePetStatus = (value) => {
    const status = String(value || "").trim().toLowerCase();
    if (!status) return "safe";
    if (["lost", "perdida", "perdido", "missing"].includes(status)) return "lost";
    if (["safe", "a salvo", "asalvo", "ok"].includes(status)) return "safe";
    return "safe";
  };

  const getApiUrl = (path) => `${apiBase}${path}`;

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
        <img class="global-loader-logo" src="/assets/images/horlogo.png" alt="PetTag" />
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

  const setState = (message, isError = false) => {
    stateEl.textContent = message;
    stateEl.style.color = isError ? "#9d2f2f" : "";
  };

  const renderPet = (payload) => {
    const pet = payload?.pet || {};
    const owner = pet.owner || {};
    const photo = normalizePetPhoto(pet.photo);
    const hasPhoto = Boolean(photo);
    const status = normalizePetStatus(pet.status);
    const statusLabel = status === "lost" ? "Perdida" : "A salvo";
    const vaccines = Array.isArray(pet.vaccines) ? pet.vaccines.filter(Boolean) : [];
    const allergies = String(pet.allergies || "").trim() || "Sin registro";
    const careNotes = String(pet.careNotes || pet.care_notes || "").trim() || "Sin notas especiales";
    const phoneHtml = status === "lost"
      ? `<p><strong>Telefono:</strong> ${e(owner.phone || "No disponible")}</p>`
      : `<p class="muted">Telefono oculto por privacidad (solo visible cuando la mascota esta perdida).</p>`;
    const photoHtml = hasPhoto
      ? `<img class="pet-photo" src="${e(photo)}" alt="${e(pet.name || "Mascota")}" data-role="pet-photo" />`
      : `<div class="pet-photo is-empty pet-photo-placeholder" aria-label="Sin foto"><span>Sin foto</span></div>`;

    petCard.innerHTML = `
      <div class="card-body">
        <div class="pet-head" style="margin-bottom: 12px;">
          ${photoHtml}
          <div class="pet-copy">
            <h2 style="margin-top: 0; margin-bottom: 2px;">${e(pet.name || "Mascota")}</h2>
            <p class="muted" style="margin: 0;">${e(pet.type || "")} ${pet.breed ? `· ${e(pet.breed)}` : ""}</p>
          </div>
        </div>
        <p><strong>Distrito:</strong> ${e(pet.district || "No definido")}</p>
        <p><strong>Estado:</strong> ${e(statusLabel)}</p>
        <p><strong>Vacunas:</strong> ${vaccines.length ? e(vaccines.join(", ")) : "Sin registro"}</p>
        <p><strong>Alergias:</strong> ${e(allergies)}</p>
        <p><strong>Cuidados:</strong> ${e(careNotes)}</p>
        <hr style="opacity:.2;" />
        <p><strong>Propietario:</strong> ${e(owner.name || "No disponible")}</p>
        ${phoneHtml}
      </div>
    `;

    const photoEl = petCard.querySelector('[data-role="pet-photo"]');
    if (photoEl) {
      photoEl.addEventListener("error", () => {
        photoEl.outerHTML = '<div class="pet-photo is-empty pet-photo-placeholder" aria-label="Sin foto"><span>Sin foto</span></div>';
      }, { once: true });
    }

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
        ownerId: ownerId || null,
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

    beginGlobalLoad();
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
        } finally {
          endGlobalLoad();
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
        } finally {
          endGlobalLoad();
        }
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const boot = async () => {
    if (!petId) {
      setState("QR invalido: falta identificador de mascota.", true);
      return;
    }

    try {
      beginGlobalLoad();
      setState("Cargando informacion de la mascota...");
      const ownerQuery = ownerId ? `?owner=${encodeURIComponent(ownerId)}` : "";
      const response = await fetch(getApiUrl(`/api/public/pets/${encodeURIComponent(petId)}${ownerQuery}`));
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar la mascota.");
      }

      renderPet(data);
      setState("Mascota verificada. Puedes compartir tu ubicacion.");
      shareBtn.disabled = false;
    } catch (error) {
      setState(error.message || "No se pudo cargar el escaneo.", true);
    } finally {
      endGlobalLoad();
    }
  };

  shareBtn.addEventListener("click", shareLocation);
  boot();
})();
