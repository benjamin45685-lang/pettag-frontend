(() => {
  const token = localStorage.getItem("pettag_token") || "";
  const configuredApiBase = String(window.PETTAG_CONFIG?.API_BASE_URL || "").trim();
  const configuredTimeZone = String(window.PETTAG_CONFIG?.TIME_ZONE || "America/Lima").trim() || "America/Lima";
  const apiBase = (configuredApiBase || localStorage.getItem("pettag_api_base") || "").trim().replace(/\/$/, "");
  const REQUEST_TIMEOUT_MS = 15000;

  if (!token) {
    window.location.replace("login.html");
    return;
  }

  const state = {
    token,
    apiBase,
    bootstrapping: true,
    currentView: "owner-dashboard",
    activeTab: "pets",
    sidebarOpen: false,
    loading: true,
    pendingRequests: 0,
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
    newPetPhotoPreview: "",
    newPetPhotoFile: null,
    editPetPhotoPreview: "",
    editPetPhotoFile: null,
    tempPetEdit: {},
    pets: [],
    myPets: [],
    scans: [],
    adminStats: {
      totalUsers: 0,
      pendingUsers: 0,
      totalPets: 0,
      lostPets: 0,
      totalScans: 0
    },
    adminUsers: [],
    adminPets: [],
    adminScans: [],
    adminUserSearch: "",
    adminUserFilter: "all",
    adminUserSort: "pending-first",
    selectedPetId: "",
    qrPreview: null
  };

  const ADMIN_TABS = new Set(["admin-overview", "admin-users", "admin-pets", "admin-scans"]);
  const ADMIN_ACTIONS = new Set(["refresh-admin", "approve-user", "toggle-user-role", "admin-toggle-pet-status", "delete-pet"]);

  const app = document.getElementById("app");
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

  const MAX_PHOTO_FILE_SIZE = 10 * 1024 * 1024;

  const readImageFileAsDataUrl = (file) => new Promise((resolve, reject) => {
    if (!file) {
      resolve(null);
      return;
    }

    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = () => reject(new Error("No se pudo leer la imagen seleccionada."));
    reader.readAsDataURL(file);
  });

  const clearPhotoPreview = (kind) => {
    const previewKey = kind === "edit" ? "editPetPhotoPreview" : "newPetPhotoPreview";
    const fileKey = kind === "edit" ? "editPetPhotoFile" : "newPetPhotoFile";
    state[previewKey] = "";
    state[fileKey] = null;
  };

  const setPhotoPreview = async (kind, file) => {
    const previewKey = kind === "edit" ? "editPetPhotoPreview" : "newPetPhotoPreview";
    const fileKey = kind === "edit" ? "editPetPhotoFile" : "newPetPhotoFile";
    state[previewKey] = "";
    state[fileKey] = null;

    if (file) {
      const dataUrl = await readImageFileAsDataUrl(file);
      state[previewKey] = dataUrl;
      state[fileKey] = {
        name: file.name,
        type: file.type,
        dataUrl
      };
    }
  };

  const isValidPhotoUrl = (value) => {
    const photo = String(value || "").trim();
    if (!photo) return true;
    return /^https?:\/\//i.test(photo);
  };

  const resetSession = () => {
    localStorage.removeItem("pettag_token");
    window.location.replace("login.html");
  };

  const getApiUrl = (path) => `${state.apiBase}${path}`;

  const request = async (path, options = {}) => {
    const shouldTrackLoading = options.trackLoading !== false;
    const includeAuth = options.includeAuth !== false;
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

    if (shouldTrackLoading) {
      state.pendingRequests += 1;
      state.loading = true;
      render();
    }

    try {
      const response = await fetch(getApiUrl(path), {
        method: options.method || "GET",
        headers: {
          "Content-Type": "application/json",
          ...(includeAuth ? { Authorization: `Bearer ${state.token}` } : {}),
          ...(options.headers || {})
        },
        body: options.body ? JSON.stringify(options.body) : undefined,
        signal: controller.signal
      });

      const data = await response.json().catch(() => ({}));
      if (response.status === 401) {
        resetSession();
        throw new Error("Sesion expirada.");
      }

      if (response.status === 413) {
        throw new Error("La imagen es demasiado grande. Prueba con una foto mas ligera.");
      }

      if (!response.ok) {
        throw new Error(data.error || "No se pudo completar la solicitud.");
      }

      return data;
    } catch (error) {
      if (error?.name === "AbortError") {
        throw new Error("La solicitud tardo demasiado. Verifica conexion y API.");
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
      if (shouldTrackLoading) {
        state.pendingRequests = Math.max(0, state.pendingRequests - 1);
        state.loading = state.pendingRequests > 0;
        render();
      }
    }
  };

  const hasAdminAccess = () => state.currentUser?.isAdmin === true;

  const normalizePet = (pet) => ({
    id: String(pet.id || "").trim(),
    ownerId: String(pet.owner_id || pet.ownerId || "").trim(),
    ownerName: String(pet.owner?.name || pet.ownerName || "").trim(),
    ownerDistrict: String(pet.owner?.district || pet.ownerDistrict || "").trim(),
    name: String(pet.name || "").trim(),
    type: String(pet.type || "").trim(),
    breed: String(pet.breed || "").trim(),
    photo: normalizePetPhoto(pet.photo),
    district: String(pet.district || "").trim(),
    vaccines: Array.isArray(pet.vaccines) ? pet.vaccines : [],
    allergies: String(pet.allergies || "").trim(),
    careNotes: String(pet.care_notes || pet.careNotes || "").trim(),
    status: normalizePetStatus(pet.status)
  });

  const normalizeAdminUser = (user) => ({
    id: String(user.id || "").trim(),
    email: String(user.email || "").trim(),
    name: String(user.name || "").trim(),
    phone: String(user.phone || "").trim(),
    district: String(user.district || "").trim(),
    role: String(user.role || "user").trim().toLowerCase() || "user",
    approved: typeof user.approved === "boolean" ? user.approved : true,
    petsCount: Number(user.petsCount || 0),
    scansCount: Number(user.scansCount || 0),
    createdAt: user.createdAt || user.created_at || null
  });

  const normalizeAdminPet = (pet) => ({
    ...normalizePet(pet),
    ownerEmail: String(pet.owner?.email || pet.ownerEmail || "").trim(),
    ownerApproved: typeof pet.owner?.approved === "boolean" ? pet.owner.approved : true,
    ownerRole: String(pet.owner?.role || pet.ownerRole || "user").trim().toLowerCase() || "user"
  });

  const formatScanTime = (createdAt) => {
    const date = new Date(createdAt || "");
    if (Number.isNaN(date.getTime())) return "Sin hora";
    return date.toLocaleTimeString("es-PE", {
      hour: "2-digit",
      minute: "2-digit",
      timeZone: configuredTimeZone
    });
  };

  const normalizeScan = (scan, petLookup = {}) => {
    const petId = String(scan.petId || scan.pet_id || "").trim();
    const createdAt = scan.createdAt || scan.created_at || null;
    const fallbackPet = petLookup[petId] || null;

    return {
      id: scan.id,
      petId,
      petName: scan.petName || fallbackPet?.name || "Mascota",
      createdAt,
      timestamp: createdAt ? formatScanTime(createdAt) : (scan.timestamp || "Sin hora"),
      district: scan.district || fallbackPet?.district || "",
      lat: scan.lat ?? scan.latitude,
      lon: scan.lon ?? scan.longitude,
      device: scan.device || "",
      isRealGps: scan.isRealGps !== false
    };
  };

  const formatDateTime = (value) => {
    const date = new Date(value || "");
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return date.toLocaleString("es-PE", {
      day: "2-digit",
      month: "2-digit",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
      timeZone: configuredTimeZone
    });
  };

  const hydrateDashboard = (payload) => {
    state.currentUser = payload.user
      ? {
          ...payload.user,
          role: String(payload.user.role || "user").trim().toLowerCase() || "user",
          isAdmin: payload.user.isAdmin === true,
          approved: payload.user.approved === false ? false : true
        }
      : null;
    state.ownerProfile = {
      name: payload.profile?.name || "",
      phone: payload.profile?.phone || "",
      email: payload.profile?.email || payload.user?.email || "",
      district: payload.profile?.district || ""
    };
    state.tempOwnerProfile = { ...state.ownerProfile };
    state.myPets = Array.isArray(payload.pets) ? payload.pets.map(normalizePet) : [];
    state.pets = [...state.myPets];
    const myPetsById = state.myPets.reduce((acc, pet) => {
      acc[pet.id] = pet;
      return acc;
    }, {});
    state.scans = Array.isArray(payload.scans) ? payload.scans.map((scan) => normalizeScan(scan, myPetsById)) : [];

    if (!state.selectedPetId || !state.myPets.some((pet) => pet.id === state.selectedPetId)) {
      state.selectedPetId = state.myPets[0]?.id || "";
    }
  };

  const hydrateAdminDashboard = (payload) => {
    state.adminStats = {
      totalUsers: Number(payload.stats?.totalUsers || 0),
      pendingUsers: Number(payload.stats?.pendingUsers || 0),
      totalPets: Number(payload.stats?.totalPets || 0),
      lostPets: Number(payload.stats?.lostPets || 0),
      totalScans: Number(payload.stats?.totalScans || 0)
    };
    state.adminUsers = Array.isArray(payload.users) ? payload.users.map(normalizeAdminUser) : [];
    state.adminPets = Array.isArray(payload.pets) ? payload.pets.map(normalizeAdminPet) : [];
    const petLookup = state.adminPets.reduce((acc, pet) => {
      acc[pet.id] = pet;
      return acc;
    }, {});
    state.adminScans = Array.isArray(payload.scans) ? payload.scans.map((scan) => normalizeScan(scan, petLookup)) : [];
  };

  const resetAdminState = () => {
    state.adminStats = {
      totalUsers: 0,
      pendingUsers: 0,
      totalPets: 0,
      lostPets: 0,
      totalScans: 0
    };
    state.adminUsers = [];
    state.adminPets = [];
    state.adminScans = [];
  };

  const ensureAllowedTab = () => {
    if (!hasAdminAccess() && ADMIN_TABS.has(state.activeTab)) {
      state.activeTab = "pets";
    }
  };

  const loadAdminDashboard = async () => {
    const data = await request("/api/admin/dashboard");
    hydrateAdminDashboard(data);
  };

  const mergePetsForVisibility = (allPets) => {
    if (!Array.isArray(allPets)) {
      state.pets = [...state.myPets];
      return;
    }

    const ownById = state.myPets.reduce((acc, pet) => {
      acc[pet.id] = pet;
      return acc;
    }, {});

    state.pets = allPets
      .map(normalizePet)
      .map((pet) => {
        const ownPet = ownById[pet.id];
        return ownPet ? { ...ownPet, ...pet, status: normalizePetStatus(pet.status) } : pet;
      });
  };

  const loadDashboard = async () => {
    try {
      const meData = await request("/api/auth/me");

      hydrateDashboard(meData);

      if (hasAdminAccess()) {
        await loadAdminDashboard();
        mergePetsForVisibility(state.adminPets);
      } else {
        resetAdminState();
        const allPetsData = await request("/api/pets").catch(() => ({ pets: [] }));
        mergePetsForVisibility(allPetsData.pets);
      }

      ensureAllowedTab();
    } catch (error) {
      notify(error.message || "No se pudo cargar el dashboard.", "error");
    } finally {
      state.bootstrapping = false;
      state.loading = state.pendingRequests > 0;
      render();
    }
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

  const getCurrentPet = () => state.myPets.find((p) => p.id === state.selectedPetId) || state.myPets[0] || null;

  const getPetQrUrl = (petId) => {
    if (!petId) return "";
    return `${getApiUrl(`/api/public/qr/${encodeURIComponent(petId)}`)}`;
  };

  const getPublicScanUrl = (pet) => {
    if (!pet?.id) return "";
    const params = new URLSearchParams({ s: String(pet.id).trim() });
    const ownerId = String(pet.ownerId || "").trim();
    if (ownerId) {
      params.set("o", ownerId);
    }
    return `public-scan.html?${params.toString()}`;
  };

  const openQrPreview = (petId) => {
    if (!petId) return;
    state.qrPreview = {
      id: petId,
      src: getPetQrUrl(petId) || qrDataUri(petId)
    };
    render();
  };

  const closeQrPreview = () => {
    if (!state.qrPreview) return;
    state.qrPreview = null;
    render();
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
    const ownerLinks = [
      { key: "pets", icon: "paw", glyph: "🐾", label: "Mascotas Registradas", badge: state.pets.length },
      { key: "register", icon: "add", glyph: "✚", label: "Inscribir Placa QR", badge: "" },
      { key: "alerts", icon: "map", glyph: "🗺", label: "Monitoreo GPS", badge: state.scans.length || "" },
      { key: "owner-profile", icon: "user", glyph: "👤", label: "Mi Perfil Propietario", badge: "" }
    ];

    const adminLinks = hasAdminAccess()
      ? [
          { key: "admin-overview", icon: "shield", glyph: "🛡", label: "Resumen Admin", badge: state.adminStats.pendingUsers || "" },
          { key: "admin-users", icon: "check", glyph: "☑", label: "Aprobar Usuarios", badge: state.adminStats.pendingUsers || "" },
          { key: "admin-pets", icon: "list", glyph: "📋", label: "Control de Mascotas", badge: state.adminStats.totalPets || "" },
          { key: "admin-scans", icon: "activity", glyph: "📡", label: "Actividad Global", badge: state.adminStats.totalScans || "" }
        ]
      : [];

    const renderNavItem = (item) => `
      <button class="nav-btn ${state.activeTab === item.key && state.currentView === "owner-dashboard" ? "active" : ""}" data-action="navigate" data-view="owner-dashboard" data-tab="${item.key}">
        <span class="nav-label">
          <span class="nav-label-main"><span class="nav-icon ${item.icon}">${item.glyph}</span><span>${item.label}</span></span>
          ${item.badge !== "" ? `<span class="nav-badge">${item.badge}</span>` : ""}
        </span>
      </button>
    `;

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

            <div class="sidebar-nav-group">
              <div class="sidebar-section-title">Propietario</div>
              <div class="sidebar-nav">
                ${ownerLinks.map(renderNavItem).join("")}
              </div>
            </div>

            ${hasAdminAccess()
              ? `<div class="sidebar-nav-group"><div class="sidebar-section-title">Administracion</div><div class="sidebar-nav">${adminLinks.map(renderNavItem).join("")}</div><div class="muted">Solo visible para cuentas administradoras aprobadas.</div></div>`
              : ""}

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
        <h1 class="section-title">Mascotas Registradas</h1>
        <p class="section-desc">Este panel muestra todas las mascotas registradas. Solo el propietario puede editar su ficha.</p>
      </div>
      <button class="action-btn" data-action="navigate" data-view="owner-dashboard" data-tab="register">+ Nueva Mascota</button>
    </div>
    <div class="grid pet-grid">
      ${state.pets
        .map((pet) => {
          const isOwner = pet.ownerId === state.currentUser?.id;
          const edit = state.editingPetId === pet.id;
          const hasPhoto = Boolean(pet.photo);
          return `
            <article class="card">
              <div class="status ${pet.status}">
                <span class="status-text"><i class="status-dot"></i>${pet.status === "lost" ? "Desaparecido" : "A salvo"}</span>
                ${isOwner
                  ? `<button class="${pet.status === "lost" ? "secondary-btn" : "danger-btn"}" data-action="toggle-status" data-id="${pet.id}">
                  ${pet.status === "lost" ? "Marcar A Salvo" : "Reportar Perdida"}
                </button>`
                  : `<span class="qr-tag">Solo lectura</span>`}
              </div>
              <div class="card-body">
                ${
                  edit && isOwner
                    ? `
                    <div class="edit-panel">
                      <div class="edit-header">
                        <span class="edit-title">Editar ficha informativa</span>
                        <button class="ghost-btn" data-action="cancel-edit">Cancelar</button>
                      </div>
                      <div class="form-grid">
                        <div><label>Nombre</label><input class="field" id="edit-name" data-action="edit-name" value="${e(state.tempPetEdit.name || pet.name)}" /></div>
                        <div><label>Tipo</label><input class="field" id="edit-type" data-action="edit-type" value="${e(state.tempPetEdit.type || pet.type)}" /></div>
                        <div><label>Raza</label><input class="field" id="edit-breed" data-action="edit-breed" value="${e(state.tempPetEdit.breed || pet.breed)}" /></div>
                        <div><label>Distrito</label><input class="field" id="edit-district" data-action="edit-district" value="${e(state.tempPetEdit.district || pet.district)}" /></div>
                      </div>
                      <div class="row"><label>Foto desde galería</label><input class="field" type="file" id="edit-photo-file" data-action="edit-photo-file" accept="image/*" /></div>
                      <div class="photo-preview-shell">
                        <span class="photo-preview-label">Vista previa</span>
                        ${state.editPetPhotoPreview || pet.photo
          ? `<img class="photo-preview-image" src="${e(state.editPetPhotoPreview || pet.photo)}" alt="Vista previa ${e(pet.name)}" />`
          : `<div class="photo-preview-empty">Aun no eliges una imagen</div>`}
                      </div>
                      <div class="muted">Si no eliges una nueva imagen, se mantiene la actual.</div>
                      <div class="row"><label>Vacunas (coma)</label><input class="field" id="edit-vaccines" data-action="edit-vaccines" value="${e((state.tempPetEdit.vaccines || pet.vaccines.join(", "))) }" /></div>
                      <div class="row"><label>Alergias</label><input class="field" id="edit-allergies" data-action="edit-allergies" value="${e(state.tempPetEdit.allergies || pet.allergies)}" /></div>
                      <div class="row"><label>Cuidados</label><textarea id="edit-notes" data-action="edit-notes">${e(state.tempPetEdit.careNotes || pet.careNotes)}</textarea></div>
                      <div class="actions">
                        <button class="action-btn" data-action="save-pet" data-id="${pet.id}">Guardar Cambios</button>
                      </div>
                    </div>
                  `
                    : `
                    <div class="pet-head">
                      ${hasPhoto
                        ? `<img class="pet-photo" src="${pet.photo}" alt="${e(pet.name)}" />`
                        : `<div class="pet-photo is-empty" aria-label="Sin foto"></div>`}
                      <div class="pet-copy">
                        <strong>${e(pet.name)}</strong>
                        <div class="muted">${e(pet.type)} · ${e(pet.breed)}</div>
                        <div class="muted">Propietario: ${e(pet.ownerName || "No disponible")}</div>
                        <div class="pet-district">📍 Distrito: ${e(pet.district)}</div>
                        <span class="pet-id">ID: ${e(pet.id)}</span>
                      </div>
                    </div>
                    <div class="actions">
                      ${isOwner ? `<button class="secondary-btn" data-action="edit-pet" data-id="${pet.id}">Editar Perfil</button>` : ""}
                      ${isOwner ? `<button class="action-btn" data-action="scan" data-id="${pet.id}">Abrir Vista Publica QR</button>` : ""}
                    </div>
                  `
                }
              </div>
              ${
                edit && isOwner
                  ? ""
                  : `
                    <div class="qr-strip">
                      <div class="qr-meta">
                        <img
                          src="${getPetQrUrl(pet.id) || qrDataUri(pet.id)}"
                          alt="QR ${e(pet.id)}"
                          class="qr-thumb"
                          data-action="open-qr"
                          data-id="${pet.id}"
                        />
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

  const renderAdminOverview = () => `
    <section class="grid admin-stack">
      <div class="hero">
        <div>
          <h1 class="section-title">Panel Administrativo</h1>
          <p class="section-desc">Desde aqui puedes aprobar usuarios, supervisar mascotas y revisar la actividad global del sistema.</p>
        </div>
        <button class="secondary-btn" data-action="refresh-admin">Actualizar datos</button>
      </div>
      <div class="stats-grid">
        <article class="stat-card"><span>Usuarios</span><strong>${state.adminStats.totalUsers}</strong><small>cuentas registradas</small></article>
        <article class="stat-card warn"><span>Pendientes</span><strong>${state.adminStats.pendingUsers}</strong><small>requieren aprobacion</small></article>
        <article class="stat-card"><span>Mascotas</span><strong>${state.adminStats.totalPets}</strong><small>registros activos</small></article>
        <article class="stat-card danger"><span>Perdidas</span><strong>${state.adminStats.lostPets}</strong><small>con alerta activa</small></article>
        <article class="stat-card"><span>Escaneos</span><strong>${state.adminStats.totalScans}</strong><small>actividad historica</small></article>
      </div>
      <div class="admin-grid">
        <section class="surface-card"><div class="surface-body">
          <h3 class="panel-title">Pendientes de aprobacion</h3>
          ${state.adminUsers.filter((user) => !user.approved && user.role !== "admin").length
            ? state.adminUsers
              .filter((user) => !user.approved && user.role !== "admin")
              .slice(0, 5)
              .map((user) => `
                <article class="list-item">
                  <div>
                    <strong>${e(user.name || user.email)}</strong>
                    <div class="muted">${e(user.email)} · ${e(user.district || "Sin distrito")}</div>
                  </div>
                  <button class="action-btn compact-btn" data-action="approve-user" data-id="${user.id}" data-approved="true">Aprobar</button>
                </article>
              `)
              .join("")
            : `<div class="empty-state"><strong>No hay solicitudes pendientes.</strong><div>Las nuevas cuentas aprobadas apareceran aqui.</div></div>`}
        </div></section>
        <section class="surface-card"><div class="surface-body">
          <h3 class="panel-title">Alertas activas</h3>
          ${state.adminPets.filter((pet) => pet.status === "lost").length
            ? state.adminPets
              .filter((pet) => pet.status === "lost")
              .slice(0, 5)
              .map((pet) => `
                <article class="list-item">
                  <div>
                    <strong>${e(pet.name)}</strong>
                    <div class="muted">${e(pet.ownerName || "Sin propietario")} · ${e(pet.district || "Sin distrito")}</div>
                  </div>
                  <button class="secondary-btn compact-btn" data-action="admin-toggle-pet-status" data-id="${pet.id}" data-status="safe">Marcar a salvo</button>
                </article>
              `)
              .join("")
            : `<div class="empty-state"><strong>No hay mascotas reportadas como perdidas.</strong><div>El sistema no registra alertas activas.</div></div>`}
        </div></section>
      </div>
    </section>
  `;

  const getVisibleAdminUsers = () => {
    const query = String(state.adminUserSearch || "").trim().toLowerCase();
    const filter = state.adminUserFilter || "all";
    const sort = state.adminUserSort || "pending-first";

    const matchesQuery = (user) => {
      if (!query) return true;
      const haystack = [user.name, user.email, user.district].map((value) => String(value || "").toLowerCase());
      return haystack.some((value) => value.includes(query));
    };

    const matchesFilter = (user) => {
      if (filter === "pending") return !user.approved;
      if (filter === "approved") return user.approved;
      if (filter === "admins") return user.role === "admin";
      if (filter === "users") return user.role !== "admin";
      return true;
    };

    const users = state.adminUsers.filter((user) => matchesQuery(user) && matchesFilter(user));

    const byName = (left, right) => String(left.name || left.email || "").localeCompare(String(right.name || right.email || ""), "es", { sensitivity: "base" });
    const byPets = (left, right) => Number(left.petsCount || 0) - Number(right.petsCount || 0);

    users.sort((left, right) => {
      if (sort === "name-asc") return byName(left, right);
      if (sort === "name-desc") return byName(right, left);
      if (sort === "pets-asc") return byPets(left, right);
      if (sort === "pets-desc") return byPets(right, left);

      const leftPendingWeight = left.approved ? 1 : 0;
      const rightPendingWeight = right.approved ? 1 : 0;
      if (leftPendingWeight !== rightPendingWeight) return leftPendingWeight - rightPendingWeight;
      return byName(left, right);
    });

    return users;
  };

  const renderAdminUsers = () => `
    ${(() => {
      const visibleUsers = getVisibleAdminUsers();
      return `
    <section class="grid admin-stack">
      <div class="banner">
        <div>
          <h2 class="section-title section-title-md">Aprobacion y Roles</h2>
          <p class="section-desc">Aprueba cuentas nuevas y define que usuarios operan como administradores.</p>
        </div>
        <button class="secondary-btn" data-action="refresh-admin">Recargar</button>
      </div>
      <div class="admin-users-toolbar">
        <input
          class="field"
          type="search"
          placeholder="Buscar por nombre, correo o distrito"
          value="${e(state.adminUserSearch)}"
          data-action="admin-users-search"
        />
        <select class="field" data-action="admin-users-filter">
          <option value="all" ${state.adminUserFilter === "all" ? "selected" : ""}>Todos</option>
          <option value="pending" ${state.adminUserFilter === "pending" ? "selected" : ""}>Pendientes</option>
          <option value="approved" ${state.adminUserFilter === "approved" ? "selected" : ""}>Aprobados</option>
          <option value="users" ${state.adminUserFilter === "users" ? "selected" : ""}>Solo usuarios</option>
          <option value="admins" ${state.adminUserFilter === "admins" ? "selected" : ""}>Solo admins</option>
        </select>
        <select class="field" data-action="admin-users-sort">
          <option value="pending-first" ${state.adminUserSort === "pending-first" ? "selected" : ""}>Orden: Pendientes primero</option>
          <option value="name-asc" ${state.adminUserSort === "name-asc" ? "selected" : ""}>Orden: Nombre A-Z</option>
          <option value="name-desc" ${state.adminUserSort === "name-desc" ? "selected" : ""}>Orden: Nombre Z-A</option>
          <option value="pets-desc" ${state.adminUserSort === "pets-desc" ? "selected" : ""}>Orden: Mascotas mayor a menor</option>
          <option value="pets-asc" ${state.adminUserSort === "pets-asc" ? "selected" : ""}>Orden: Mascotas menor a mayor</option>
        </select>
        <div class="admin-users-count">${visibleUsers.length} resultado(s)</div>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-users-table">
          <thead>
            <tr>
              <th>Usuario</th>
              <th>Estado</th>
              <th>Rol</th>
              <th>Mascotas</th>
              <th>Acciones</th>
            </tr>
          </thead>
          <tbody>
            ${visibleUsers.length
              ? visibleUsers.map((user) => `
              <tr>
                <td>
                  <strong>${e(user.name || "Sin nombre")}</strong>
                  <div class="muted">${e(user.email)}</div>
                  <div class="muted">${e(user.district || "Sin distrito")}</div>
                </td>
                <td><span class="chip ${user.approved ? "ok" : "warn"}">${user.approved ? "Aprobado" : "Pendiente"}</span></td>
                <td><span class="chip">${user.role === "admin" ? "Admin" : "Usuario"}</span></td>
                <td><strong>${user.petsCount}</strong><div class="muted">${user.scansCount} escaneos</div></td>
                <td>
                  <div class="inline-actions">
                    ${user.role !== "admin" ? `<button class="action-btn compact-btn" data-action="approve-user" data-id="${user.id}" data-approved="${user.approved ? "false" : "true"}">${user.approved ? "Bloquear" : "Aprobar"}</button>` : ""}
                    ${state.currentUser?.id !== user.id
                      ? `<button class="secondary-btn compact-btn" data-action="toggle-user-role" data-id="${user.id}" data-role="${user.role === "admin" ? "user" : "admin"}">${user.role === "admin" ? "Quitar admin" : "Hacer admin"}</button>`
                      : `<span class="muted">Tu cuenta</span>`}
                  </div>
                </td>
              </tr>
            `).join("")
              : `<tr><td colspan="5"><div class="empty-state" style="padding:20px 12px;"><strong>Sin resultados.</strong><div>Prueba otro filtro o termino de busqueda.</div></div></td></tr>`}
          </tbody>
        </table>
      </div>
    </section>
  `;
    })()}
  `;

  const renderAdminPets = () => `
    <section class="grid admin-stack">
      <div class="banner">
        <div>
          <h2 class="section-title section-title-md">Control Global de Mascotas</h2>
          <p class="section-desc">Revisa propietarios, alertas activas y elimina registros incorrectos si hace falta.</p>
        </div>
        <button class="secondary-btn" data-action="refresh-admin">Recargar</button>
      </div>
      <div class="grid pet-grid">
        ${state.adminPets.length
          ? state.adminPets.map((pet) => `
            <article class="card">
              <div class="status ${pet.status}">
                <span class="status-text"><i class="status-dot"></i>${pet.status === "lost" ? "Desaparecido" : "A salvo"}</span>
                <span class="qr-tag">${e(pet.ownerName || "Sin propietario")}</span>
              </div>
              <div class="card-body">
                <div class="pet-head">
                  ${pet.photo
                    ? `<img class="pet-photo" src="${pet.photo}" alt="${e(pet.name)}" />`
                    : `<div class="pet-photo is-empty" aria-label="Sin foto"></div>`}
                  <div class="pet-copy">
                    <strong>${e(pet.name)}</strong>
                    <div class="muted">${e(pet.type)} · ${e(pet.breed)}</div>
                    <div class="muted">${e(pet.ownerEmail || "Sin correo")}</div>
                    <div class="pet-district">📍 ${e(pet.district || "Sin distrito")}</div>
                    <span class="pet-id">ID: ${e(pet.id)}</span>
                  </div>
                </div>
                <div class="actions">
                  <button class="secondary-btn" data-action="admin-toggle-pet-status" data-id="${pet.id}" data-status="${pet.status === "lost" ? "safe" : "lost"}">${pet.status === "lost" ? "Marcar a salvo" : "Reportar perdida"}</button>
                  <button class="danger-btn" data-action="delete-pet" data-id="${pet.id}">Eliminar</button>
                </div>
              </div>
            </article>
          `).join("")
          : `<div class="empty-state"><strong>No hay mascotas registradas.</strong><div>Cuando existan registros apareceran aqui.</div></div>`}
      </div>
    </section>
  `;

  const renderAdminScans = () => `
    <section class="grid admin-stack">
      <div class="banner">
        <div>
          <h2 class="section-title section-title-md">Actividad Global</h2>
          <p class="section-desc">Ultimos escaneos registrados en la plataforma con fecha, mascota y distrito asociado.</p>
        </div>
        <button class="secondary-btn" data-action="refresh-admin">Recargar</button>
      </div>
      <section class="scan-list admin-scan-list">
        ${state.adminScans.length
          ? state.adminScans.map((scan) => `
            <article class="scan-item">
              <div class="scan-name"><span>${e(scan.petName)}</span><span class="scan-time">${e(formatDateTime(scan.createdAt))}</span></div>
              <div class="muted" style="margin-top:8px;">📍 ${e(scan.district || "Sin distrito")}</div>
              <div class="scan-device"><span>${e(scan.device || "Dispositivo desconocido")}</span><span class="scan-mode">${typeof scan.lat === "number" && typeof scan.lon === "number" ? "GPS" : "Sin GPS"}</span></div>
            </article>
          `).join("")
          : `<div class="empty-state"><strong>No hay actividad registrada.</strong><div>Los escaneos globales apareceran aqui.</div></div>`}
      </section>
    </section>
  `;

  const renderProfile = () => {
    if (state.isEditingOwner) {
      return `
      <section class="profile-shell"><div class="profile-body">
        <h2 class="section-title section-title-md">Mi Perfil de Propietario</h2>
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
        <h2 class="section-title section-title-md">Mi Perfil de Propietario</h2>
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
      <h2 class="section-title section-title-md">Inscribir un Nuevo Collar QR</h2>
      <p class="section-desc">Genera la ficha tecnica y asocia un codigo estatico numerico para la placa de tu mascota.</p>
      <div class="form-grid row">
        <div><label>Nombre *</label><input class="field" id="new-name" data-action="new-name" value="${e(state.newPet.name)}" /></div>
        <div><label>Especie</label><select id="new-type" data-action="new-type"><option ${state.newPet.type === "Perro" ? "selected" : ""}>Perro</option><option ${state.newPet.type === "Gato" ? "selected" : ""}>Gato</option><option ${state.newPet.type === "Otro" ? "selected" : ""}>Otro</option></select></div>
        <div><label>Raza</label><input class="field" id="new-breed" data-action="new-breed" value="${e(state.newPet.breed)}" /></div>
        <div><label>Distrito</label><input class="field" id="new-district" data-action="new-district" value="${e(state.newPet.district)}" /></div>
      </div>
      <div class="row"><label>Foto desde galería</label><input class="field" type="file" id="new-photo-file" data-action="new-photo-file" accept="image/*" /></div>
      <div class="photo-preview-shell">
        <span class="photo-preview-label">Vista previa</span>
        ${state.newPetPhotoPreview
          ? `<img class="photo-preview-image" src="${e(state.newPetPhotoPreview)}" alt="Vista previa nueva mascota" />`
          : `<div class="photo-preview-empty">Aun no eliges una imagen</div>`}
      </div>
      <div class="muted">Selecciona una imagen desde tu dispositivo. Se sube al storage automáticamente.</div>
      <div class="row"><label>Vacunas (coma)</label><input class="field" id="new-vaccines" data-action="new-vaccines" value="${e(state.newPet.vaccines)}" /></div>
      <div class="row"><label>Alergias</label><input class="field" id="new-allergies" data-action="new-allergies" value="${e(state.newPet.allergies)}" /></div>
      <div class="row"><label>Cuidados</label><textarea id="new-notes" data-action="new-notes">${e(state.newPet.careNotes)}</textarea></div>
      <div class="actions"><button class="action-btn" data-action="create-pet">Generar Registro QR</button></div>
    </div></section>
  `;

  const renderAlerts = () => `
    <div class="banner">
      <div>
        <h2 class="section-title section-title-md">Rastreo GPS en Tiempo Real</h2>
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

    const hasPhoto = Boolean(pet.photo);

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
          <div class="finder-hero ${hasPhoto ? "" : "is-empty"}">
            ${hasPhoto
              ? `<img src="${pet.photo}" alt="${e(pet.name)}"/>`
              : `<div class="finder-empty-photo"></div>`}
            <div class="finder-overlay ${hasPhoto ? "" : "is-hidden"}"></div>
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

  const renderDashboardSkeleton = () => `
    <section class="loading-shell" aria-hidden="true">
      <div class="skeleton-heading"></div>
      <div class="skeleton-copy"></div>
      <div class="skeleton-grid">
        <article class="skeleton-card"></article>
        <article class="skeleton-card"></article>
        <article class="skeleton-card"></article>
      </div>
    </section>
  `;

  const renderMain = () => {
    ensureAllowedTab();

    if (state.loading && !state.currentUser) {
      return renderDashboardSkeleton();
    }

    if (state.currentView === "finder-view") {
      return renderFinder();
    }

    if (state.activeTab === "admin-overview") return renderAdminOverview();
    if (state.activeTab === "admin-users") return renderAdminUsers();
    if (state.activeTab === "admin-pets") return renderAdminPets();
    if (state.activeTab === "admin-scans") return renderAdminScans();
    if (state.activeTab === "pets") return renderPets();
    if (state.activeTab === "alerts") return renderAlerts();
    if (state.activeTab === "owner-profile") return renderProfile();
    return renderRegister();
  };

  const renderQrModal = () => {
    if (!state.qrPreview) return "";
    return `
      <div class="qr-modal-layer" data-action="close-qr">
        <div class="qr-modal" role="dialog" aria-modal="true" aria-label="QR ampliado" data-action="qr-modal">
          <button class="secondary-btn qr-close" data-action="close-qr">Cerrar</button>
          <img src="${state.qrPreview.src}" alt="QR ampliado ${e(state.qrPreview.id)}" class="qr-modal-image" />
          <div class="qr-modal-id">QR ID: ${e(state.qrPreview.id)}</div>
        </div>
      </div>
    `;
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
    if (ADMIN_TABS.has(String(tab || "")) && !hasAdminAccess()) {
      notify("Acceso restringido al panel administrativo.", "error");
      return;
    }
    state.currentView = view;
    state.activeTab = tab;
    state.sidebarOpen = false;
    render();
  };

  const updateAdminUserInState = (userPayload) => {
    const nextUser = normalizeAdminUser(userPayload);
    const index = state.adminUsers.findIndex((item) => item.id === nextUser.id);
    if (index >= 0) {
      state.adminUsers[index] = { ...state.adminUsers[index], ...nextUser };
    }
    state.adminStats.pendingUsers = state.adminUsers.filter((user) => !user.approved && user.role !== "admin").length;
  };

  const updateAdminPetInState = (petPayload) => {
    const nextPet = normalizeAdminPet(petPayload);
    const index = state.adminPets.findIndex((item) => item.id === nextPet.id);
    if (index >= 0) {
      state.adminPets[index] = { ...state.adminPets[index], ...nextPet };
    } else {
      state.adminPets.unshift(nextPet);
      state.adminStats.totalPets = state.adminPets.length;
    }

    const ownIndex = state.myPets.findIndex((item) => item.id === nextPet.id);
    if (ownIndex >= 0) {
      state.myPets[ownIndex] = { ...state.myPets[ownIndex], ...nextPet };
    }

    const globalIndex = state.pets.findIndex((item) => item.id === nextPet.id);
    if (globalIndex >= 0) {
      state.pets[globalIndex] = { ...state.pets[globalIndex], ...nextPet };
    }

    state.adminStats.lostPets = state.adminPets.filter((pet) => pet.status === "lost").length;
    mergePetsForVisibility(hasAdminAccess() ? state.adminPets : state.pets);
  };

  const savePetEdit = async (petId) => {
    const pet = state.myPets.find((p) => p.id === petId);
    if (!pet) return;

    const payload = {
      name: String(state.tempPetEdit.name || "").trim(),
      type: String(state.tempPetEdit.type || "").trim(),
      breed: String(state.tempPetEdit.breed || "").trim(),
      district: String(state.tempPetEdit.district || "").trim(),
      vaccines: String(state.tempPetEdit.vaccines || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
      allergies: String(state.tempPetEdit.allergies || "").trim(),
      care_notes: String(state.tempPetEdit.careNotes || "").trim()
    };

    const photoFile = state.editPetPhotoFile;

    try {
      if (photoFile && !String(photoFile.type || "").startsWith("image/")) {
        notify("La foto debe ser una imagen valida.", "error");
        return;
      }

      if (photoFile && String(photoFile.dataUrl || "").length > 15 * 1024 * 1024) {
        notify("La imagen supera 10 MB. Usa una foto mas ligera.", "error");
        return;
      }

      if (photoFile) {
        payload.photoFile = photoFile;
      }

      const data = await request(`/api/owner/pets/${encodeURIComponent(petId)}`, {
        method: "PUT",
        body: payload
      });
      const updated = normalizePet(data.pet || payload);
      const ownIndex = state.myPets.findIndex((item) => item.id === petId);
      if (ownIndex >= 0) state.myPets[ownIndex] = updated;
      const globalIndex = state.pets.findIndex((item) => item.id === petId);
      if (globalIndex >= 0) state.pets[globalIndex] = { ...state.pets[globalIndex], ...updated };
      state.editingPetId = null;
      clearPhotoPreview("edit");
      notify("Ficha de mascota actualizada.");
      render();
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const createPet = async () => {
    const name = String(state.newPet.name || "").trim();
    if (!name) {
      notify("El nombre es obligatorio.", "error");
      return;
    }

    const type = String(state.newPet.type || "Perro");
    const breed = String(state.newPet.breed || "").trim() || "Mestizo";
    const district = String(state.newPet.district || "").trim() || "Miraflores";
    const photoFile = state.newPetPhotoFile;
    const vaccinesList = String(state.newPet.vaccines || "")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean);

    const newId = Math.floor(100000 + Math.random() * 900000).toString();

    try {
      if (photoFile && !String(photoFile.type || "").startsWith("image/")) {
        notify("La foto debe ser una imagen valida.", "error");
        return;
      }

      if (photoFile && String(photoFile.dataUrl || "").length > 15 * 1024 * 1024) {
        notify("La imagen supera 10 MB. Usa una foto mas ligera.", "error");
        return;
      }

      const data = await request("/api/owner/pets", {
        method: "POST",
        body: {
          id: newId,
          name,
          type,
          breed,
          district,
          ...(photoFile ? { photoFile } : {}),
          vaccines: vaccinesList,
          allergies: String(state.newPet.allergies || "").trim() || "Ninguna registrada.",
          care_notes: String(state.newPet.careNotes || "").trim() || "Sin notas especiales.",
          status: "safe"
        }
      });

      const created = normalizePet(data.pet || {});
      state.myPets.unshift(created);
      state.pets.unshift(created);
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
      clearPhotoPreview("new");

      state.activeTab = "pets";
      notify(`Mascota registrada. ID ${newId}`);
      render();
    } catch (error) {
      notify(error.message, "error");
    }
  };

  const shareLocation = (petId) => {
    const pet = state.myPets.find((p) => p.id === petId);
    if (!pet) return;

    state.gpsLoading = true;
    state.loading = true;
    render();

    const pushScan = async (lat, lon, device, accuracy = null) => {
      try {
        const data = await request("/api/public/scans", {
          method: "POST",
          includeAuth: false,
          body: {
            petId: pet.id,
            ownerId: pet.ownerId || state.currentUser?.id,
            latitude: lat,
            longitude: lon,
            accuracy,
            note: null,
            device
          }
        });

        const normalizedScan = normalizeScan(
          data.scan || {
            id: `sc-${Date.now()}`,
            petId: pet.id,
            petName: pet.name,
            createdAt: new Date().toISOString(),
            district: `${pet.district} (GPS)`,
            lat,
            lon,
            device,
            isRealGps: true
          },
          { [pet.id]: pet }
        );

        state.scans.unshift(normalizedScan);
        state.currentMapCenter = { lat, lon };
        notify("Ubicacion compartida al propietario.");
      } catch {
        notify("No se pudo registrar el escaneo en backend.", "error");
      } finally {
        state.gpsLoading = false;
        state.loading = state.pendingRequests > 0;
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

    if (ADMIN_ACTIONS.has(action) && !hasAdminAccess()) {
      notify("Acceso restringido al panel administrativo.", "error");
      return;
    }

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
      const pet = state.myPets.find((p) => p.id === target.dataset.id);
      if (!pet) {
        notify("No se encontro la mascota para abrir la vista publica.", "error");
        return;
      }

      const publicUrl = getPublicScanUrl(pet);
      window.open(publicUrl, "_blank", "noopener");
      state.sidebarOpen = false;
      notify("Vista publica abierta en una nueva pestana.");
      render();
      return;
    }

    if (action === "open-qr") {
      openQrPreview(target.dataset.id);
      return;
    }

    if (action === "refresh-admin") {
      loadAdminDashboard()
        .then(() => {
          mergePetsForVisibility(state.adminPets);
          notify("Panel administrativo actualizado.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "close-qr") {
      closeQrPreview();
      return;
    }

    if (action === "qr-modal") {
      return;
    }

    if (action === "toggle-status") {
      const pet = state.myPets.find((p) => p.id === target.dataset.id);
      if (!pet) return;
      const nextStatus = pet.status === "safe" ? "lost" : "safe";
      request(`/api/owner/pets/${encodeURIComponent(pet.id)}/status`, {
        method: "PATCH",
        body: { status: nextStatus }
      })
        .then((data) => {
          const normalized = normalizePet(data.pet || pet);
          pet.status = normalized.status;
          const globalPet = state.pets.find((item) => item.id === pet.id);
          if (globalPet) {
            globalPet.status = normalized.status;
          }
          if (hasAdminAccess()) {
            updateAdminPetInState(normalized);
          }
          notify(pet.status === "lost" ? "Alerta de perdida activada." : "Mascota marcada a salvo.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "approve-user") {
      request(`/api/admin/users/${encodeURIComponent(target.dataset.id)}/approval`, {
        method: "PATCH",
        body: { approved: target.dataset.approved === "true" }
      })
        .then((data) => {
          updateAdminUserInState(data.user || {});
          notify(target.dataset.approved === "true" ? "Usuario aprobado." : "Usuario bloqueado.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "toggle-user-role") {
      request(`/api/admin/users/${encodeURIComponent(target.dataset.id)}/role`, {
        method: "PATCH",
        body: { role: target.dataset.role }
      })
        .then((data) => {
          updateAdminUserInState(data.user || {});
          notify(target.dataset.role === "admin" ? "Usuario promovido a administrador." : "Rol de administrador retirado.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "admin-toggle-pet-status") {
      request(`/api/admin/pets/${encodeURIComponent(target.dataset.id)}/status`, {
        method: "PATCH",
        body: { status: target.dataset.status }
      })
        .then((data) => {
          updateAdminPetInState(data.pet || {});
          notify(target.dataset.status === "lost" ? "Mascota marcada como perdida." : "Mascota marcada a salvo.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "delete-pet") {
      request(`/api/admin/pets/${encodeURIComponent(target.dataset.id)}`, {
        method: "DELETE"
      })
        .then(() => {
          state.adminPets = state.adminPets.filter((pet) => pet.id !== target.dataset.id);
          state.pets = state.pets.filter((pet) => pet.id !== target.dataset.id);
          state.myPets = state.myPets.filter((pet) => pet.id !== target.dataset.id);
          state.adminStats.totalPets = state.adminPets.length;
          state.adminStats.lostPets = state.adminPets.filter((pet) => pet.status === "lost").length;
          notify("Mascota eliminada del sistema.");
          render();
        })
        .catch((error) => notify(error.message, "error"));
      return;
    }

    if (action === "edit-pet") {
      const ownsPet = state.myPets.some((p) => p.id === target.dataset.id);
      if (!ownsPet) {
        notify("Solo puedes editar tus propias mascotas.", "warning");
        return;
      }
      clearPhotoPreview("edit");
      state.editingPetId = target.dataset.id;
      const pet = state.myPets.find((item) => item.id === target.dataset.id);
      state.tempPetEdit = pet
        ? {
            name: pet.name || "",
            type: pet.type || "",
            breed: pet.breed || "",
            district: pet.district || "",
            vaccines: Array.isArray(pet.vaccines) ? pet.vaccines.join(", ") : "",
            allergies: pet.allergies || "",
            careNotes: pet.careNotes || ""
          }
        : {};
      render();
      return;
    }

    if (action === "cancel-edit") {
      state.editingPetId = null;
      state.tempPetEdit = {};
      clearPhotoPreview("edit");
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

  const onInputChange = (event) => {
    const target = event.target.closest("[data-action]");
    if (!target) return;

    const action = target.dataset.action;

    if (action === "admin-users-search") {
      state.adminUserSearch = String(target.value || "");
      render();
      return;
    }

    if (action === "admin-users-filter") {
      state.adminUserFilter = String(target.value || "all");
      render();
      return;
    }

    if (action === "admin-users-sort") {
      state.adminUserSort = String(target.value || "pending-first");
      render();
      return;
    }

    const newPetFields = new Set(["new-name", "new-type", "new-breed", "new-district", "new-vaccines", "new-allergies", "new-notes"]);
    if (newPetFields.has(action)) {
      const nextValue = target.tagName === "SELECT" ? String(target.value || "") : String(target.value || "");
      state.newPet = { ...state.newPet, [
        action === "new-name" ? "name" :
        action === "new-type" ? "type" :
        action === "new-breed" ? "breed" :
        action === "new-district" ? "district" :
        action === "new-vaccines" ? "vaccines" :
        action === "new-allergies" ? "allergies" : "careNotes"
      ]: nextValue };
      return;
    }

    const editPetFields = new Set(["edit-name", "edit-type", "edit-breed", "edit-district", "edit-vaccines", "edit-allergies", "edit-notes"]);
    if (editPetFields.has(action)) {
      const nextValue = String(target.value || "");
      state.tempPetEdit = {
        ...state.tempPetEdit,
        [
          action === "edit-name" ? "name" :
          action === "edit-type" ? "type" :
          action === "edit-breed" ? "breed" :
          action === "edit-district" ? "district" :
          action === "edit-vaccines" ? "vaccines" :
          action === "edit-allergies" ? "allergies" : "careNotes"
        ]: nextValue
      };
      return;
    }

    if (action === "new-photo-file" || action === "edit-photo-file") {
      const file = target.files?.[0] || null;
      const kind = action === "edit-photo-file" ? "edit" : "new";

      if (!file) {
        clearPhotoPreview(kind);
        render();
        return;
      }

      if (!String(file.type || "").startsWith("image/")) {
        notify("La foto debe ser una imagen valida.", "error");
        target.value = "";
        clearPhotoPreview(kind);
        render();
        return;
      }

      if (file.size > MAX_PHOTO_FILE_SIZE) {
        notify("La imagen supera 10 MB. Usa una foto mas ligera.", "error");
        target.value = "";
        clearPhotoPreview(kind);
        render();
        return;
      }

      setPhotoPreview(kind, file)
        .then(() => render())
        .catch((error) => {
          notify(error.message || "No se pudo leer la imagen seleccionada.", "error");
          target.value = "";
          clearPhotoPreview(kind);
          render();
        });
    }
  };

  const render = () => {
    const alertHtml = state.notification
      ? `<div class="alert ${state.notification.type || "success"}">${state.notification.message}</div>`
      : "";

    const globalLoader = state.bootstrapping || state.loading
      ? `
        <div class="global-loader" role="status" aria-live="polite" aria-label="Cargando contenido">
          <div class="global-loader-card">
            <img class="global-loader-logo" src="assets/images/horlogo.png" alt="PetTag" />
            <div class="global-loader-spinner" aria-hidden="true"></div>
            <div class="global-loader-text">Sincronizando informacion...</div>
          </div>
        </div>
      `
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
        ${renderQrModal()}
      </div>
    `;

    app.innerHTML = `${alertHtml}${body}${globalLoader}`;

    if (state.activeTab === "alerts" && state.currentView === "owner-dashboard") {
      initMap();
    }
  };

  app.addEventListener("click", onClick);
  app.addEventListener("input", onInputChange);
  app.addEventListener("change", onInputChange);
  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeQrPreview();
    }
  });
  loadDashboard();
})();
