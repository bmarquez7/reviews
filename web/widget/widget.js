import { createClient } from "../shared/vendor.js";
import { SUPABASE_URL, SUPABASE_ANON_KEY, DEFAULT_UI_LANG, EVENT_IMAGE_BUCKET } from "../shared/config.js";
import { EVENT_TYPES, PRICE_TYPES, AREAS, LANGS } from "../shared/constants.js";

const client = createClient(SUPABASE_URL, SUPABASE_ANON_KEY);

const state = {
  events: [],
  uiLang: DEFAULT_UI_LANG,
  viewMode: "list",
  calendarDate: new Date(),
  weekStart: null,
  filters: {
    search: "",
    eventType: "",
    area: "",
    eventLanguage: "",
    dateFrom: "",
    dateTo: "",
    sort: "date_asc"
  }
};

const uiStrings = {
  en: {
    title: "Tirana Events Calendar",
    subtitle: "Discover culture, community, and nightlife across Tirana. Filter by area, type, language, date, and price.",
    submitTitle: "Submit an event",
    submitSubtitle: "Submissions are reviewed before going live.",
    filters: {
      search: "Search",
      eventType: "Event type",
      area: "Area",
      eventLanguage: "Event language",
      dateFrom: "From",
      dateTo: "To",
      sort: "Sort"
    },
    sortOptions: {
      date_asc: "Date (soonest)",
      date_desc: "Date (latest)",
      price_asc: "Price (lowest)",
      price_desc: "Price (highest)"
    },
    reset: "Reset filters",
    results: "events"
  },
  es: {
    title: "Calendario de eventos de Tirana",
    subtitle: "Descubre cultura, comunidad y vida nocturna en Tirana. Filtra por zona, tipo, idioma, fecha y precio.",
    submitTitle: "Enviar un evento",
    submitSubtitle: "Las propuestas se revisan antes de publicarse.",
    filters: {
      search: "Buscar",
      eventType: "Tipo de evento",
      area: "Zona",
      eventLanguage: "Idioma del evento",
      dateFrom: "Desde",
      dateTo: "Hasta",
      sort: "Ordenar"
    },
    sortOptions: {
      date_asc: "Fecha (próxima)",
      date_desc: "Fecha (más tarde)",
      price_asc: "Precio (más bajo)",
      price_desc: "Precio (más alto)"
    },
    reset: "Restablecer filtros",
    results: "eventos"
  },
  sq: {
    title: "Kalendari i eventeve në Tiranë",
    subtitle: "Zbuloni kulturë, komunitet dhe jetë nate në Tiranë. Filtroni sipas zonës, llojit, gjuhës, datës dhe çmimit.",
    submitTitle: "Dërgoni një event",
    submitSubtitle: "Propozimet shqyrtohen para publikimit.",
    filters: {
      search: "Kërko",
      eventType: "Lloji i eventit",
      area: "Zona",
      eventLanguage: "Gjuha e eventit",
      dateFrom: "Nga",
      dateTo: "Deri",
      sort: "Renditja"
    },
    sortOptions: {
      date_asc: "Data (më e afërt)",
      date_desc: "Data (më e vonshme)",
      price_asc: "Çmimi (më i ulët)",
      price_desc: "Çmimi (më i lartë)"
    },
    reset: "Pastro filtrat",
    results: "evente"
  }
};

const filterControls = document.getElementById("filter-controls");
const eventList = document.getElementById("event-list");
const resultsCount = document.getElementById("results-count");
const resetFilters = document.getElementById("reset-filters");
const submitForm = document.getElementById("submit-form");
const submitStatus = document.getElementById("submit-status");
const viewControls = document.getElementById("view-controls");
const calendarView = document.getElementById("calendar-view");
const repeatFrequencyInput = submitForm.querySelector("select[name='repeat_frequency']");
const repeatUntilInput = submitForm.querySelector("input[name='repeat_until']");
repeatUntilInput.required = false;
const eventModal = document.getElementById("event-modal");
const modalBody = document.getElementById("modal-body");
const modalClose = document.getElementById("modal-close");

state.weekStart = startOfWeek(new Date());

function pickText(row, base) {
  const key = `${base}_${state.uiLang}`;
  return row[key] || row[`${base}_en`] || row[base] || "";
}

function formatDateRange(start, end) {
  const startDate = start ? new Date(start) : null;
  const endDate = end ? new Date(end) : null;
  if (!startDate) return "";
  const datePart = startDate.toLocaleDateString(state.uiLang, { dateStyle: "medium" });
  const timePart = startDate.toLocaleTimeString(state.uiLang, { timeStyle: "short" });
  if (!endDate) return `${datePart} · ${timePart}`;
  const endPart = endDate.toLocaleTimeString(state.uiLang, { timeStyle: "short" });
  return `${datePart} · ${timePart} → ${endPart}`;
}

function formatPrice(row) {
  if (row.price_type === "Free") return "Free";
  const min = row.price_min ?? "";
  const max = row.price_max ?? "";
  if (!min && !max) return row.price_type || "Paid";
  if (min && max) return `${min}–${max} ${row.currency || "ALL"}`;
  return `${min || max} ${row.currency || "ALL"}`;
}

function openModal(html) {
  modalBody.innerHTML = html;
  eventModal.classList.remove("hidden");
}

function closeModal() {
  eventModal.classList.add("hidden");
  modalBody.innerHTML = "";
}

function eventDetailHtml(event) {
  const title = pickText(event, "title") || "Untitled";
  const description = pickText(event, "description") || "";
  const location = pickText(event, "location") || event.area || "";
  const date = formatDateRange(event.date_start, event.date_end);
  const languages = (event.event_language || []).join(", ");
  const price = formatPrice(event);
  const link = event.ticket_url
    ? `<p><a href="${event.ticket_url}" target="_blank" rel="noreferrer">Tickets / RSVP</a></p>`
    : "";
  const image = event.event_image_url
    ? `<img class="modal-poster" src="${event.event_image_url}" alt="${title}" loading="lazy" />`
    : "";

  return `
    <h3 id="modal-title">${title}</h3>
    ${image}
    <p>${description}</p>
    <div class="meta">
      <span>Location: ${location}</span>
      <span>Date: ${date}</span>
      <span>Type: ${event.event_type || ""}</span>
      <span>Languages: ${languages}</span>
      <span>Price: ${price}</span>
    </div>
    ${link}
  `;
}

function openDayModal(date, events) {
  const dayLabel = date.toLocaleDateString(state.uiLang, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
  if (!events.length) {
    openModal(`<h3 id="modal-title">${dayLabel}</h3><p>No events for this day.</p>`);
    return;
  }

  const items = events
    .map(
      (event) => `
      <div class="modal-event" data-event-id="${event.id}">
        <h4>${pickText(event, "title") || "Untitled"}</h4>
        ${event.event_image_url ? `<img class="modal-poster" src="${event.event_image_url}" alt="${pickText(event, "title") || "Event"}" loading="lazy" />` : ""}
        <p>${formatDateRange(event.date_start, event.date_end)}</p>
        <p>${pickText(event, "location") || event.area || ""}</p>
      </div>
    `
    )
    .join("");

  openModal(`<h3 id="modal-title">${dayLabel}</h3>${items}`);
  modalBody.querySelectorAll(".modal-event").forEach((el) => {
    el.addEventListener("click", () => {
      const target = events.find((evt) => String(evt.id) === el.dataset.eventId);
      if (target) openModal(eventDetailHtml(target));
    });
  });
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

function toDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function startOfWeek(date) {
  const result = new Date(date);
  const day = (result.getDay() + 6) % 7;
  result.setDate(result.getDate() - day);
  result.setHours(0, 0, 0, 0);
  return result;
}

function addDays(date, days) {
  const result = new Date(date);
  result.setDate(result.getDate() + days);
  return result;
}

function addByFrequency(date, frequency) {
  const next = new Date(date);
  if (frequency === "daily") next.setDate(next.getDate() + 1);
  if (frequency === "weekly") next.setDate(next.getDate() + 7);
  if (frequency === "monthly") next.setMonth(next.getMonth() + 1);
  return next;
}

function buildRecurringRows(payload, repeatFrequency, repeatUntil) {
  if (repeatFrequency === "none") return [payload];
  if (!repeatUntil) return [];

  const start = new Date(payload.date_start);
  const end = new Date(payload.date_end);
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) return [];
  const durationMs = end.getTime() - start.getTime();
  if (durationMs < 0) return [];

  const until = new Date(`${repeatUntil}T23:59:59`);
  if (Number.isNaN(until.getTime()) || until < start) return [];

  const rows = [];
  let currentStart = new Date(start);
  let guard = 0;
  while (currentStart <= until && guard < 500) {
    const rowStart = new Date(currentStart);
    const rowEnd = new Date(currentStart.getTime() + durationMs);
    rows.push({
      ...payload,
      date_start: rowStart.toISOString(),
      date_end: rowEnd.toISOString()
    });
    currentStart = addByFrequency(currentStart, repeatFrequency);
    guard += 1;
  }
  return rows;
}

function createSelect(name, labelText, options, includeAny = true) {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const label = document.createElement("label");
  label.textContent = labelText;
  const select = document.createElement("select");
  select.name = name;
  if (includeAny) {
    const opt = document.createElement("option");
    opt.value = "";
    opt.textContent = "All";
    select.appendChild(opt);
  }
  options.forEach((option) => {
    const opt = document.createElement("option");
    opt.value = option.value ?? option;
    opt.textContent = option.label ?? option;
    select.appendChild(opt);
  });
  select.addEventListener("change", (event) => {
    state.filters[name] = event.target.value;
    render();
  });
  wrap.append(label, select);
  return wrap;
}

function createInput(name, labelText, type = "text", placeholder = "") {
  const wrap = document.createElement("div");
  wrap.className = "control";
  const label = document.createElement("label");
  label.textContent = labelText;
  const input = document.createElement("input");
  input.type = type;
  input.name = name;
  input.placeholder = placeholder;
  input.addEventListener("input", (event) => {
    state.filters[name] = event.target.value;
    render();
  });
  wrap.append(label, input);
  return wrap;
}

function renderFilters() {
  filterControls.innerHTML = "";
  const strings = uiStrings[state.uiLang];
  filterControls.append(
    createInput("search", strings.filters.search, "text", "Search titles and descriptions"),
    createSelect("eventType", strings.filters.eventType, EVENT_TYPES.map((t) => ({ value: t, label: t }))),
    createSelect("area", strings.filters.area, AREAS.map((a) => ({ value: a, label: a }))),
    createSelect("eventLanguage", strings.filters.eventLanguage, LANGS.map((l) => ({ value: l.code, label: l.label }))),
    createInput("dateFrom", strings.filters.dateFrom, "date"),
    createInput("dateTo", strings.filters.dateTo, "date"),
    createSelect("sort", strings.filters.sort, Object.entries(strings.sortOptions).map(([value, label]) => ({ value, label })), false)
  );

  const langSelect = createSelect("uiLang", "UI language", LANGS, false);
  langSelect.querySelector("select").value = state.uiLang;
  langSelect.querySelector("select").addEventListener("change", (event) => {
    state.uiLang = event.target.value;
    syncUiCopy();
    renderFilters();
    render();
  });
  filterControls.appendChild(langSelect);
}

function filterEvents() {
  const { search, eventType, area, eventLanguage, dateFrom, dateTo } = state.filters;
  return state.events
    .filter((event) => {
      const searchText = `${pickText(event, "title")} ${pickText(event, "description")}`.toLowerCase();
      const matchesSearch = !search || searchText.includes(search.toLowerCase());
      const matchesType = !eventType || event.event_type === eventType;
      const matchesArea = !area || event.area === area;
      const matchesLanguage = !eventLanguage || (event.event_language || []).includes(eventLanguage);
      const startDate = event.date_start ? new Date(event.date_start) : null;
      const matchesFrom = !dateFrom || (startDate && startDate >= new Date(dateFrom));
      const matchesTo = !dateTo || (startDate && startDate <= new Date(dateTo));
      return matchesSearch && matchesType && matchesArea && matchesLanguage && matchesFrom && matchesTo;
    })
    .sort((a, b) => {
      const sort = state.filters.sort;
      if (sort === "price_asc") return (a.price_min ?? 0) - (b.price_min ?? 0);
      if (sort === "price_desc") return (b.price_min ?? 0) - (a.price_min ?? 0);
      if (sort === "date_desc") return new Date(b.date_start || 0) - new Date(a.date_start || 0);
      return new Date(a.date_start || 0) - new Date(b.date_start || 0);
    });
}

function renderEvents() {
  const events = filterEvents();
  eventList.innerHTML = "";
  resultsCount.textContent = `${events.length} ${uiStrings[state.uiLang].results}`;
  if (!events.length) {
    const empty = document.createElement("div");
    empty.className = "notice";
    empty.textContent = "No events match these filters yet.";
    eventList.appendChild(empty);
    return;
  }

  events.forEach((event) => {
    const card = document.createElement("div");
    card.className = "card";
    const title = document.createElement("h3");
    title.textContent = pickText(event, "title");
    const desc = document.createElement("p");
    desc.textContent = pickText(event, "description");
    const image = document.createElement("img");
    if (event.event_image_url) {
      image.className = "event-poster";
      image.src = event.event_image_url;
      image.alt = pickText(event, "title") || "Event";
      image.loading = "lazy";
    }
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.innerHTML = `
      <span>📍 ${pickText(event, "location") || event.area}</span>
      <span>🗓️ ${formatDateRange(event.date_start, event.date_end)}</span>
      <span>🏷️ ${event.event_type}</span>
      <span>💬 ${(event.event_language || []).join(", ")}</span>
      <span>💰 ${formatPrice(event)}</span>
    `;

    const actions = document.createElement("div");
    if (event.ticket_url) {
      const link = document.createElement("a");
      link.href = event.ticket_url;
      link.target = "_blank";
      link.rel = "noreferrer";
      link.textContent = "Tickets / RSVP";
      link.style.color = "var(--brand)";
      link.addEventListener("click", (eventObject) => eventObject.stopPropagation());
      actions.appendChild(link);
    }

    if (event.event_image_url) {
      card.append(title, image, desc, meta, actions);
    } else {
      card.append(title, desc, meta, actions);
    }
    card.addEventListener("click", () => openModal(eventDetailHtml(event)));
    eventList.appendChild(card);
  });
}

function groupEventsByDate(events) {
  return events.reduce((acc, event) => {
    if (!event.date_start) return acc;
    const key = toDateKey(new Date(event.date_start));
    if (!acc[key]) acc[key] = [];
    acc[key].push(event);
    return acc;
  }, {});
}

function renderCalendarMonth(events) {
  calendarView.innerHTML = "";
  const grouped = groupEventsByDate(events);
  const monthStart = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth(), 1);
  const monthEnd = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 0);
  const gridStart = startOfWeek(monthStart);
  const days = [];
  for (let i = 0; i < 42; i += 1) {
    days.push(addDays(gridStart, i));
  }

  const wrapper = document.createElement("div");
  wrapper.className = "calendar";
  const header = document.createElement("div");
  header.className = "calendar-header";
  const title = document.createElement("h3");
  title.textContent = monthStart.toLocaleDateString(state.uiLang, { month: "long", year: "numeric" });
  const nav = document.createElement("div");
  nav.className = "admin-bar";
  const prev = document.createElement("button");
  prev.className = "secondary";
  prev.textContent = "←";
  prev.addEventListener("click", () => {
    state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() - 1, 1);
    render();
  });
  const next = document.createElement("button");
  next.className = "secondary";
  next.textContent = "→";
  next.addEventListener("click", () => {
    state.calendarDate = new Date(state.calendarDate.getFullYear(), state.calendarDate.getMonth() + 1, 1);
    render();
  });
  nav.append(prev, next);
  header.append(title, nav);

  const grid = document.createElement("div");
  grid.className = "calendar-grid";
  const dayNames = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  dayNames.forEach((day) => {
    const el = document.createElement("div");
    el.className = "calendar-day";
    el.textContent = day;
    grid.appendChild(el);
  });

  days.forEach((date) => {
    const key = toDateKey(date);
    const cell = document.createElement("div");
    cell.className = "calendar-cell";
    if (date < monthStart || date > monthEnd) cell.classList.add("inactive");
    const dateLabel = document.createElement("div");
    dateLabel.className = "calendar-date";
    dateLabel.textContent = date.getDate();
    const eventsWrap = document.createElement("div");
    eventsWrap.className = "calendar-events";
    const items = grouped[key] || [];
    items.slice(0, 3).forEach((event) => {
      const chip = document.createElement("div");
      chip.className = "calendar-chip";
      chip.title = pickText(event, "title");
      chip.textContent = pickText(event, "title");
      eventsWrap.appendChild(chip);
    });
    if (items.length > 3) {
      const more = document.createElement("div");
      more.className = "calendar-chip";
      more.textContent = `+${items.length - 3} more`;
      eventsWrap.appendChild(more);
    }
    cell.addEventListener("click", () => openDayModal(date, items));
    cell.append(dateLabel, eventsWrap);
    grid.appendChild(cell);
  });

  wrapper.append(header, grid);
  calendarView.appendChild(wrapper);
}

function renderCalendarWeek(events) {
  calendarView.innerHTML = "";
  const grouped = groupEventsByDate(events);
  const wrapper = document.createElement("div");
  wrapper.className = "calendar";
  const header = document.createElement("div");
  header.className = "calendar-header";
  const title = document.createElement("h3");
  const weekEnd = addDays(state.weekStart, 6);
  title.textContent = `${state.weekStart.toLocaleDateString(state.uiLang, { month: "short", day: "numeric" })} – ${weekEnd.toLocaleDateString(state.uiLang, { month: "short", day: "numeric" })}`;
  const nav = document.createElement("div");
  nav.className = "admin-bar";
  const prev = document.createElement("button");
  prev.className = "secondary";
  prev.textContent = "←";
  prev.addEventListener("click", () => {
    state.weekStart = addDays(state.weekStart, -7);
    render();
  });
  const next = document.createElement("button");
  next.className = "secondary";
  next.textContent = "→";
  next.addEventListener("click", () => {
    state.weekStart = addDays(state.weekStart, 7);
    render();
  });
  nav.append(prev, next);
  header.append(title, nav);

  const grid = document.createElement("div");
  grid.className = "calendar-week";
  for (let i = 0; i < 7; i += 1) {
    const date = addDays(state.weekStart, i);
    const key = toDateKey(date);
    const day = document.createElement("div");
    day.className = "calendar-week-day";
    const label = document.createElement("div");
    label.className = "calendar-date";
    label.textContent = date.toLocaleDateString(state.uiLang, { weekday: "short", day: "numeric" });
    const eventsWrap = document.createElement("div");
    eventsWrap.className = "calendar-events";
    (grouped[key] || []).forEach((event) => {
      const chip = document.createElement("div");
      chip.className = "calendar-chip";
      chip.title = pickText(event, "title");
      chip.textContent = pickText(event, "title");
      eventsWrap.appendChild(chip);
    });
    day.addEventListener("click", () => openDayModal(date, grouped[key] || []));
    day.append(label, eventsWrap);
    grid.appendChild(day);
  }

  wrapper.append(header, grid);
  calendarView.appendChild(wrapper);
}

function render() {
  const events = filterEvents();
  renderEvents();
  const showCalendar = state.viewMode !== "list";
  calendarView.classList.toggle("hidden", !showCalendar);
  eventList.classList.toggle("hidden", showCalendar);
  if (state.viewMode === "month") {
    renderCalendarMonth(events);
  } else if (state.viewMode === "week") {
    renderCalendarWeek(events);
  }
}

function syncUiCopy() {
  const strings = uiStrings[state.uiLang];
  document.getElementById("hero-title").textContent = strings.title;
  document.getElementById("hero-subtitle").textContent = strings.subtitle;
  document.getElementById("submit-title").textContent = strings.submitTitle;
  document.getElementById("submit-subtitle").textContent = strings.submitSubtitle;
  resetFilters.textContent = strings.reset;
}

async function loadEvents() {
  const { data, error } = await client
    .from("events")
    .select("*")
    .eq("status", "approved")
    .order("date_start", { ascending: true });

  if (error) {
    console.error(error);
    return;
  }
  state.events = data || [];
  render();
}

function hydrateFormOptions() {
  const eventTypeSelect = submitForm.querySelector("select[name='event_type']");
  EVENT_TYPES.forEach((type) => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    eventTypeSelect.appendChild(opt);
  });

  const areaSelect = submitForm.querySelector("select[name='area']");
  AREAS.forEach((area) => {
    const opt = document.createElement("option");
    opt.value = area;
    opt.textContent = area;
    areaSelect.appendChild(opt);
  });

  const languageSelect = submitForm.querySelector("select[name='event_language']");
  LANGS.forEach((lang) => {
    const opt = document.createElement("option");
    opt.value = lang.code;
    opt.textContent = lang.label;
    languageSelect.appendChild(opt);
  });

  const priceSelect = submitForm.querySelector("select[name='price_type']");
  PRICE_TYPES.forEach((type) => {
    const opt = document.createElement("option");
    opt.value = type;
    opt.textContent = type;
    priceSelect.appendChild(opt);
  });
}

async function handleSubmit(event) {
  event.preventDefault();
  submitStatus.style.display = "none";
  const formData = new FormData(submitForm);
  const eventLanguage = formData.getAll("event_language");
  const repeatFrequency = formData.get("repeat_frequency") || "none";
  const repeatUntil = formData.get("repeat_until") || null;
  const selectedFile = formData.get("event_image_file");
  let eventImageUrl = formData.get("event_image_url") || null;

  if (selectedFile && selectedFile.size > 0) {
    try {
      eventImageUrl = await uploadEventImage(selectedFile, "public-submissions");
    } catch (uploadError) {
      submitStatus.style.display = "block";
      submitStatus.textContent = `Image upload failed: ${uploadError.message}`;
      return;
    }
  }

  const payload = {
    status: "pending",
    title_en: formData.get("title"),
    description_en: formData.get("description"),
    location_en: formData.get("location"),
    event_type: formData.get("event_type"),
    area: formData.get("area"),
    event_language: eventLanguage,
    date_start: formData.get("date_start"),
    date_end: formData.get("date_end") || null,
    price_type: formData.get("price_type"),
    price_min: formData.get("price_min") || null,
    price_max: formData.get("price_max") || null,
    currency: "ALL",
    ticket_url: formData.get("ticket_url") || null,
    event_image_url: eventImageUrl,
    organizer_name: formData.get("organizer_name") || null,
    organizer_email: formData.get("organizer_email") || null,
    submitter_name: formData.get("submitter_name") || null,
    submitter_email: formData.get("submitter_email") || null,
    submitter_note: formData.get("submitter_note") || null
  };

  if (!payload.title_en || !payload.description_en || !payload.location_en || !payload.date_start || !payload.date_end) {
    submitStatus.style.display = "block";
    submitStatus.textContent = "Please complete all required fields.";
    return;
  }
  if (!eventLanguage.length) {
    submitStatus.style.display = "block";
    submitStatus.textContent = "Please select at least one event language.";
    return;
  }
  if (repeatFrequency !== "none" && !repeatUntil) {
    submitStatus.style.display = "block";
    submitStatus.textContent = "Please set a repeat end date.";
    return;
  }

  const rows = buildRecurringRows(payload, repeatFrequency, repeatUntil);
  if (!rows.length) {
    submitStatus.style.display = "block";
    submitStatus.textContent = "Recurring settings are invalid. Check date range.";
    return;
  }

  const { error } = await client.from("events").insert(rows);
  if (error) {
    submitStatus.style.display = "block";
    submitStatus.textContent = "Sorry, something went wrong. Try again.";
    console.error(error);
    return;
  }

  submitForm.reset();
  submitStatus.style.display = "block";
  submitStatus.textContent = `Thanks! Submitted ${rows.length} event(s) for approval.`;
}

resetFilters.addEventListener("click", () => {
  state.filters = {
    search: "",
    eventType: "",
    area: "",
    eventLanguage: "",
    dateFrom: "",
    dateTo: "",
    sort: "date_asc"
  };
  renderFilters();
  render();
});

viewControls.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-view]");
  if (!button) return;
  state.viewMode = button.dataset.view;
  [...viewControls.querySelectorAll("button[data-view]")].forEach((btn) => {
    btn.classList.toggle("active", btn.dataset.view === state.viewMode);
  });
  render();
});

submitForm.addEventListener("submit", handleSubmit);
repeatFrequencyInput.addEventListener("change", () => {
  repeatUntilInput.required = repeatFrequencyInput.value !== "none";
});
modalClose.addEventListener("click", closeModal);
eventModal.addEventListener("click", (event) => {
  if (event.target.dataset.closeModal === "true") {
    closeModal();
  }
});
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !eventModal.classList.contains("hidden")) {
    closeModal();
  }
});

syncUiCopy();
renderFilters();
hydrateFormOptions();
render();
loadEvents();
