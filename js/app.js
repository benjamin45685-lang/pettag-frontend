(() => {
  const token = localStorage.getItem("pettag_token") || "";
  const configuredApiBase = String(window.PETTAG_CONFIG?.API_BASE_URL || "").trim();
  const apiBase = (configuredApiBase || localStorage.getItem("pettag_api_base") || "").trim().replace(/\/$/, "");

  if (!token) {
    window.location.replace("login.html");
    return;
  }

  const state = {
    token,
    apiBase,
    currentView: "owner-dashboard",
    activeTab: "pets",
    sidebarOpen: false,
    loading: true,
    currentUser: null,
    isEditingOwner: false,
    editingPetId: null,
    map: null,
    markers: [],
    currentMapCenter: null,
    notification: null,
    gpsLoading: false,
    ownerProfile: {
      name: "",
      phone: "",
      email: "",
      district: ""
    },
    tempOwnerProfile: {},
    newPet: {
      name: "",
      type: "Perro",
      breed: "",
      photo: "",
      district: "Miraflores",
      vaccines: "",
      allergies: "",
      careNotes: ""
    },
    tempPetEdit: {},
    pets: [],
    scans: [],
    selectedPetId: ""
  };

  const app = document.getElementById("app");
  const e = (value) => String(value ?? "").replace(/[&<>\"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;"
  }[char]));

  const resetSession = () => {
    localStorage.removeItem("pettag_token");
    window.location.replace("login.html");
  };

  const getApiUrl = (path) => `${state.apiBase}${path}`;

  const request = async (path, options = {}) => {
    const response = await fetch(getApiUrl(path), {
      method: options.method || "GET",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${state.token}`,
        ...(options.headers || {})
      },
      body: options.body ? JSON.stringify(options.body) : undefined
    });

    const data = await response.json().catch(() => ({}));
    if (response.status === 401) {
      resetSession();
      throw new Error("Sesion expirada.");
    }

    if (!response.ok) {
      throw new Error(data.error || "No se pudo completar la solicitud.");
    }

    return data;
  };

  const normalizePet = (pet) => ({
    id: String(pet.id || "").trim(),
    name: String(pet.name || "").trim(),
    type: String(pet.type || "").trim(),
    breed: String(pet.breed || "").trim(),
    photo: String(pet.photo || "").trim(),
    district: String(pet.district || "").trim(),
    vaccines: Array.isArray(pet.vaccines) ? pet.vaccines : [],
    allergies: String(pet.allergies || "").trim(),
    careNotes: String(pet.care_notes || pet.careNotes || "").trim(),
    status: String(pet.status || "safe").trim() || "safe"
  });

  const hydrateDashboard = (payload) => {
    state.currentUser = payload.user || null;
    state.ownerProfile = {
      name: payload.profile?.name || "",
      phone: payload.profile?.phone || "",
      email: payload.profile?.email || payload.user?.email || "",
      district: payload.profile?.district || ""
    };
    state.tempOwnerProfile = { ...state.ownerProfile };
    state.pets = Array.isArray(payload.pets) ? payload.pets.map(normalizePet) : [];
    state.scans = Array.isArray(payload.scans) ? payload.scans : [];

    if (!state.selectedPetId || !state.pets.some((pet) => pet.id === state.selectedPetId)) {
      state.selectedPetId = state.pets[0]?.id || "";
    }
  };

  const loadDashboard = async () => {
    try {
      state.loading = true;
      render();
      const data = await request("/api/auth/me");
      hydrateDashboard(data);
    } catch (error) {
      notify(error.message || "No se pudo cargar el dashboard.", "error");
    } finally {
      state.loading = false;
      render();
    }
  };

  const placeholderPhoto = (name, type) => {
    const text = encodeURIComponent(`${name} ${type}`);
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='240' height='240'>
      <defs>
        <linearGradient id='g' x1='0' x2='1' y1='0' y2='1'>
          <stop offset='0%' stop-color='#abc28a'/>
          <stop offset='100%' stop-color='#5c7d46'/>
        </linearGradient>
      </defs>
      <rect width='100%' height='100%' fill='url(#g)'/>
      <text x='50%' y='46%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI' font-size='26' fill='white'>PetTag</text>
      <text x='50%' y='63%' dominant-baseline='middle' text-anchor='middle' font-family='Segoe UI' font-size='16' fill='white'>${text}</text>
    </svg>`;
    return `data:image/svg+xml;charset=UTF-8,${svg}`;
  };

  const qrDataUri = (id) => {
    const size = 120;
    const c = document.createElement("canvas");
    c.width = size;
    c.height = size;
    const x = c.getContext("2d");
    x.fillStyle = "#fff";
    x.fillRect(0, 0, size, size);
    x.fillStyle = "#111";
    for (let row = 0; row < 15; row += 1) {
      for (let col = 0; col < 15; col += 1) {
        const bit = (id.charCodeAt((row + col) % id.length) + row * 7 + col * 3) % 2;
        if (bit) {
          x.fillRect(col * 8, row * 8, 7, 7);
        }
      }
    }
    x.fillStyle = "#5c7d46";
    x.fillRect(0, 108, 120, 12);
    x.fillStyle = "#fff";
    x.font = "10px Segoe UI";
    x.fillText(`ID ${id}`, 6, 117);
    return c.toDataURL("image/png");
  };

  const getCurrentPet = () => state.pets.find((p) => p.id === state.selectedPetId) || state.pets[0] || null;

  const getPetQrUrl = (petId) => {
    if (!petId || !state.currentUser?.id) return "";
    return `${getApiUrl(`/api/public/qr/${encodeURIComponent(petId)}`)}?owner=${encodeURIComponent(state.currentUser.id)}`;
  };

  const notify = (message, type = "success") => {
    state.notification = { message, type };
    render();
    setTimeout(() => {
      state.notification = null;
      render();
    }, 3200);
  };

  const renderSidebar = () => {
    const links = [
      { key: "pets", icon: "🐾", label: "Mis Mascotas", badge: state.pets.length },
      { key: "alerts", icon: "🗺️", label: "Monitoreo GPS", badge: state.scans.length || "" },
      { key: "owner-profile", icon: "👤", label: "Mi Perfil Propietario", badge: "" },
      { key: "register", icon: "➕", label: "Inscribir Placa QR", badge: "" }
    ];

    return `
      <div class="sidebar-layer ${state.sidebarOpen ? "is-open" : ""}">
        <div class="sidebar-backdrop" data-action="close-sidebar"></div>
        <aside class="sidebar">
          <div>
            <div class="sidebar-head">
              <img class="sidebar-logo" src="assets/images/horlogo.png" alt="PetTag" />
              <button class="close-sidebar" data-action="close-sidebar" aria-label="Cerrar menu">×</button>
            </div>
            <div class="owner-card">
              <div class="avatar">${e((state.ownerProfile.name || "?").charAt(0).toUpperCase())}</div>
              <div>
                <div class="owner-name">${e(state.ownerProfile.name || "Propietario")}</div>
                <div class="owner-district">📍 ${e(state.ownerProfile.district || "Sin distrito")}</div>
              </div>
            </div>

            <div class="sidebar-nav">
              ${links
                .map((item) => `
                  <button class="nav-btn ${state.activeTab === item.key && state.currentView === "owner-dashboard" ? "active" : ""}" data-action="navigate" data-view="owner-dashboard" data-tab="${item.key}">
                    <span class="nav-label">
                      <span>${item.icon} ${item.label}</span>
                      ${item.badge !== "" ? `<span class="nav-badge">${item.badge}</span>` : ""}
                    </span>
                  </button>
                `)
                .join("")}
            </div>

            <div class="sidebar-section-title">Simular lectura fisica</div>
            <div class="scan-shortcuts">
              ${state.pets
                .map((pet) => `<button class="shortcut-btn" data-action="scan" data-id="${pet.id}">Escanear ${e(pet.name)}</button>`)
                .join("") || `<div class="muted">Sin mascotas registradas.</div>`}
            </div>

            <button class="danger-btn logout-btn" data-action="logout">Cerrar sesion</button>
          </div>
          <div class="sidebar-footer">
            PetTag Peru v2.1 · Sistema de identificacion y monitoreo seguro para mascotas.
          </div>
        </aside>
      </div>
    `;
  };

  const renderPets = () => `
    <div class="hero">
      <div>
        <h1 class="section-title">Mis Mascotas Vinculadas</h1>
        <p class="section-desc">Todos los cambios de ficha se actualizan sin alterar el codigo QR impreso en la placa.</p>
      </div>
      <button class="action-btn" data-action="navigate" data-view="owner-dashboard" data-tab="register">+ Nueva Mascota</button>
    </div>
    <div class="grid pet-grid">
      ${state.pets
        .map((pet) => {
          const edit = state.editingPetId === pet.id;
          return `
            <article class="card">
              <div class="status ${pet.status}">
                <span class="status-text"><i class="status-dot"></i>${pet.status === "lost" ? "Desaparecido" : "A salvo"}</span>
                <button class="${pet.status === "lost" ? "secondary-btn" : "danger-btn"}" data-action="toggle-status" data-id="${pet.id}">
                  ${pet.status === "lost" ? "Marcar A Salvo" : "Reportar Perdida"}
                </button>
              </div>
              <div class="card-body">
                ${
                  edit
                    ? `
                    <div class="edit-panel">
                      <div class="edit-header">
                        <span class="edit-title">Editar ficha informativa</span>
                        <button class="ghost-btn" data-action="cancel-edit">Cancelar</button>
                      </div>
                      <div class="form-grid">
                        <div><label>Nombre</label><input class="field" id="edit-name" value="${e(pet.name)}" /></div>
                        <div><label>Tipo</label><input class="field" id="edit-type" value="${e(pet.type)}" /></div>
                        <div><label>Raza</label><input class="field" id="edit-breed" value="${e(pet.breed)}" /></div>
                        <div><label>Distrito</label><input class="field" id="edit-district" value="${e(pet.district)}" /></div>
                      </div>
                      <div class="row"><label>Foto URL</label><input class="field" id="edit-photo" value="${e(pet.photo)}" /></div>
                      <div class="row"><label>Vacunas (coma)</label><input class="field" id="edit-vaccines" value="${e(pet.vaccines.join(", "))}" /></div>
                      <div class="row"><label>Alergias</label><input class="field" id="edit-allergies" value="${e(pet.allergies)}" /></div>
                      <div class="row"><label>Cuidados</label><textarea id="edit-notes">${e(pet.careNotes)}</textarea></div>
                      <div class="actions">
                        <button class="action-btn" data-action="save-pet" data-id="${pet.id}">Guardar Cambios</button>
                      </div>
                    </div>
                  `
                    : `
                    <div class="pet-head">
                      <img class="pet-photo" src="${pet.photo || placeholderPhoto(pet.name, pet.type)}" alt="${e(pet.name)}" />
                      <div class="pet-copy">
                        <strong>${e(pet.name)}</strong>
                        <div class="muted">${e(pet.type)} · ${e(pet.breed)}</div>
                        <div class="pet-district">📍 Distrito: ${e(pet.district)}</div>
                        <span class="pet-id">ID: ${e(pet.id)}</span>
                      </div>
                    </div>
                    <div class="actions">
                      <button class="secondary-btn" data-action="edit-pet" data-id="${pet.id}">Editar Perfil</button>
                      <button class="action-btn" data-action="scan" data-id="${pet.id}">Escanear Placa</button>
                    </div>
                  `
                }
              </div>
              ${
                edit
                  ? ""
                  : `
                    <div class="qr-strip">
                      <div class="qr-meta">
                        <img src="${getPetQrUrl(pet.id) || qrDataUri(pet.id)}" alt="QR ${e(pet.id)}" />
                        <div>
                          <span class="qr-title">QR ID: ${e(pet.id)}</span>
                          <span class="qr-subtitle">Vinculado</span>
                        </div>
                      </div>
                      <span class="qr-tag">QR estatico activo</span>
                    </div>
                  `
              }
            </article>
          `;
        })
        .join("")}
    </div>
  `;

  const renderProfile = () => {
    if (state.isEditingOwner) {
      return `
      <section class="profile-shell"><div class="profile-body">
        <h2 class="section-title" style="font-size:30px;">Mi Perfil de Propietario</h2>
        <p class="section-desc">Actualiza tus canales de contacto sin alterar el QR de tus mascotas.</p>
        <div class="form-grid row">
          <div><label>Nombre</label><input class="field" id="owner-name" value="${e(state.tempOwnerProfile.name)}" /></div>
          <div><label>Celular</label><input class="field" id="owner-phone" value="${e(state.tempOwnerProfile.phone)}" /></div>
          <div><label>Correo</label><input class="field" id="owner-email" value="${e(state.tempOwnerProfile.email)}" readonly /></div>
          <div><label>Distrito</label><input class="field" id="owner-district" value="${e(state.tempOwnerProfile.district)}" /></div>
        </div>
        <div class="actions"><button class="action-btn" data-action="save-owner">Guardar</button><button class="secondary-btn" data-action="cancel-owner">Cancelar</button></div>
      </div></section>`;
    }

    return `
      <section class="profile-shell"><div class="profile-body">
        <h2 class="section-title" style="font-size:30px;">Mi Perfil de Propietario</h2>
        <p class="section-desc">Actualiza tus canales de contacto de forma inmediata. No altera el QR de tus mascotas.</p>
        <div class="profile-summary">
          <div style="display:flex;align-items:center;gap:12px;">
            <div class="avatar">${e((state.ownerProfile.name || "?").charAt(0).toUpperCase())}</div>
            <div>
              <div class="owner-name">${e(state.ownerProfile.name)}</div>
              <div class="muted">Administrador de placas</div>
            </div>
          </div>
          <span class="profile-badge">Verificado</span>
        </div>
        <div class="profile-grid">
          <div class="profile-item"><span>Contacto WhatsApp</span><strong>${e(state.ownerProfile.phone)}</strong></div>
          <div class="profile-item"><span>Correo</span><strong>${e(state.ownerProfile.email)}</strong></div>
          <div class="profile-item"><span>Distrito</span><strong>${e(state.ownerProfile.district)}</strong></div>
          <div class="profile-item"><span>Proteccion de datos</span><strong style="color:var(--primary);">Seguridad SSL Activa</strong></div>
        </div>
        <div class="actions"><button class="action-btn" data-action="edit-owner">Editar Informacion</button></div>
      </div></section>
    `;
  };

  const renderRegister = () => `
    <section class="surface-card"><div class="surface-body">
      <h2 class="section-title" style="font-size:30px;">Inscribir un Nuevo Collar QR</h2>
      <p class="section-desc">Genera la ficha tecnica y asocia un codigo estatico numerico para la placa de tu mascota.</p>
      <div class="form-grid row">
        <div><label>Nombre *</label><input class="field" id="new-name" value="${e(state.newPet.name)}" /></div>
        <div><label>Especie</label><select id="new-type"><option ${state.newPet.type === "Perro" ? "selected" : ""}>Perro</option><option ${state.newPet.type === "Gato" ? "selected" : ""}>Gato</option><option ${state.newPet.type === "Otro" ? "selected" : ""}>Otro</option></select></div>
        <div><label>Raza</label><input class="field" id="new-breed" value="${e(state.newPet.breed)}" /></div>
        <div><label>Distrito</label><input class="field" id="new-district" value="${e(state.newPet.district)}" /></div>
      </div>
      <div class="row"><label>Foto URL</label><input class="field" id="new-photo" value="${e(state.newPet.photo)}" /></div>
      <div class="row"><label>Vacunas (coma)</label><input class="field" id="new-vaccines" value="${e(state.newPet.vaccines)}" /></div>
      <div class="row"><label>Alergias</label><input class="field" id="new-allergies" value="${e(state.newPet.allergies)}" /></div>
      <div class="row"><label>Cuidados</label><textarea id="new-notes">${e(state.newPet.careNotes)}</textarea></div>
      <div class="actions"><button class="action-btn" data-action="create-pet">Generar Registro QR</button></div>
    </div></section>
  `;

  const renderAlerts = () => `
    <div class="banner">
      <div>
        <h2 class="section-title" style="font-size:30px;">Rastreo GPS en Tiempo Real</h2>
        <p class="section-desc">Monitorea las coordenadas registradas por quienes escanean las placas QR.</p>
      </div>
      <span class="badge">${state.scans.length} alertas</span>
    </div>
    <div class="alerts-grid">
      <section class="map-wrap">
        <h4 class="map-title">📍 Visualizador dinamico de coordenadas</h4>
        <div class="map-box">
          <div id="map"></div>
          <div class="map-caption">OSM Layer Activo</div>
        </div>
      </section>
      <section class="scan-list">
        <h4 class="panel-title">Historial de escaneos</h4>
        ${
          state.scans.length
            ? state.scans
                .map(
                  (scan) => `
                    <article class="scan-item" data-action="focus-scan" data-id="${scan.id}">
                      <div class="scan-name"><span>${e(scan.petName)}</span><span class="scan-time">${e(scan.timestamp)}</span></div>
                      <div class="muted" style="margin-top:8px;">📍 ${e(scan.district)}</div>
                      <div class="scan-device"><span>${e(scan.device)}</span><span class="scan-mode">GPS Real</span></div>
                    </article>`
                )
                .join("")
            : `<div class="empty-state"><strong>No hay alertas recientes.</strong><div>Escanea una mascota o comparte GPS para registrar coordenadas.</div></div>`
        }
      </section>
    </div>
  `;

  const renderFinder = () => {
    const pet = getCurrentPet();
    if (!pet) {
      return `<section class="card"><div class="card-body"><p class="muted">No hay mascotas registradas.</p></div></section>`;
    }

    return `
      <section class="finder">
        <div class="finder-notice ${pet.status === "lost" ? "warn" : "ok"}">
          <div>${pet.status === "lost" ? "⚠️" : "🛡️"}</div>
          <div>
            <strong>${pet.status === "lost" ? "Mascota reportada perdida" : "Lectura correcta de placa"}</strong>
            <div style="margin-top:6px;font-size:12px;line-height:1.55;">${pet.status === "lost" ? "Su familia lo esta buscando activamente. Comparte tu ubicacion para ayudar a recuperarlo." : "La mascota esta marcada como a salvo. El contacto directo se oculta por privacidad."}</div>
          </div>
        </div>
        <article class="finder-card">
          <div class="finder-hero">
            <img src="${pet.photo || placeholderPhoto(pet.name, pet.type)}" alt="${e(pet.name)}"/>
            <div class="finder-overlay"></div>
            <div class="finder-copy">
              <span class="finder-tag">${e(pet.type)}</span>
              <h2 class="finder-name">${e(pet.name)}</h2>
              <div style="font-size:12px;font-weight:700;">📍 Distrito registrado: ${e(pet.district)}</div>
            </div>
          </div>
          <div class="finder-panel soft">
            <h4 class="finder-heading">🗺️ ¿Encontraste a ${e(pet.name)}? Comparte tu GPS</h4>
            <p class="muted">Al presionar el boton, tu dispositivo registrara tu coordenada real en el panel del propietario de forma privada.</p>
            <div class="row">
              <button class="action-btn" data-action="real-location" data-id="${pet.id}" ${state.gpsLoading ? "disabled" : ""}>
                ${state.gpsLoading ? "Obteniendo GPS..." : "COMPARTIR MI UBICACION GPS NATIVA"}
              </button>
            </div>
          </div>
          ${
            pet.status === "lost"
              ? `<div class="finder-panel warn"><h4 class="finder-heading">💬 Canal de WhatsApp habilitado</h4><p class="muted">El propietario ha habilitado la comunicacion directa. Puedes copiar el telefono y contactarlo.</p><div class="row"><button class="whatsapp-btn" data-action="copy-phone">Mostrar y copiar telefono de contacto</button></div></div>`
              : `<div class="finder-panel center">El boton de contacto directo esta oculto por privacidad.</div>`
          }
          <div class="finder-body">
            <div class="finder-detail"><span>Cuidados Especiales</span><strong>${e(pet.careNotes || "Sin notas especiales.")}</strong></div>
            <div class="finder-grid">
              <div class="finder-detail"><span>Alergias</span><strong>${e(pet.allergies || "Sin registro")}</strong></div>
              <div class="finder-detail"><span>Vacunas</span><div class="finder-vaccines">${(pet.vaccines.length ? pet.vaccines : ["Sin registro"]).map((v) => `<div><i></i><span>${e(v)}</span></div>`).join("")}</div></div>
            </div>
          </div>
        </article>
        <div class="center-actions">
          <button class="secondary-btn" data-action="navigate" data-view="owner-dashboard" data-tab="pets">Volver al dashboard</button>
        </div>
      </section>
    `;
  };

  const renderMain = () => {
    if (state.currentView === "finder-view") {
      return renderFinder();
    }

    if (state.activeTab === "pets") return renderPets();
    if (state.activeTab === "alerts") return renderAlerts();
    if (state.activeTab === "owner-profile") return renderProfile();
    return renderRegister();
  };

  const initMap = () => {
    if (state.activeTab !== "alerts") return;
    const mapTarget = document.getElementById("map");
    if (!mapTarget || typeof L === "undefined") return;

    if (state.map) {
      state.map.remove();
      state.map = null;
    }

    const center = state.currentMapCenter || { lat: -12.1223, lon: -77.0298 };
    state.map = L.map("map", { attributionControl: false }).setView([center.lat, center.lon], 14);

    L.tileLayer("https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png", {
      attribution: "&copy; OpenStreetMap contributors"
    }).addTo(state.map);

    refreshMapMarkers();
  };

  const refreshMapMarkers = () => {
    if (!state.map) return;
    state.markers.forEach((m) => state.map.removeLayer(m));
    state.markers = [];

    state.scans.forEach((scan) => {
      if (!scan.lat || !scan.lon) return;
      const marker = L.marker([scan.lat, scan.lon])
        .addTo(state.map)
        .bindPopup(`<strong>${scan.petName}</strong><br/>${scan.district}<br/>${scan.timestamp}`);
      state.markers.push(marker);
    });

    if (state.currentMapCenter) {
      state.map.setView([state.currentMapCenter.lat, state.currentMapCenter.lon], 15);
    }
  };

  const navigate = (view, tab) => {
    state.currentView = view;
    state.activeTab = tab;
    state.sidebarOpen = false;
    render();
  };

  const savePetEdit = async (petId) => {
    const pet = state.pets.find((p) => p.id === petId);
    if (!pet) return;

    const payload = {
      name: document.getElementById("edit-name").value.trim(),
      type: document.getElementById("edit-type").value.trim(),
      breed: document.getElementById("edit-breed").value.trim(),
      district: document.getElementById("edit-district").value.trim(),
      photo: document.getElementById("edit-photo").value.trim(),
      vaccines: document
      .getElementById("edit-vaccines")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean),
      allergies: document.getElementById("edit-allergies").value.trim(),
      care_notes: document.getElementById("edit-notes").value.trim()
    };

    try {
      const data = await request(`/api/owner/pets/${encodeURIComponent(petId)}`, {
        method: "PUT",
        body: payload
      });
      const updated = normalizePet(data.pet || payload);
      const index = state.pets.findIndex((item) => item.id === petId);
      if (index >= 0) state.pets[index] = updated;
      state.editingPetId = null;
      notify("Ficha de mascota actualizada.");
      render();
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const createPet = async () => {
    const name = document.getElementById("new-name").value.trim();
    if (!name) {
      notify("El nombre es obligatorio.", "error");
      return;
    }

    const type = document.getElementById("new-type").value;
    const breed = document.getElementById("new-breed").value.trim() || "Mestizo";
    const district = document.getElementById("new-district").value.trim() || "Miraflores";
    const photo = document.getElementById("new-photo").value.trim();
    const vaccines = document
      .getElementById("new-vaccines")
      .value.split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const newId = Math.floor(100000 + Math.random() * 900000).toString();

    try {
      const data = await request("/api/owner/pets", {
        method: "POST",
        body: {
          id: newId,
          name,
          type,
          breed,
          district,
          photo,
          vaccines,
          allergies: document.getElementById("new-allergies").value.trim() || "Ninguna registrada.",
          care_notes: document.getElementById("new-notes").value.trim() || "Sin notas especiales.",
          status: "safe"
        }
      });

      state.pets.unshift(normalizePet(data.pet || {}));
      state.newPet = {
        name: "",
        type: "Perro",
        breed: "",
        photo: "",
        district: "Miraflores",
        vaccines: "",
        allergies: "",
        careNotes: ""
      };

      state.activeTab = "pets";
      notify(`Mascota registrada. ID ${newId}`);
      render();
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const shareLocation = (petId) => {
    const pet = state.pets.find((p) => p.id === petId);
    if (!pet) return;

    state.gpsLoading = true;
    render();

    const pushScan = async (lat, lon, device, accuracy = null) => {
      const now = new Date();
      try {
        const response = await fetch(getApiUrl("/api/public/scans"), {
          method: "POST",
          headers: {
            "Content-Type": "application/json"
          },
          body: JSON.stringify({
            petId: pet.id,
            ownerId: state.currentUser?.id,
            latitude: lat,
            longitude: lon,
            accuracy,
            note: null,
            device
          })
        });

        if (!response.ok) {
          throw new Error("No se pudo registrar el escaneo.");
        }

        state.scans.unshift({
          id: `sc-${Date.now()}`,
          petId: pet.id,
          petName: pet.name,
          timestamp: now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }),
          district: `${pet.district} (GPS)` ,
          lat,
          lon,
          device,
          isRealGps: true
        });
        state.currentMapCenter = { lat, lon };
        notify("Ubicacion compartida al propietario.");
      } catch {
        notify("No se pudo registrar el escaneo en backend.", "error");
      } finally {
        state.gpsLoading = false;
        render();
      }
    };

    if (!navigator.geolocation) {
      pushScan(-12.213578, -76.932387, "Simulado: dispositivo sin geolocalizacion");
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { latitude, longitude, accuracy } = position.coords;
        pushScan(latitude, longitude, `Movil (${accuracy.toFixed(0)}m)`, accuracy);
      },
      () => {
        pushScan(-12.213578, -76.932387, "Simulado: permiso denegado");
      },
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0 }
    );
  };

  const onClick = (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;

    if (action === "navigate") {
      navigate(target.dataset.view, target.dataset.tab);
      return;
    }

    if (action === "open-sidebar") {
      state.sidebarOpen = true;
      render();
      return;
    }

    if (action === "close-sidebar") {
      state.sidebarOpen = false;
      render();
      return;
    }

    if (action === "scan") {
      state.selectedPetId = target.dataset.id;
      state.currentView = "finder-view";
      state.sidebarOpen = false;
      notify("PetTag detectado.", "warning");
      render();
      return;
    }

    if (action === "toggle-status") {
      const pet = state.pets.find((p) => p.id === target.dataset.id);
      if (!pet) return;
      const nextStatus = pet.status === "safe" ? "lost" : "safe";
      request(`/api/owner/pets/${encodeURIComponent(pet.id)}/status`, {
        method: "PATCH",
        body: { status: nextStatus }
      })
        .then((data) => {
          pet.status = normalizePet(data.pet || pet).status;
          notify(pet.status === "lost" ? "Alerta de perdida activada." : "Mascota marcada a salvo.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "edit-pet") {
      state.editingPetId = target.dataset.id;
      render();
      return;
    }

    if (action === "cancel-edit") {
      state.editingPetId = null;
      render();
      return;
    }

    if (action === "save-pet") {
      savePetEdit(target.dataset.id);
      return;
    }

    if (action === "edit-owner") {
      state.isEditingOwner = true;
      state.tempOwnerProfile = { ...state.ownerProfile };
      render();
      return;
    }

    if (action === "cancel-owner") {
      state.isEditingOwner = false;
      render();
      return;
    }

    if (action === "save-owner") {
      request("/api/owner/profile", {
        method: "PUT",
        body: {
          name: document.getElementById("owner-name").value.trim(),
          phone: document.getElementById("owner-phone").value.trim(),
          district: document.getElementById("owner-district").value.trim()
        }
      })
        .then((data) => {
          state.ownerProfile.name = data.profile?.name || state.ownerProfile.name;
          state.ownerProfile.phone = data.profile?.phone || state.ownerProfile.phone;
          state.ownerProfile.district = data.profile?.district || state.ownerProfile.district;
          state.ownerProfile.email = data.profile?.email || state.ownerProfile.email;
          state.isEditingOwner = false;
          notify("Perfil actualizado.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "create-pet") {
      createPet();
      return;
    }

    if (action === "real-location") {
      shareLocation(target.dataset.id);
      return;
    }

    if (action === "focus-scan") {
      const scan = state.scans.find((s) => s.id === target.dataset.id);
      if (!scan) return;
      state.currentMapCenter = { lat: scan.lat, lon: scan.lon };
      refreshMapMarkers();
      notify(`Mapa centrado en ${scan.petName}.`);
      return;
    }

    if (action === "copy-phone") {
      const text = `+51 ${state.ownerProfile.phone}`;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => notify(`Telefono copiado: ${text}`))
          .catch(() => notify(`Telefono de contacto: ${text}`, "warning"));
      } else {
        notify(`Telefono de contacto: ${text}`, "warning");
      }
    }

    if (action === "logout") {
      resetSession();
    }
  };

  const render = () => {
    if (state.loading) {
      app.innerHTML = `
        <main class="loading-shell">
          <section class="surface-card"><div class="surface-body">
            <h2 class="section-title" style="font-size:30px;">Cargando dashboard...</h2>
            <p class="muted">Sincronizando datos con la base de datos.</p>
          </div></section>
        </main>
      `;
      return;
    }

    const alertHtml = state.notification
      ? `<div class="alert ${state.notification.type || "success"}">${state.notification.message}</div>`
      : "";

    const header = `
      <header class="topbar">
        <div class="topbar-inner">
          <button class="menu-toggle" data-action="open-sidebar" aria-label="Abrir menu"><span class="menu-lines"></span></button>
          <div class="brand-wrap"><img class="brand-logo" src="assets/images/horlogo.png" alt="PetTag" /></div>
          <div class="service-pill"><i class="service-dot"></i><span>Servicio activo</span></div>
        </div>
      </header>
    `;

    const body = `
      <div class="app-shell">
        ${renderSidebar()}
        ${header}
        <div class="layout-frame"><main class="panel">${renderMain()}</main></div>
      </div>
    `;

    app.innerHTML = `${alertHtml}${body}`;

    if (state.activeTab === "alerts" && state.currentView === "owner-dashboard") {
      initMap();
    }
  };

  app.addEventListener("click", onClick);
  loadDashboard();
})();
