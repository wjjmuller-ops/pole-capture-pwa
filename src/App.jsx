import React, { useEffect, useMemo, useRef, useState } from "react";

const POSITION_OPTIONS = ["NB Luminaire", "SB Luminaire", "EB Luminaire", "WB Luminaire"];

const INITIAL_LUMINAIRE = {
  position: "NB Luminaire",
  luminaireTypeSerialNo: "",
  photoName: "",
  photoPreview: "",
};

const INITIAL_FORM = {
  poleNumber: "",
  circuitNumber: "",
  poleDescription: "",
  latitude: "",
  longitude: "",
  latLongText: "",
  locationPhotoName: "",
  locationPhotoPreview: "",
  luminaires: [{ ...INITIAL_LUMINAIRE }],
};

const INITIAL_ERRORS = {
  poleNumber: "",
  circuitNumber: "",
  poleDescription: "",
  latitude: "",
  longitude: "",
  luminaires: [],
};

const DB_NAME = "pole-capture-pwa";
const STORE_NAME = "records";
const META_STORE = "meta";
const DB_VERSION = 1;

function flattenPoleRecord(record) {
  const latLong =
    record.latLongText?.trim() ||
    [record.latitude?.trim(), record.longitude?.trim()].filter(Boolean).join(", ");

  return record.luminaires
    .filter((item) => item.position.trim() || item.luminaireTypeSerialNo.trim())
    .map((item) => ({
      "POLE NUMBER": record.poleNumber.trim(),
      POSITION: item.position.trim(),
      "LUMINAIRE TYPE-SERIAL NO": item.luminaireTypeSerialNo.trim(),
      "CIRCUIT NUMBER": record.circuitNumber.trim(),
      "POLE DESCRIPTION": record.poleDescription.trim(),
      "LATITUDE AND LONGITUDE": latLong,
      "LOCATION PHOTO": record.locationPhotoName || "",
      "LUMINAIRE PHOTO": item.photoName || "",
      STATUS: record.syncStatus || "draft",
      "LAST UPDATED": record.updatedAt || "",
    }));
}

function downloadFile(filename, content, mimeType) {
  const blob = new Blob([content], { type: mimeType });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

function toCsv(rows) {
  if (!rows.length) return "";
  const headers = Object.keys(rows[0]);

  const escapeCell = (value) => {
    const stringValue = String(value ?? "");
    if (/[",\n]/.test(stringValue)) {
      return `"${stringValue.replace(/"/g, '""')}"`;
    }
    return stringValue;
  };

  return [
    headers.join(","),
    ...rows.map((row) => headers.map((header) => escapeCell(row[header])).join(",")),
  ].join("\n");
}

function parseLatLong(value) {
  const match = value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean);

  if (match.length >= 2) {
    return { latitude: match[0], longitude: match[1] };
  }

  return { latitude: "", longitude: "" };
}

function openDb() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);

    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: "poleNumber" });
      }
      if (!db.objectStoreNames.contains(META_STORE)) {
        db.createObjectStore(META_STORE, { keyPath: "key" });
      }
    };
  });
}

async function loadAllRecords() {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readonly");
    const request = tx.objectStore(STORE_NAME).getAll();

    request.onsuccess = () =>
      resolve(
        (request.result || []).sort((a, b) =>
          (b.updatedAt || "").localeCompare(a.updatedAt || "")
        )
      );

    request.onerror = () => reject(request.error);
  });
}

async function saveRecordToDb(record) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(record);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function deleteRecordFromDb(poleNumber) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(poleNumber);
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function saveMeta(key, value) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readwrite");
    tx.objectStore(META_STORE).put({ key, value });
    tx.oncomplete = () => resolve(true);
    tx.onerror = () => reject(tx.error);
  });
}

async function loadMeta(key) {
  const db = await openDb();

  return new Promise((resolve, reject) => {
    const tx = db.transaction(META_STORE, "readonly");
    const request = tx.objectStore(META_STORE).get(key);
    request.onsuccess = () => resolve(request.result?.value);
    request.onerror = () => reject(request.error);
  });
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result || ""));
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

function StatCard({ label, value, hint }) {
  return (
    <div className="card stat-card">
      <div className="muted">{label}</div>
      <div className="stat-value">{value}</div>
      {hint ? <div className="small muted">{hint}</div> : null}
    </div>
  );
}

function StatusChip({ status }) {
  const label =
    status === "synced" ? "Synced" : status === "pending" ? "Pending Sync" : "Draft";

  return (
    <span
      className="status-chip"
      style={{
        background:
          status === "synced"
            ? "#dcfce7"
            : status === "pending"
            ? "#fef3c7"
            : "#e2e8f0",
        color:
          status === "synced"
            ? "#166534"
            : status === "pending"
            ? "#92400e"
            : "#334155",
      }}
    >
      {label}
    </span>
  );
}

function SectionCard({
  title,
  subtitle,
  expanded,
  onToggle,
  completed,
  children,
}) {
  return (
    <div className="card">
      <button
        type="button"
        onClick={onToggle}
        className="section-toggle"
        style={{
          width: "100%",
          background: "transparent",
          border: "none",
          padding: 0,
          textAlign: "left",
        }}
      >
        <div className="row-between" style={{ alignItems: "center" }}>
          <div>
            <div style={{ fontSize: "1.1rem", fontWeight: 700 }}>{title}</div>
            {subtitle ? (
              <div className="small muted" style={{ marginTop: "4px" }}>
                {subtitle}
              </div>
            ) : null}
          </div>
          <div style={{ display: "flex", gap: "8px", alignItems: "center" }}>
            {completed ? (
              <span
                className="status-chip"
                style={{ background: "#dcfce7", color: "#166534" }}
              >
                Complete
              </span>
            ) : null}
            <span className="small muted">{expanded ? "Hide" : "Show"}</span>
          </div>
        </div>
      </button>

      {expanded ? <div style={{ marginTop: "16px" }}>{children}</div> : null}
    </div>
  );
}

export default function App() {
  const [form, setForm] = useState(INITIAL_FORM);
  const [records, setRecords] = useState([]);
  const [search, setSearch] = useState("");
  const [message, setMessage] = useState(
    "Capture pole data on site, save drafts locally, and sync later."
  );
  const [activeTab, setActiveTab] = useState("capture");
  const [online, setOnline] = useState(typeof navigator !== "undefined" ? navigator.onLine : true);
  const [deferredPrompt, setDeferredPrompt] = useState(null);
  const [gpsLoading, setGpsLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [lastDraftSavedAt, setLastDraftSavedAt] = useState("");
  const [errors, setErrors] = useState(INITIAL_ERRORS);
  const [expandedSections, setExpandedSections] = useState({
    pole: true,
    location: false,
    luminaires: false,
    review: false,
  });
  const [expandedLuminaires, setExpandedLuminaires] = useState({ 0: true });

  const locationCameraRef = useRef(null);
  const luminaireCameraRefs = useRef([]);

  useEffect(() => {
    loadAllRecords().then(setRecords).catch(() => setMessage("Could not load local records."));

    loadMeta("draftForm")
      .then((draft) => {
        if (draft?.poleNumber || draft?.circuitNumber || draft?.poleDescription) {
          setForm(draft);
        }
      })
      .catch(() => null);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);
    const handleInstallPrompt = (event) => {
      event.preventDefault();
      setDeferredPrompt(event);
    };

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);
    window.addEventListener("beforeinstallprompt", handleInstallPrompt);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("beforeinstallprompt", handleInstallPrompt);
    };
  }, []);

  useEffect(() => {
    saveMeta("draftForm", form).catch(() => null);
  }, [form]);

  const flatRows = useMemo(() => records.flatMap(flattenPoleRecord), [records]);

  const filteredRecords = useMemo(() => {
    const term = search.trim().toLowerCase();
    if (!term) return records;

    return records.filter((record) =>
      [
        record.poleNumber,
        record.circuitNumber,
        record.poleDescription,
        record.latLongText,
        ...record.luminaires.map((item) => `${item.position} ${item.luminaireTypeSerialNo}`),
      ]
        .join(" ")
        .toLowerCase()
        .includes(term)
    );
  }, [records, search]);

  const groupedRecords = useMemo(() => {
    return {
      drafts: filteredRecords.filter((r) => !r.syncStatus || r.syncStatus === "draft"),
      pending: filteredRecords.filter((r) => r.syncStatus === "pending"),
      synced: filteredRecords.filter((r) => r.syncStatus === "synced"),
    };
  }, [filteredRecords]);

  const pendingSyncCount = useMemo(
    () => records.filter((record) => record.syncStatus !== "synced").length,
    [records]
  );

  const totalLuminaires = useMemo(
    () => records.reduce((sum, record) => sum + record.luminaires.length, 0),
    [records]
  );

  const poleComplete =
    form.poleNumber.trim() && form.circuitNumber.trim() && form.poleDescription.trim();

  const locationComplete =
    !!(form.latLongText.trim() || (form.latitude.trim() && form.longitude.trim()));

  const luminairesComplete = form.luminaires.some(
    (item) => item.position.trim() && item.luminaireTypeSerialNo.trim()
  );

  const reviewComplete = poleComplete && locationComplete && luminairesComplete;

  function updateField(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
    setErrors((current) => ({ ...current, [field]: "" }));
  }

  function updateLuminaire(index, field, value) {
    setForm((current) => ({
      ...current,
      luminaires: current.luminaires.map((item, i) =>
        i === index ? { ...item, [field]: value } : item
      ),
    }));

    setErrors((current) => {
      const next = { ...current };
      const nextLuminaireErrors = [...(next.luminaires || [])];
      nextLuminaireErrors[index] = "";
      next.luminaires = nextLuminaireErrors;
      return next;
    });
  }

  function toggleSection(section) {
    setExpandedSections((current) => ({ ...current, [section]: !current[section] }));
  }

  function toggleLuminaire(index) {
    setExpandedLuminaires((current) => ({ ...current, [index]: !current[index] }));
  }

  function openNextSection(nextSection) {
    setExpandedSections((current) => ({ ...current, [nextSection]: true }));
  }

  function addLuminaire() {
    const newIndex = form.luminaires.length;
    setForm((current) => ({
      ...current,
      luminaires: [...current.luminaires, { ...INITIAL_LUMINAIRE }],
    }));
    setExpandedSections((current) => ({ ...current, luminaires: true }));
    setExpandedLuminaires((current) => ({ ...current, [newIndex]: true }));

    setTimeout(() => {
      const element = document.getElementById(`luminaire-card-${newIndex}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
  }

  function duplicateLuminaire(index) {
    const source = form.luminaires[index];
    const duplicate = {
      ...source,
      photoName: "",
      photoPreview: "",
    };

    const newIndex = form.luminaires.length;

    setForm((current) => ({
      ...current,
      luminaires: [...current.luminaires, duplicate],
    }));
    setExpandedLuminaires((current) => ({ ...current, [newIndex]: true }));

    setTimeout(() => {
      const element = document.getElementById(`luminaire-card-${newIndex}`);
      if (element) {
        element.scrollIntoView({ behavior: "smooth", block: "start" });
      }
    }, 80);
  }

  function removeLuminaire(index) {
    setForm((current) => ({
      ...current,
      luminaires:
        current.luminaires.length === 1
          ? [{ ...INITIAL_LUMINAIRE }]
          : current.luminaires.filter((_, i) => i !== index),
    }));

    setExpandedLuminaires((current) => {
      const next = {};
      form.luminaires
        .filter((_, i) => i !== index)
        .forEach((_, i) => {
          next[i] = current[i] ?? false;
        });
      if (Object.keys(next).length === 0) next[0] = true;
      return next;
    });
  }

  function resetForm() {
    setForm(INITIAL_FORM);
    setErrors(INITIAL_ERRORS);
    setExpandedSections({
      pole: true,
      location: false,
      luminaires: false,
      review: false,
    });
    setExpandedLuminaires({ 0: true });
    saveMeta("draftForm", INITIAL_FORM).catch(() => null);
  }

  function validateForm() {
    const nextErrors = {
      poleNumber: "",
      circuitNumber: "",
      poleDescription: "",
      latitude: "",
      longitude: "",
      luminaires: form.luminaires.map(() => ""),
    };

    let hasError = false;

    if (!form.poleNumber.trim()) {
      nextErrors.poleNumber = "Pole number is required.";
      hasError = true;
    }
    if (!form.circuitNumber.trim()) {
      nextErrors.circuitNumber = "Circuit number is required.";
      hasError = true;
    }
    if (!form.poleDescription.trim()) {
      nextErrors.poleDescription = "Pole description is required.";
      hasError = true;
    }
    if (!form.latLongText.trim() && !(form.latitude.trim() && form.longitude.trim())) {
      nextErrors.latitude = "Capture GPS or enter coordinates.";
      nextErrors.longitude = "Capture GPS or enter coordinates.";
      hasError = true;
    }

    const validLuminaireCount = form.luminaires.filter(
      (x) => x.position.trim() && x.luminaireTypeSerialNo.trim()
    ).length;

    if (validLuminaireCount === 0) {
      nextErrors.luminaires[0] = "Add at least one luminaire with position and type / serial.";
      hasError = true;
    }

    form.luminaires.forEach((item, index) => {
      const hasAnyValue = item.position.trim() || item.luminaireTypeSerialNo.trim();
      const isComplete = item.position.trim() && item.luminaireTypeSerialNo.trim();

      if (hasAnyValue && !isComplete) {
        nextErrors.luminaires[index] = "Complete both position and type / serial.";
        hasError = true;
      }
    });

    setErrors(nextErrors);
    return !hasError;
  }

  async function saveDraft() {
    const isValid = validateForm();

    if (!isValid) {
      setMessage("Please fix the highlighted fields before saving.");
      setExpandedSections((current) => ({
        ...current,
        pole: true,
        location: true,
        luminaires: true,
      }));
      return;
    }

    const normalized = {
      ...form,
      poleNumber: form.poleNumber.trim(),
      circuitNumber: form.circuitNumber.trim(),
      poleDescription: form.poleDescription.trim(),
      latitude: form.latitude.trim(),
      longitude: form.longitude.trim(),
      latLongText: form.latLongText.trim(),
      syncStatus: "draft",
      updatedAt: new Date().toISOString(),
      luminaires: form.luminaires
        .map((item) => ({
          position: item.position.trim(),
          luminaireTypeSerialNo: item.luminaireTypeSerialNo.trim(),
          photoName: item.photoName || "",
          photoPreview: item.photoPreview || "",
        }))
        .filter((item) => item.position || item.luminaireTypeSerialNo),
    };

    try {
      await saveRecordToDb(normalized);
      setRecords(await loadAllRecords());
      const savedAt = new Date().toLocaleTimeString([], {
        hour: "2-digit",
        minute: "2-digit",
      });
      setLastDraftSavedAt(savedAt);
      setMessage(`Draft saved for pole ${normalized.poleNumber}.`);
      setActiveTab("saved");
    } catch {
      setMessage("Could not save draft on this device.");
    }
  }

  function loadRecord(record) {
    const latLongParsed =
      !record.latitude && !record.longitude && record.latLongText
        ? parseLatLong(record.latLongText)
        : { latitude: record.latitude, longitude: record.longitude };

    setForm({
      ...record,
      latitude: latLongParsed.latitude || "",
      longitude: latLongParsed.longitude || "",
    });
    setErrors(INITIAL_ERRORS);
    setActiveTab("capture");
    setExpandedSections({
      pole: true,
      location: true,
      luminaires: true,
      review: false,
    });

    const nextExpandedLuminaires = {};
    (record.luminaires || []).forEach((_, index) => {
      nextExpandedLuminaires[index] = index === 0;
    });
    setExpandedLuminaires(nextExpandedLuminaires);
    setMessage(`Loaded ${record.poleNumber} for editing.`);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteRecord(poleNumber) {
    await deleteRecordFromDb(poleNumber);
    setRecords(await loadAllRecords());
    setMessage(`Deleted ${poleNumber}.`);
  }

  function exportCsv() {
    if (!flatRows.length) {
      setMessage("Nothing to export yet.");
      return;
    }

    downloadFile("pole-datasheet-export.csv", toCsv(flatRows), "text/csv;charset=utf-8");
    setMessage("CSV exported in the datasheet-style row structure.");
  }

  function exportJson() {
    if (!records.length) {
      setMessage("Nothing to export yet.");
      return;
    }

    downloadFile(
      "pole-capture-records.json",
      JSON.stringify(records, null, 2),
      "application/json"
    );
    setMessage("JSON exported for ETL or API sync.");
  }

  async function installApp() {
    if (!deferredPrompt) {
      setMessage(
        "Install prompt is not available yet on this browser. On Android, use the Chrome menu."
      );
      return;
    }

    await deferredPrompt.prompt();
    setDeferredPrompt(null);
  }

  function captureGps() {
    if (!navigator.geolocation) {
      setMessage("GPS is not supported on this device/browser.");
      return;
    }

    setGpsLoading(true);

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const latitude = position.coords.latitude.toFixed(6);
        const longitude = position.coords.longitude.toFixed(6);

        setForm((current) => ({
          ...current,
          latitude,
          longitude,
          latLongText: `${latitude}, ${longitude}`,
        }));
        setErrors((current) => ({ ...current, latitude: "", longitude: "" }));
        setGpsLoading(false);
        setMessage("GPS coordinates captured.");
        openNextSection("luminaires");
      },
      () => {
        setGpsLoading(false);
        setMessage("Unable to get GPS coordinates. Check location permission.");
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }

  async function handleLocationPhoto(event) {
    const file = event.target.files?.[0];
    if (!file) return;

    const preview = await fileToDataUrl(file);

    setForm((current) => ({
      ...current,
      locationPhotoName: file.name,
      locationPhotoPreview: preview,
    }));

    setMessage("Location photo attached.");
  }

  async function handleLuminairePhoto(event, index) {
    const file = event.target.files?.[0];
    if (!file) return;

    const preview = await fileToDataUrl(file);

    setForm((current) => ({
      ...current,
      luminaires: current.luminaires.map((item, i) =>
        i === index ? { ...item, photoName: file.name, photoPreview: preview } : item
      ),
    }));

    setMessage(`Luminaire ${index + 1} photo attached.`);
  }

  async function syncNow() {
    if (!online) {
      setMessage("You are offline. Sync will resume when the device is online.");
      return;
    }

    setSyncing(true);

    try {
      const next = records.map((record) =>
        record.syncStatus === "synced"
          ? record
          : { ...record, syncStatus: "synced", syncedAt: new Date().toISOString() }
      );

      await Promise.all(next.map((record) => saveRecordToDb(record)));
      setRecords(await loadAllRecords());
      setMessage(
        "Drafts marked as synced locally. Replace this stub with your real PostgreSQL API endpoint."
      );
    } catch {
      setMessage("Sync failed on this device.");
    } finally {
      setSyncing(false);
    }
  }

  function luminaireSummary(item, index) {
    return `L${index + 1} · ${item.position || "No position"} · ${
      item.luminaireTypeSerialNo || "No type / serial"
    }`;
  }

  function renderRecordGroup(title, items) {
    return (
      <div className="card">
        <div className="row-between" style={{ marginBottom: "12px", alignItems: "center" }}>
          <h2>{title}</h2>
          <span className="status-chip">{items.length}</span>
        </div>

        {items.length === 0 ? (
          <div className="empty-state">No records in this section.</div>
        ) : (
          <div className="record-list">
            {items.map((record) => (
              <button
                key={record.poleNumber}
                type="button"
                className="record-card"
                style={{ textAlign: "left", cursor: "pointer" }}
                onClick={() => loadRecord(record)}
              >
                <div className="row-between align-start">
                  <div>
                    <div className="record-title">{record.poleNumber}</div>
                    <div className="small muted">
                      {record.circuitNumber} · {record.poleDescription}
                    </div>
                    <div className="small muted">
                      {(record.updatedAt || "").replace("T", " ").slice(0, 16)}
                    </div>
                  </div>
                  <StatusChip status={record.syncStatus || "draft"} />
                </div>

                <div className="luminaire-list" style={{ marginTop: "12px" }}>
                  {record.luminaires.map((item, index) => (
                    <div key={`${record.poleNumber}-${index}`} className="luminaire-item">
                      <strong>{item.position}</strong>: {item.luminaireTypeSerialNo || "—"}
                    </div>
                  ))}
                </div>

                <div className="button-group wrap" style={{ marginTop: "12px" }}>
                  <button
                    type="button"
                    className="button small-button secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      loadRecord(record);
                    }}
                  >
                    Edit
                  </button>
                  <button
                    type="button"
                    className="button small-button secondary"
                    onClick={(e) => {
                      e.stopPropagation();
                      deleteRecord(record.poleNumber);
                    }}
                  >
                    Delete
                  </button>
                </div>
              </button>
            ))}
          </div>
        )}
      </div>
    );
  }

  return (
    <div className="app-shell">
      <div className="container">
        <div style={{ display: "flex", gap: "8px", marginBottom: "4px" }}>
          <button
            className={`button ${activeTab === "capture" ? "primary" : "secondary"}`}
            onClick={() => setActiveTab("capture")}
          >
            Capture
          </button>

          <button
            className={`button ${activeTab === "saved" ? "primary" : "secondary"}`}
            onClick={() => setActiveTab("saved")}
          >
            Saved Records
          </button>
        </div>

        <section className="card hero-card">
          <div className="hero-row">
            <div>
              <h1>Pole Data Capture PWA</h1>
              <p className="subtitle">
                Single scrolling capture form with collapsible sections and separate saved records.
              </p>
            </div>

            <div className="button-group wrap">
              <button className="button secondary" onClick={installApp}>
                Install app
              </button>
              <button className="button secondary" onClick={syncNow}>
                {syncing ? "Syncing..." : "Sync now"}
              </button>
            </div>
          </div>

          <div className="notice">{message}</div>

          <div className="status-row" style={{ marginTop: "12px" }}>
            <StatusChip status="draft" />
            <div className={`status-chip ${online ? "status-online" : "status-offline"}`}>
              {online ? "Online" : "Offline"}
            </div>
            <div className="status-chip">Pending sync: {pendingSyncCount}</div>
            <div className="status-chip">
              {lastDraftSavedAt ? `Last draft saved ${lastDraftSavedAt}` : "Draft not saved yet"}
            </div>
          </div>
        </section>

        <section className="stats-grid">
          <StatCard label="Pole records" value={records.length} />
          <StatCard label="Datasheet rows" value={flatRows.length} />
          <StatCard label="Luminaire entries" value={totalLuminaires} hint="Across all saved poles" />
        </section>

        {activeTab === "capture" && (
          <section style={{ display: "grid", gap: "16px" }}>
            <SectionCard
              title="Pole Details"
              subtitle="Pole number, circuit, and description"
              expanded={expandedSections.pole}
              onToggle={() => toggleSection("pole")}
              completed={poleComplete}
            >
              <div className="form-grid">
                <label>
                  <span>Pole number</span>
                  <input
                    value={form.poleNumber}
                    onChange={(e) => updateField("poleNumber", e.target.value)}
                    onBlur={() => {
                      if (poleComplete) openNextSection("location");
                    }}
                    placeholder="N003 3N ZL001"
                  />
                  {errors.poleNumber ? <div className="field-error">{errors.poleNumber}</div> : null}
                </label>

                <label>
                  <span>Circuit number</span>
                  <input
                    value={form.circuitNumber}
                    onChange={(e) => updateField("circuitNumber", e.target.value)}
                    onBlur={() => {
                      if (poleComplete) openNextSection("location");
                    }}
                    placeholder="MS27-1"
                  />
                  {errors.circuitNumber ? (
                    <div className="field-error">{errors.circuitNumber}</div>
                  ) : null}
                </label>

                <label>
                  <span>Pole description</span>
                  <input
                    value={form.poleDescription}
                    onChange={(e) => updateField("poleDescription", e.target.value)}
                    onBlur={() => {
                      if (poleComplete) openNextSection("location");
                    }}
                    placeholder="15m Mid-Hinged Mast"
                  />
                  {errors.poleDescription ? (
                    <div className="field-error">{errors.poleDescription}</div>
                  ) : null}
                </label>
              </div>
            </SectionCard>

            <SectionCard
              title="Location"
              subtitle="Capture GPS coordinates and location photo"
              expanded={expandedSections.location}
              onToggle={() => toggleSection("location")}
              completed={locationComplete}
            >
              <div className="form-grid">
                <div className="two-col">
                  <label>
                    <span>Latitude</span>
                    <input
                      value={form.latitude}
                      onChange={(e) => updateField("latitude", e.target.value)}
                      placeholder="-26.2041"
                    />
                    {errors.latitude ? <div className="field-error">{errors.latitude}</div> : null}
                  </label>

                  <label>
                    <span>Longitude</span>
                    <input
                      value={form.longitude}
                      onChange={(e) => updateField("longitude", e.target.value)}
                      placeholder="28.0473"
                    />
                    {errors.longitude ? (
                      <div className="field-error">{errors.longitude}</div>
                    ) : null}
                  </label>
                </div>

                <label>
                  <span>Latitude and longitude text</span>
                  <input
                    value={form.latLongText}
                    onChange={(e) => updateField("latLongText", e.target.value)}
                    placeholder="Auto-filled by GPS or enter manually"
                  />
                </label>

                <div className="button-group wrap">
                  <button className="button primary" onClick={captureGps}>
                    {gpsLoading ? "Getting GPS..." : "Use current GPS"}
                  </button>

                  <button
                    className="button secondary"
                    onClick={() => locationCameraRef.current?.click()}
                  >
                    Capture location photo
                  </button>

                  <input
                    ref={locationCameraRef}
                    type="file"
                    accept="image/*"
                    capture="environment"
                    className="hidden"
                    onChange={handleLocationPhoto}
                  />
                </div>

                {form.locationPhotoPreview ? (
                  <div className="preview-card">
                    <div className="preview-title">{form.locationPhotoName}</div>
                    <img src={form.locationPhotoPreview} alt="Location preview" />
                  </div>
                ) : null}
              </div>
            </SectionCard>

            <SectionCard
              title="Luminaires"
              subtitle={`${form.luminaires.length} luminaire${form.luminaires.length === 1 ? "" : "s"} captured`}
              expanded={expandedSections.luminaires}
              onToggle={() => toggleSection("luminaires")}
              completed={luminairesComplete}
            >
              <div className="button-group wrap" style={{ marginBottom: "14px" }}>
                <button className="button secondary" onClick={addLuminaire}>
                  Add luminaire
                </button>
              </div>

              <div className="form-grid">
                {form.luminaires.map((item, index) => {
                  const expanded = expandedLuminaires[index] ?? index === 0;
                  return (
                    <div key={index} id={`luminaire-card-${index}`} className="preview-card">
                      <button
                        type="button"
                        onClick={() => toggleLuminaire(index)}
                        style={{
                          width: "100%",
                          background: "transparent",
                          border: "none",
                          padding: 0,
                          textAlign: "left",
                        }}
                      >
                        <div className="row-between" style={{ alignItems: "center" }}>
                          <div className="preview-title">{luminaireSummary(item, index)}</div>
                          <div className="small muted">{expanded ? "Hide" : "Show"}</div>
                        </div>
                      </button>

                      {expanded ? (
                        <div className="form-grid" style={{ marginTop: "14px" }}>
                          <label>
                            <span>Position</span>
                            <select
                              value={item.position}
                              onChange={(e) =>
                                updateLuminaire(index, "position", e.target.value)
                              }
                            >
                              {POSITION_OPTIONS.map((option) => (
                                <option key={option} value={option}>
                                  {option}
                                </option>
                              ))}
                            </select>
                          </label>

                          <label>
                            <span>Luminaire type / serial no</span>
                            <input
                              value={item.luminaireTypeSerialNo}
                              onChange={(e) =>
                                updateLuminaire(
                                  index,
                                  "luminaireTypeSerialNo",
                                  e.target.value
                                )
                              }
                              onBlur={() => {
                                if (luminairesComplete) openNextSection("review");
                              }}
                              placeholder="Genlux II 250W"
                            />
                          </label>

                          {errors.luminaires[index] ? (
                            <div className="field-error">{errors.luminaires[index]}</div>
                          ) : null}

                          <div className="button-group wrap">
                            <button
                              className="button secondary"
                              onClick={() => luminaireCameraRefs.current[index]?.click()}
                            >
                              Capture photo
                            </button>

                            <button
                              className="button secondary"
                              onClick={() => duplicateLuminaire(index)}
                            >
                              Duplicate
                            </button>

                            {form.luminaires.length > 1 ? (
                              <button
                                className="button secondary"
                                onClick={() => removeLuminaire(index)}
                              >
                                Remove
                              </button>
                            ) : null}

                            <input
                              ref={(el) => {
                                luminaireCameraRefs.current[index] = el;
                              }}
                              type="file"
                              accept="image/*"
                              capture="environment"
                              className="hidden"
                              onChange={(e) => handleLuminairePhoto(e, index)}
                            />
                          </div>

                          {item.photoPreview ? (
                            <div className="preview-card">
                              <div className="preview-title">{item.photoName}</div>
                              <img
                                src={item.photoPreview}
                                alt={`Luminaire ${index + 1} preview`}
                              />
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </SectionCard>

            <SectionCard
              title="Review"
              subtitle="Summary before saving the draft"
              expanded={expandedSections.review}
              onToggle={() => toggleSection("review")}
              completed={reviewComplete}
            >
              <div className="review-card">
                <div>
                  <strong>Pole:</strong> {form.poleNumber || "—"}
                </div>
                <div>
                  <strong>Circuit:</strong> {form.circuitNumber || "—"}
                </div>
                <div>
                  <strong>Description:</strong> {form.poleDescription || "—"}
                </div>
                <div>
                  <strong>Coordinates:</strong>{" "}
                  {form.latLongText ||
                    [form.latitude, form.longitude].filter(Boolean).join(", ") ||
                    "—"}
                </div>
                <div>
                  <strong>Location photo:</strong> {form.locationPhotoName || "None"}
                </div>
                <div>
                  <strong>Luminaire count:</strong> {form.luminaires.length}
                </div>

                <div className="review-section-title">Luminaires</div>
                <div className="review-list">
                  {form.luminaires.map((item, index) => (
                    <div key={index} className="review-item">
                      {luminaireSummary(item, index)}
                      {item.photoName ? ` · ${item.photoName}` : ""}
                    </div>
                  ))}
                </div>
              </div>

              <div className="button-group wrap" style={{ marginTop: "14px" }}>
                <button className="button primary" onClick={saveDraft}>
                  Save Draft
                </button>
                <button className="button secondary" onClick={exportJson}>
                  Export JSON
                </button>
                <button className="button secondary" onClick={resetForm}>
                  Clear form
                </button>
              </div>
            </SectionCard>
          </section>
        )}

        {activeTab === "saved" && (
          <section style={{ display: "grid", gap: "16px" }}>
            <div className="card">
              <div className="row-between" style={{ marginBottom: "12px" }}>
                <div>
                  <h2>Saved Records</h2>
                  <p className="small muted">Grouped by draft, pending sync, and synced.</p>
                </div>
              </div>

              <input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search records..."
              />
            </div>

            {renderRecordGroup("Drafts", groupedRecords.drafts)}
            {renderRecordGroup("Pending Sync", groupedRecords.pending)}
            {renderRecordGroup("Synced", groupedRecords.synced)}

            <div className="card">
              <h2>Export & Sync</h2>
              <p className="small muted" style={{ marginTop: "4px" }}>
                Flattened row structure for downstream PostgreSQL import.
              </p>

              <div className="button-group wrap" style={{ marginTop: "14px" }}>
                <button className="button secondary" onClick={exportCsv}>
                  Export CSV
                </button>
                <button className="button secondary" onClick={exportJson}>
                  Export JSON
                </button>
                <button className="button secondary" onClick={syncNow}>
                  {syncing ? "Syncing..." : "Sync now"}
                </button>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      {Object.keys(
                        flatRows[0] || {
                          "POLE NUMBER": "",
                          POSITION: "",
                          "LUMINAIRE TYPE-SERIAL NO": "",
                          "CIRCUIT NUMBER": "",
                          "POLE DESCRIPTION": "",
                          "LATITUDE AND LONGITUDE": "",
                          "LOCATION PHOTO": "",
                          "LUMINAIRE PHOTO": "",
                          STATUS: "",
                          "LAST UPDATED": "",
                        }
                      ).map((header) => (
                        <th key={header}>{header}</th>
                      ))}
                    </tr>
                  </thead>

                  <tbody>
                    {flatRows.length === 0 ? (
                      <tr>
                        <td colSpan={10} className="muted">
                          No export rows yet.
                        </td>
                      </tr>
                    ) : (
                      flatRows.slice(0, 8).map((row, index) => (
                        <tr key={index}>
                          {Object.values(row).map((value, cellIndex) => (
                            <td key={cellIndex}>{String(value)}</td>
                          ))}
                        </tr>
                      ))
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </section>
        )}
      </div>

      {activeTab === "capture" && (
        <div className="sticky-bar">
          <div className="sticky-inner">
            <button className="button secondary grow" onClick={addLuminaire}>
              Add Luminaire
            </button>
            <button className="button primary grow-lg" onClick={saveDraft}>
              Save Draft
            </button>
          </div>
        </div>
      )}

      {activeTab === "saved" && (
        <div className="sticky-bar">
          <div className="sticky-inner">
            <button className="button secondary grow" onClick={() => setActiveTab("capture")}>
              New Capture
            </button>
            <button className="button primary grow-lg" onClick={exportCsv}>
              Export CSV
            </button>
          </div>
        </div>
      )}
    </div>
  );
}