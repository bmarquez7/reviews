import { createClient } from "../shared/vendor.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, EVENT_IMAGE_BUCKET } from "../shared/config.js";

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const loginGate = document.getElementById("login-gate");
const protectedApp = document.getElementById("protected-app");
const loginForm = document.getElementById("login-form");
const loginStatus = document.getElementById("login-status");
const adminTools = document.getElementById("admin-tools");
const logoutButton = document.getElementById("logout");
const refreshButton = document.getElementById("refresh");
const adminCount = document.getElementById("admin-count");
const adminTableBody = document.querySelector("#admin-table tbody");
const editForm = document.getElementById("edit-form");
const editStatus = document.getElementById("edit-status");
const newEventButton = document.getElementById("new-event");
const batchForm = document.getElementById("batch-form");
const batchStatus = document.getElementById("batch-status");

let currentEvents = [];
let selectedId = null;

function setStatus(element, message) {
  element.style.display = "block";
  element.textContent = message;
}

function sanitizeFilename(name) {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function uploadEventImage(file, folder) {
  const safeName = sanitizeFilename(file.name || "poster.jpg");
  const path = `${folder}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}-${safeName}`;
  const { error } = await client.storage.from(EVENT_IMAGE_BUCKET).upload(path, file, {
    cacheControl: "3600",
    upsert: false
  });
  if (error) throw error;
  const { data } = client.storage.from(EVENT_IMAGE_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

function setAuthUi(session) {
  const isAuthed = Boolean(session);
  loginGate.classList.toggle("hidden", isAuthed);
  protectedApp.classList.toggle("hidden", !isAuthed);
  adminTools.classList.toggle("hidden", !isAuthed);
  if (!isAuthed) {
    adminCount.textContent = "0 events";
    adminTableBody.innerHTML = "";
    selectedId = null;
    editForm.reset();
    batchForm.reset();
  }
}

async function ensureSession() {
  const { data } = await client.auth.getSession();
  setAuthUi(data.session);
  return data.session;
}

async function signIn(email, password) {
  const { error } = await client.auth.signInWithPassword({ email, password });
  if (error) {
    setStatus(loginStatus, error.message);
    return;
  }
  setStatus(loginStatus, "Signed in.");
  await loadEvents();
}

async function signOut() {
  await client.auth.signOut();
  setStatus(loginStatus, "Signed out.");
}

function fillEditForm(event) {
  selectedId = event.id;
  editForm.title_en.value = event.title_en || "";
  editForm.title_es.value = event.title_es || "";
  editForm.title_sq.value = event.title_sq || "";
  editForm.description_en.value = event.description_en || "";
  editForm.description_es.value = event.description_es || "";
  editForm.description_sq.value = event.description_sq || "";
  editForm.location_en.value = event.location_en || "";
  editForm.location_es.value = event.location_es || "";
  editForm.location_sq.value = event.location_sq || "";
  editForm.event_type.value = event.event_type || "";
  editForm.area.value = event.area || "";
  editForm.event_language.value = (event.event_language || []).join(",");
  editForm.date_start.value = event.date_start ? event.date_start.slice(0, 16) : "";
  editForm.date_end.value = event.date_end ? event.date_end.slice(0, 16) : "";
  editForm.repeat_frequency.value = "none";
  editForm.repeat_until.value = "";
  editForm.status.value = event.status || "pending";
  editForm.price_type.value = event.price_type || "";
  editForm.price_min.value = event.price_min || "";
  editForm.price_max.value = event.price_max || "";
  editForm.currency.value = event.currency || "";
  editForm.ticket_url.value = event.ticket_url || "";
  editForm.event_image_url.value = event.event_image_url || "";
}

function clearFormForNew() {
  selectedId = null;
  editForm.reset();
  editForm.repeat_frequency.value = "none";
  editForm.repeat_until.value = "";
  editForm.status.value = "approved";
  editForm.price_type.value = "Paid";
  editForm.currency.value = "ALL";
  setStatus(editStatus, "Creating a new event.");
}

function toPayload(formData) {
  return {
    title_en: formData.get("title_en") || "",
    title_es: formData.get("title_es") || null,
    title_sq: formData.get("title_sq") || null,
    description_en: formData.get("description_en") || "",
    description_es: formData.get("description_es") || null,
    description_sq: formData.get("description_sq") || null,
    location_en: formData.get("location_en") || null,
    location_es: formData.get("location_es") || null,
    location_sq: formData.get("location_sq") || null,
    event_type: formData.get("event_type") || "Community",
    area: formData.get("area") || "Skanderbeg Square",
    event_language: (formData.get("event_language") || "en")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    date_start: formData.get("date_start") || null,
    date_end: formData.get("date_end") || null,
    repeat_frequency: formData.get("repeat_frequency") || "none",
    repeat_until: formData.get("repeat_until") || null,
    status: formData.get("status") || "approved",
    price_type: formData.get("price_type") || "Paid",
    price_min: formData.get("price_min") || null,
    price_max: formData.get("price_max") || null,
    currency: formData.get("currency") || "ALL",
    ticket_url: formData.get("ticket_url") || null,
    event_image_url: formData.get("event_image_url") || null
  };
}

function addByFrequency(date, frequency) {
  const next = new Date(date);
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  return next;
}

function buildRecurringRows(payload) {
  const frequency = payload.repeat_frequency || "none";
  const untilRaw = payload.repeat_until;
  if (frequency === "none" || !untilRaw) {
    const single = { ...payload };
    delete single.repeat_frequency;
    delete single.repeat_until;
    return [single];
  }

  const start = new Date(payload.date_start);
  if (Number.isNaN(start.getTime())) {
    return [];
  }

  const end = payload.date_end ? new Date(payload.date_end) : null;
  const durationMs = end && !Number.isNaN(end.getTime()) ? end.getTime() - start.getTime() : null;
  const until = new Date(`${untilRaw}T23:59:59`);
  if (Number.isNaN(until.getTime()) || until < start) {
    return [];
  }

  const rows = [];
  let currentStart = new Date(start);
  let guard = 0;
  while (currentStart <= until && guard < 500) {
    const row = { ...payload };
    row.date_start = currentStart.toISOString();
    row.date_end = durationMs !== null ? new Date(currentStart.getTime() + durationMs).toISOString() : null;
    delete row.repeat_frequency;
    delete row.repeat_until;
    rows.push(row);
    currentStart = addByFrequency(currentStart, frequency);
    guard += 1;
  }
  return rows;
}

async function saveEvent(payload) {
  if (!payload.title_en || !payload.description_en || !payload.date_start) {
    setStatus(editStatus, "Title, description, and date_start are required.");
    return;
  }

  let query;
  if (selectedId) {
    const updatePayload = { ...payload };
    delete updatePayload.repeat_frequency;
    delete updatePayload.repeat_until;
    query = client.from("events").update(updatePayload).eq("id", selectedId);
  } else {
    const recurringRows = buildRecurringRows(payload).map((row) => ({
      ...row,
      status: row.status || "approved"
    }));
    if (!recurringRows.length) {
      setStatus(editStatus, "Invalid recurring settings. Check repeat frequency and end date.");
      return;
    }
    query = client.from("events").insert(recurringRows);
  }

  const { error } = await query;
  if (error) {
    setStatus(editStatus, error.message);
    return;
  }

  setStatus(editStatus, selectedId ? "Saved." : "Created recurring event set.");
  await loadEvents();
}

async function updateStatus(id, status) {
  const { error } = await client.from("events").update({ status }).eq("id", id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadEvents();
}

async function deleteEvent(id) {
  const { error } = await client.from("events").delete().eq("id", id);
  if (error) {
    alert(error.message);
    return;
  }
  await loadEvents();
}

function renderTable() {
  adminTableBody.innerHTML = "";
  adminCount.textContent = `${currentEvents.length} events`;

  currentEvents.forEach((event) => {
    const row = document.createElement("tr");
    row.innerHTML = `
      <td>${event.title_en || "Untitled"}</td>
      <td><span class="status-pill">${event.status}</span></td>
      <td>${event.date_start ? new Date(event.date_start).toLocaleString() : ""}</td>
      <td>${event.area || ""}</td>
      <td>${event.event_type || ""}</td>
      <td></td>
    `;

    const actionsCell = row.querySelector("td:last-child");
    const approve = document.createElement("button");
    approve.textContent = "Approve";
    approve.addEventListener("click", () => updateStatus(event.id, "approved"));

    const hold = document.createElement("button");
    hold.textContent = "Hold";
    hold.className = "secondary";
    hold.addEventListener("click", () => updateStatus(event.id, "pending"));

    const edit = document.createElement("button");
    edit.textContent = "Edit";
    edit.className = "secondary";
    edit.addEventListener("click", () => fillEditForm(event));

    const remove = document.createElement("button");
    remove.textContent = "Delete";
    remove.className = "secondary";
    remove.addEventListener("click", () => deleteEvent(event.id));

    actionsCell.append(approve, hold, edit, remove);
    adminTableBody.appendChild(row);
  });
}

async function loadEvents() {
  const session = await ensureSession();
  if (!session) return;

  const { data, error } = await client.from("events").select("*").order("date_start", { ascending: true });
  if (error) {
    setStatus(loginStatus, `Load failed: ${error.message}`);
    return;
  }

  currentEvents = data || [];
  renderTable();
}

function parseBatchLine(line) {
  const [
    title,
    description,
    location,
    event_type,
    area,
    date_start,
    date_end,
    languages,
    price_type,
    price_min,
    price_max,
    status,
    ticket_url,
    event_image_url
  ] = line.split("|").map((v) => v.trim());

  if (!title || !description || !event_type || !area || !date_start) {
    return null;
  }

  return {
    title_en: title,
    description_en: description,
    location_en: location || null,
    event_type,
    area,
    date_start,
    date_end: date_end || null,
    event_language: (languages || "en")
      .split(",")
      .map((v) => v.trim())
      .filter(Boolean),
    price_type: price_type || "Paid",
    price_min: price_min || null,
    price_max: price_max || null,
    status: status || "pending",
    currency: "ALL",
    ticket_url: ticket_url || null,
    event_image_url: event_image_url || null
  };
}

async function batchInsert(raw) {
  const session = await ensureSession();
  if (!session) {
    setStatus(batchStatus, "Please sign in first.");
    return;
  }

  const lines = raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));

  const mapped = lines.map(parseBatchLine);
  const validRows = mapped.filter(Boolean);
  const skipped = mapped.length - validRows.length;

  if (!validRows.length) {
    setStatus(batchStatus, "No valid rows found.");
    return;
  }

  const { error } = await client.from("events").insert(validRows);
  if (error) {
    setStatus(batchStatus, error.message);
    return;
  }

  setStatus(batchStatus, `Inserted ${validRows.length} events. Skipped ${skipped} invalid line(s).`);
  await loadEvents();
}

loginForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(loginForm);
  await signIn(formData.get("email"), formData.get("password"));
});

logoutButton.addEventListener("click", signOut);
refreshButton.addEventListener("click", loadEvents);

editForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(editForm);
  const selectedFile = formData.get("event_image_file");
  if (selectedFile && selectedFile.size > 0) {
    try {
      const uploadedUrl = await uploadEventImage(selectedFile, "admin");
      formData.set("event_image_url", uploadedUrl);
    } catch (uploadError) {
      setStatus(editStatus, `Image upload failed: ${uploadError.message}`);
      return;
    }
  }
  const payload = toPayload(formData);
  await saveEvent(payload);
});

batchForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const formData = new FormData(batchForm);
  await batchInsert(formData.get("batch_rows") || "");
});

newEventButton.addEventListener("click", (event) => {
  event.preventDefault();
  clearFormForNew();
});

client.auth.onAuthStateChange(async (_evt, session) => {
  setAuthUi(session);
  if (session) {
    await loadEvents();
  }
});

ensureSession().then((session) => {
  if (session) {
    loadEvents();
  }
});
