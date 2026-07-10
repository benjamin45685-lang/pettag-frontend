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
  const SHARE_BTN_DEFAULT = "COMPARTIR MI UBICACION";
  const SHARE_BTN_LOADING = "ENVIANDO UBICACION...";
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

  const buildWhatsAppUrl = (phone) => {
    const digits = String(phone || "").replace(/\D/g, "");
    if (!digits) return "";
    const normalizedDigits = digits.startsWith("51") ? digits : `51${digits}`;
    return `https://wa.me/${normalizedDigits}`;
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

  const setState = (message, isError = false, tone = "info") => {
    stateEl.textContent = message;
    const finalTone = isError ? "danger" : tone;
    stateEl.className = `scan-state state-${finalTone}`;
  };

  const setShareBtnLabel = (loading = false) => {
    shareBtn.textContent = loading ? SHARE_BTN_LOADING : SHARE_BTN_DEFAULT;
  };

  const renderPet = (payload) => {
    const pet = payload?.pet || {};
    const owner = pet.owner || {};
    const photo = normalizePetPhoto(pet.photo);
    const hasPhoto = Boolean(photo);
    const status = normalizePetStatus(pet.status);
    const statusLabel = status === "lost" ? "Perdida" : "A salvo";
    const statusCapsuleLabel = status === "lost" ? "Reporte activo" : "Mascota segura";
    const vaccines = Array.isArray(pet.vaccines) ? pet.vaccines.filter(Boolean) : [];
    const allergies = String(pet.allergies || "").trim() || "Sin registro";
    const careNotes = String(pet.careNotes || pet.care_notes || "").trim() || "Sin notas especiales";
    const vaccinesHtml = vaccines.length
      ? vaccines.map((vaccine) => `<span class="public-chip">${e(vaccine)}</span>`).join("")
      : '<span class="public-chip muted-chip">Sin registro</span>';
    const whatsappUrl = String(payload?.links?.whatsapp || "").trim() || buildWhatsAppUrl(owner.phone);
    const phoneHtml = status === "lost" && whatsappUrl
      ? `<a class="public-owner-phone public-owner-whatsapp" href="${e(whatsappUrl)}" target="_blank" rel="noopener noreferrer" aria-label="Abrir chat de WhatsApp con ${e(owner.name || 'el propietario')}"><img src="/assets/images/WhatsApp.png" alt="WhatsApp" aria-hidden="true" /></a>`
      : `<p class="muted">Telefono oculto por privacidad.</p>`;
    const photoHtml = hasPhoto
      ? `<img class="public-pet-photo" src="${e(photo)}" alt="${e(pet.name || "Mascota")}" data-role="pet-photo" />`
      : `<div class="public-pet-photo is-empty pet-photo-placeholder" aria-label="Sin foto"><span>Sin foto</span></div>`;

    petCard.innerHTML = `
      <div class="public-pet-body">
        <div class="public-pet-header-v2">
          <div class="public-photo-shell">
            ${photoHtml}
            ${status === "lost" ? '<span class="public-photo-badge">PERDIDA</span>' : ""}
          </div>
          <h2 class="public-pet-name">${e(pet.name || "Mascota")}</h2>
          <p class="public-pet-type">${e(pet.type || "Mascota")} ${pet.breed ? `· ${e(pet.breed)}` : ""}</p>
          <span class="public-status-chip ${status}">${e(statusCapsuleLabel)}</span>
        </div>

        <section class="public-section-block">
          <h3 class="public-section-title">Informacion general</h3>
          <div class="public-info-stack">
            <div class="public-info-row compact">
              <p class="public-info-label">Distrito visto:</p>
              <p class="public-info-value align-right">${e(pet.district || "No definido")}</p>
            </div>
          </div>
        </section>

        <section class="public-section-block">
          <h3 class="public-section-title">Datos medicos</h3>
          <div class="public-info-stack">
            <div class="public-info-row blocky">
              <p class="public-info-label">Vacunas:</p>
              <div class="public-chip-row">${vaccinesHtml}</div>
            </div>
            <div class="public-info-row blocky">
              <p class="public-info-label">Alergias:</p>
              <p class="public-info-value">${e(allergies)}</p>
            </div>
            <div class="public-info-row blocky">
              <p class="public-info-label">Cuidados especiales:</p>
              <p class="public-info-value">${e(careNotes)}</p>
            </div>
          </div>
        </section>

        <div class="public-owner-box">
          <h3 class="public-section-title">Informacion de contacto</h3>
          <div class="public-owner-row">
            <div>
              <p class="public-owner-title">Propietario</p>
              <p class="public-owner-name">${e(owner.name || "No disponible")}</p>
            </div>
            <div class="public-owner-contact-wrap">
              ${phoneHtml}
            </div>
          </div>
        </div>
      </div>
    `;

    const photoEl = petCard.querySelector('[data-role="pet-photo"]');
    if (photoEl) {
      photoEl.addEventListener("error", () => {
        photoEl.outerHTML = '<div class="public-pet-photo is-empty pet-photo-placeholder" aria-label="Sin foto"><span>Sin foto</span></div>';
      }, { once: true });
    }

    const headerEl = petCard.querySelector(".public-pet-header-v2");
    if (headerEl) {
      headerEl.insertAdjacentElement("afterend", shareBtn);
    }

    petCard.style.display = "block";
    return status;
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
    setShareBtnLabel(true);

    navigator.geolocation.getCurrentPosition(
      async (position) => {
        try {
          const { latitude, longitude, accuracy } = position.coords;
          await postScan(latitude, longitude, accuracy ?? null, `PublicScan (${(accuracy || 0).toFixed(0)}m)`);
          setState("Ubicacion enviada correctamente. Gracias por ayudar.", false, "success");
        } catch (error) {
          setState(error.message || "No se pudo enviar la ubicacion.", true);
          shareBtn.disabled = false;
          setShareBtnLabel(false);
        } finally {
          endGlobalLoad();
        }
      },
      async () => {
        try {
          await postScan(-12.0464, -77.0428, null, "PublicScan fallback");
          setState("No se pudo leer GPS, se envio una ubicacion aproximada.", false, "danger");
        } catch (error) {
          setState(error.message || "No se pudo enviar la ubicacion.", true);
          shareBtn.disabled = false;
          setShareBtnLabel(false);
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
      setState("Cargando informacion de la mascota...", false, "info");
      const ownerQuery = ownerId ? `?owner=${encodeURIComponent(ownerId)}` : "";
      const response = await fetch(getApiUrl(`/api/public/pets/${encodeURIComponent(petId)}${ownerQuery}`));
      const data = await response.json().catch(() => ({}));

      if (!response.ok) {
        throw new Error(data.error || "No se pudo cargar la mascota.");
      }

      const petStatus = renderPet(data);
      setState("Mascota verificada en el sistema. Puedes compartir tu ubicacion de forma segura.", false, "info");
      shareBtn.disabled = false;
      setShareBtnLabel(false);
    } catch (error) {
      setState(error.message || "No se pudo cargar el escaneo.", true);
    } finally {
      endGlobalLoad();
    }
  };

  setShareBtnLabel(false);
  shareBtn.addEventListener("click", shareLocation);
  boot();
})();
