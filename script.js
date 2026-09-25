/* =========================================================
   Farmers Report - Frontend logic
   - Populates the farmer table (Add Row / Delete Row)
   - Validates all fields on the client
   - Submits the JSON payload to a Google Apps Script Web App
   ========================================================= */

"use strict";

/* ---------------------------------------------------------
   CONFIG - EDIT THIS!
   ---------------------------------------------------------
   1. Deploy your Google Apps Script as a Web App (see README).
   2. Paste the Web App URL (ends in /exec) below.
   3. Leave REQUIRE_FARMER_ROWS = true to force at least one
      fully filled farmer row before submitting.
   --------------------------------------------------------- */
const CONFIG = {
  APPS_SCRIPT_URL: "https://script.google.com/a/macros/acadesmw.com/s/AKfycbyIjfsNzGYaefpV2G-kRcesyHF005FX_xapdejx9o200v1kvXglP4MyAcKiLR5oSW4H/exec", // e.g. "https://script.google.com/macros/s/XXXX/exec"
  REQUIRE_FARMER_ROWS: true,
  AGE_MIN: 5,
  AGE_MAX: 120,
  REACHED_MAX: 10000,
};

/* Malawi districts used in both the CBV section and farmer table */
const DISTRICTS = [
  "Balaka", "Blantyre", "Chikwawa", "Chiradzulu", "Chitipa", "Dedza",
  "Dowa", "Karonga", "Kasungu", "Likoma", "Lilongwe", "Machinga",
  "Mangochi", "Mchinji", "Mulanje", "Mwanza", "Mzimba", "Neno",
  "Nkhata Bay", "Nkhotakota", "Nsanje", "Ntcheu", "Ntchisi",
  "Phalombe", "Rumphi", "Salima", "Thyolo", "Zomba",
];

/* A drop-in helper to generate an HTML select with the given options */
function buildDistrictOptions() {
  return DISTRICTS.map((d) => `<option value="${d}">${d}</option>`).join("");
}

/* ---------------------------------------------------------
   DOM references (cached once the DOM is ready)
   --------------------------------------------------------- */
const $ = (id) => document.getElementById(id);

let elForm, elBanner, elTableBody, elAddRow, elRowCountLabel, elSubmitBtn, elTableError;
let elResetBtn, elDownloadSection, elDownloadPdfBtn;

/* ---------------------------------------------------------
   Small helpers
   --------------------------------------------------------- */
/* Escape text so user input can never break out of HTML */
function esc(value) {
  return String(value)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/* Show / hide the top banner with a type (success, error, info) */
function showBanner(type, message) {
  elBanner.hidden = false;
  elBanner.className = `banner ${type}`;
  elBanner.textContent = message;
}

function hideBanner() {
  elBanner.hidden = true;
  elBanner.className = "banner";
  elBanner.textContent = "";
}

/* Set / clear an inline error message for a main form field */
function setFieldError(fieldId, errorId, message) {
  const input = $(fieldId);
  const errorEl = $(errorId);
  if (!input || !errorEl) return;
  if (message) {
    input.classList.add("invalid");
    errorEl.textContent = message;
  } else {
    input.classList.remove("invalid");
    errorEl.textContent = "";
  }
}

/* ---------------------------------------------------------
   Farmer table - row rendering
   --------------------------------------------------------- */
/*
 * Creates and returns a <tr> for one farmer.
 * Each editable cell holds an input/select with class names so the
 * validation code can read them back by group (name/age/gender/...).
 */
function createFarmerRow(index) {
  const tr = document.createElement("tr");

  /*
   * cell(cls, innerHTML, label)
   * label is shown above each field when the table collapses to
   * stacked cards on small screens (see style.css media query).
   */
  const cell = (cls, innerHTML, label) => {
    const td = document.createElement("td");
    if (cls) td.className = cls;
    td.setAttribute("data-label", label || "");
    td.innerHTML = innerHTML;
    return td;
  };

  /* # - auto number */
  tr.appendChild(cell("row-no", esc(index + 1), "No."));

  /* Farmer Name */
  tr.appendChild(cell(
    "name-cell",
    `<input type="text" class="f-name" maxlength="100" placeholder="Farmer name" autocomplete="off">`,
    "Farmer Name (Dzina)"
  ));

  /* Age */
  tr.appendChild(cell(
    "",
    `<input type="number" class="f-age" min="1" max="120" step="1" inputmode="numeric" placeholder="e.g. 30">`,
    "Age (Zaka)"
  ));

  /* Gender */
  tr.appendChild(cell(
    "",
    `<select class="f-gender"><option value="">-Select- (Sankhani)</option>` +
    `<option value="Mamuna">Mamuna</option><option value="Mkazi">Mkazi</option></select>`,
    "Gender (Mamuna/Mkazi)"
  ));

  /* District */
  tr.appendChild(cell(
    "",
    `<select class="f-district"><option value="">-Select- (Sankhani)</option>${buildDistrictOptions()}</select>`,
    "District (Boma)"
  ));

  /* T/A */
  tr.appendChild(cell(
    "",
    `<input type="text" class="f-ta" maxlength="100" placeholder="e.g. Chindi" autocomplete="off">`,
    "T/A (Mfumu)"
  ));

  /* Group Name */
  tr.appendChild(cell(
    "",
    `<input type="text" class="f-group" maxlength="100" placeholder="e.g. Kalonga" autocomplete="off">`,
    "Group Name (Dzina la Gulu)"
  ));

  /* Satisfied? Eya / Ayi */
  tr.appendChild(cell(
    "",
    `<select class="f-satisfied"><option value="">-Select- (Sankhani)</option>` +
    `<option value="Eya">Eya</option><option value="Ayi">Ayi</option></select>`,
    "Satisfied? (Eya/Ayi)"
  ));

  /* Follow Up Visit? Eya / Ayi */
  tr.appendChild(cell(
    "",
    `<select class="f-follow"><option value="">-Select- (Sankhani)</option>` +
    `<option value="Eya">Eya</option><option value="Ayi">Ayi</option></select>`,
    "Follow Up Visit (Eya/Ayi)"
  ));

  /* Comments */
  tr.appendChild(cell(
    "comments-cell",
    `<input type="text" class="f-comments" maxlength="500" placeholder="Optional" autocomplete="off">`,
    "Comments (Zowonjezera)"
  ));

  /* Delete button */
  const actionTd = cell("actions-col", `<button type="button" class="delete-row" title="Delete this row (Chotsani mzere uwu)">x</button>`, "Action (Zochita)");
  tr.appendChild(actionTd);

  return tr;
}

/* Re-number the visible rows after an add/delete */
function updateRowNumbers() {
  Array.from(elTableBody.children).forEach((tr, i) => {
    tr.querySelector(".row-no").textContent = i + 1;
  });
}

/* Update the "N farmer(s)" counter */
function updateRowCount() {
  elRowCountLabel.textContent = `${elTableBody.children.length} farmer(s) / alimi`;
}

/* Add an empty row at the end of the table */
function addFarmerRow() {
  const tr = createFarmerRow(elTableBody.children.length);
  elTableBody.appendChild(tr);
  /* Enable delete buttons once more than one row exists */
  const rows = elTableBody.children;
  const onlyOne = rows.length === 1;
  Array.from(rows).forEach((row) => {
    row.querySelector(".delete-row").disabled = onlyOne;
  });
  updateRowCount();
}

/* Remove a row (the delete handler is attached per-row on creation) */
function deleteFarmerRow(tr) {
  const rows = elTableBody.children;
  if (rows.length <= 1) {
    /* Keep at least one row; just clear it */
    clearRow(tr);
    return;
  }
  tr.remove();
  const remaining = elTableBody.children;
  Array.from(remaining).forEach((row) => {
    row.querySelector(".delete-row").disabled = remaining.length === 1;
  });
  updateRowNumbers();
  updateRowCount();
}

/* Clear every input/select in a row back to its default value */
function clearRow(tr) {
  tr.querySelectorAll("input, select").forEach((input) => {
    input.value = "";
  });
}

/* ---------------------------------------------------------
   Validation - main form (Section 1 & 2)
   --------------------------------------------------------- */
function validateMainForm() {
  let firstInvalid = null;
  const isValid = (el) => {
    if (!firstInvalid) {
      firstInvalid = el;
      el.focus();
    }
  };

  /* Name */
  const name = elForm.elements.cbvName.value.trim();
  if (!name) {
    setFieldError("cbvName", "cbvName-error", "Name is required. / Dzina likufunika.");
    isValid(elForm.elements.cbvName);
  } else if (name.length < 2) {
    setFieldError("cbvName", "cbvName-error", "Name must be at least 2 characters.");
    isValid(elForm.elements.cbvName);
  } else {
    setFieldError("cbvName", "cbvName-error", "");
  }

  /* Age */
  const age = elForm.elements.cbvAge.value.trim();
  const ageNum = Number(age);
  if (!age) {
    setFieldError("cbvAge", "cbvAge-error", "Age is required. / Zaka zikufunika.");
    isValid(elForm.elements.cbvAge);
  } else if (!Number.isInteger(ageNum) || ageNum < CONFIG.AGE_MIN || ageNum > CONFIG.AGE_MAX) {
    setFieldError("cbvAge", "cbvAge-error", `Age must be a whole number between ${CONFIG.AGE_MIN} and ${CONFIG.AGE_MAX}.`);
    isValid(elForm.elements.cbvAge);
  } else {
    setFieldError("cbvAge", "cbvAge-error", "");
  }

  /* Gender (radio) */
  const genderInputs = elForm.elements.cbvGender;
  const gender = Array.from(genderInputs).find((r) => r.checked);
  const genderErr = $("cbvGender-error");
  if (!gender) {
    genderErr.textContent = "Please select a gender. / Sankhani mamuna kapena mkazi.";
    isValid(genderInputs[0]);
  } else {
    genderErr.textContent = "";
  }

  /* District */
  const district = elForm.elements.cbvDistrict.value;
  if (!district) {
    setFieldError("cbvDistrict", "cbvDistrict-error", "Please select a district. / Sankhani boma.");
    isValid(elForm.elements.cbvDistrict);
  } else {
    setFieldError("cbvDistrict", "cbvDistrict-error", "");
  }

  /* T/A */
  const ta = elForm.elements.cbvTa.value.trim();
  if (!ta) {
    setFieldError("cbvTa", "cbvTa-error", "T/A is required.");
    isValid(elForm.elements.cbvTa);
  } else if (ta.length < 2) {
    setFieldError("cbvTa", "cbvTa-error", "T/A must be at least 2 characters.");
    isValid(elForm.elements.cbvTa);
  } else {
    setFieldError("cbvTa", "cbvTa-error", "");
  }

  /* Group */
  const group = elForm.elements.cbvGroup.value.trim();
  if (!group) {
    setFieldError("cbvGroup", "cbvGroup-error", "Group name is required. / Dzina la gulu likufunika.");
    isValid(elForm.elements.cbvGroup);
  } else if (group.length < 2) {
    setFieldError("cbvGroup", "cbvGroup-error", "Group name must be at least 2 characters.");
    isValid(elForm.elements.cbvGroup);
  } else {
    setFieldError("cbvGroup", "cbvGroup-error", "");
  }

  /* Farmers reached */
  const reached = elForm.elements.reachedCount.value.trim();
  const reachedNum = Number(reached);
  if (!reached) {
    setFieldError("reachedCount", "reachedCount-error", "Number of farmers reached is required.");
    isValid(elForm.elements.reachedCount);
  } else if (!Number.isInteger(reachedNum) || reachedNum < 0 || reachedNum > CONFIG.REACHED_MAX) {
    setFieldError("reachedCount", "reachedCount-error", `Must be a whole number between 0 and ${CONFIG.REACHED_MAX}.`);
    isValid(elForm.elements.reachedCount);
  } else {
    setFieldError("reachedCount", "reachedCount-error", "");
  }

  return firstInvalid === null;
}

/* ---------------------------------------------------------
   Validation - farmer table rows
   Returns true if every row is valid; otherwise writes error
   messages under the table and highlights invalid cells.
   --------------------------------------------------------- */
function validateFarmerRows() {
  elTableError.textContent = "";
  const rows = Array.from(elTableBody.children);

  /* Check that at least one farmer row exists when required */
  if (CONFIG.REQUIRE_FARMER_ROWS && rows.length === 0) {
    elTableError.textContent = "Please add at least one farmer. / Onjezani mlimi mmodzi.";
    return false;
  }

  const errors = [];
  let hasFarmerRow = false;

  rows.forEach((tr, i) => {
    const rowNum = i + 1;
    const cellMap = {
      name: tr.querySelector(".f-name"),
      age: tr.querySelector(".f-age"),
      gender: tr.querySelector(".f-gender"),
      district: tr.querySelector(".f-district"),
      ta: tr.querySelector(".f-ta"),
      group: tr.querySelector(".f-group"),
      satisfied: tr.querySelector(".f-satisfied"),
      follow: tr.querySelector(".f-follow"),
      comments: tr.querySelector(".f-comments"),
    };

    const hasAnyValue = Object.values(cellMap).some((el) => String(el.value).trim() !== "");
    if (!hasAnyValue) return;
    hasFarmerRow = true;

    const rowErrors = [];

    if (!String(cellMap.name.value).trim()) rowErrors.push("Farmer Name is required");
    if (!String(cellMap.age.value).trim()) {
      rowErrors.push("Age is required");
    } else {
      const a = Number(cellMap.age.value);
      if (!Number.isInteger(a) || a < 1 || a > 120) rowErrors.push("Age must be a whole number between 1 and 120");
    }
    if (!cellMap.gender.value) rowErrors.push("Gender is required");
    if (!cellMap.district.value) rowErrors.push("District is required");
    if (!String(cellMap.ta.value).trim()) rowErrors.push("T/A is required");
    if (!cellMap.satisfied.value) rowErrors.push("Satisfied? (Eya/Ayi) is required");
    if (!cellMap.follow.value) rowErrors.push("Follow Up Visit (Eya/Ayi) is required");

    /* Highlight offending cells with a red border */
    Object.entries(cellMap).forEach(([key, el]) => {
      const isBad =
        (key === "name" && !String(el.value).trim()) ||
        (key === "age" && (rowErrors.some((e) => e.startsWith("Age")))) ||
        (key === "gender" && !el.value) ||
        (key === "district" && !el.value) ||
        (key === "ta" && !String(el.value).trim()) ||
        (key === "satisfied" && !el.value) ||
        (key === "follow" && !el.value);
      el.classList.toggle("invalid", isBad);
    });

    if (rowErrors.length) {
      errors.push(`Row ${rowNum}: ${rowErrors.join(", ")}`);
    }
  });

  if (CONFIG.REQUIRE_FARMER_ROWS && !hasFarmerRow) {
    elTableError.textContent = "Please fill in at least one farmer row. / Wongani mlimi mmodzi.";
    return false;
  }

  if (errors.length) {
    elTableError.textContent = errors.join(". ");
    return false;
  }

  return true;
}
/* ---------------------------------------------------------
   Build the JSON payload sent to the Apps Script backend
   --------------------------------------------------------- */
function buildPayload() {
  /* CBV + summary from Section 1 & 2 */
  const cbv = {
    name: elForm.elements.cbvName.value.trim(),
    age: Number(elForm.elements.cbvAge.value),
    gender: (Array.from(elForm.elements.cbvGender).find((r) => r.checked) || {}).value || "",
    district: elForm.elements.cbvDistrict.value,
    ta: elForm.elements.cbvTa.value.trim(),
    group: elForm.elements.cbvGroup.value.trim(),
  };

  const summary = {
    farmersReached: Number(elForm.elements.reachedCount.value),
    commonQuestions: elForm.elements.commonQuestions.value.trim(),
  };

  /* One object per farmer row (empty rows are dropped) */
  const farmers = Array.from(elTableBody.children)
    .map((tr) => ({
      name: tr.querySelector(".f-name").value.trim(),
      age: Number(tr.querySelector(".f-age").value) || null,
      gender: tr.querySelector(".f-gender").value,
      district: tr.querySelector(".f-district").value,
      ta: tr.querySelector(".f-ta").value.trim(),
      groupName: tr.querySelector(".f-group").value.trim(),
      satisfied: tr.querySelector(".f-satisfied").value,
      followUp: tr.querySelector(".f-follow").value,
      comments: tr.querySelector(".f-comments").value.trim(),
    }))
    .filter((f) => f.name || f.age !== null || f.gender || f.district || f.ta || f.groupName || f.satisfied || f.followUp || f.comments);

  /* Reuse the saved Submission ID on follow-up submits */
  const session = loadSession();
  return { cbv, summary, farmers, submissionId: (session && session.submissionId) || "" };
}

/* ---------------------------------------------------------
   PDF report download
   After a successful submit the submitted payload is kept in
   `lastReport` and the download button is shown. Clicking it
   builds a PDF (jsPDF + autoTable) and saves it locally.
   --------------------------------------------------------- */
let lastReport = null;

/* Human-friendly date/time for the PDF header */
function formatDateTime(iso) {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch (e) {
    return String(iso);
  }
}

/*** Build a jsPDF document from a report object ***/
function buildReportPdf(report) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.getWidth();
  const margin = 14;
  const contentWidth = pageWidth - margin * 2;
  const darkGreen = [23, 130, 64];
  const grey = [96, 125, 139];
  const darkGrey = [38, 50, 56];

  const cbv = report.cbv || {};
  const summary = report.summary || {};
  const farmers = report.farmers || [];

  /* Header strip */
  let y = 20;
  doc.setFillColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.rect(0, 0, pageWidth, 5, "F");

  doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
  doc.setFont("helvetica", "bold");
  doc.setFontSize(18);
  doc.text("ACADES Farmers Report", margin, y);
  y += 7;

  doc.setTextColor(grey[0], grey[1], grey[2]);
  doc.setFont("helvetica", "normal");
  doc.setFontSize(10);
  doc.text("CBV & Farmer Registration Report", margin, y);
  y += 7;

  doc.setFontSize(9);
  doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
  doc.text(`Submission ID: ${report.submissionId || "N/A"}`, margin, y);
  y += 5;
  doc.text(`Submitted: ${formatDateTime(report.submittedAt)}`, margin, y);
  y += 10;

  /* Green section heading band */
  const title = (label) => {
    doc.setFillColor(242, 249, 227);
    doc.roundedRect(margin, y - 4.5, contentWidth, 9, 1.5, 1.5, "F");
    doc.setTextColor(darkGreen[0], darkGreen[1], darkGreen[2]);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(11);
    doc.text(label, margin + 4, y + 0.5);
    y += 11;
  };

  /* Label / value line that wraps long values */
  const kv = (k, v) => {
    const val = String(v == null ? "" : v);
    doc.setFont("helvetica", "bold");
    doc.setFontSize(9.5);
    doc.setTextColor(grey[0], grey[1], grey[2]);
    const labelWidth = doc.getTextWidth(k) + 6;
    doc.text(k, margin, y);
    const valueX = margin + labelWidth + 4;
    const lines = doc.splitTextToSize(val, pageWidth - valueX - margin);
    doc.setFont("helvetica", "normal");
    doc.setTextColor(darkGrey[0], darkGrey[1], darkGrey[2]);
    doc.text(lines, valueX, y);
    y += lines.length * 6;
  };

  /* --- CBV details --- */
  title("CBV Details (Zambiri za CBV)");
  kv("Name (Dzina)", cbv.name);
  kv("Age (Zaka)", cbv.age);
  kv("Gender (Jenda)", cbv.gender);
  kv("District (Boma)", cbv.district);
  kv("T/A (Mfumu)", cbv.ta);
  kv("Group (Gulu)", cbv.group);
  y += 4;

  /* --- Report summary --- */
  title("Report Summary (Ripoti lachidule)");
  kv("Farmers Reached (Alimi ofikiridwa)", summary.farmersReached);
  if (summary.commonQuestions) {
    kv("Common Questions (Mafunso)", summary.commonQuestions);
  }
  y += 4;

  /* --- Farmer details table --- */
  title(`Farmer Details (Zambiri za Alimi) - ${farmers.length}`);
  doc.autoTable({
    startY: y,
    head: [[
      "#", "Farmer Name", "Age", "Gender", "District", "T/A",
      "Group", "Satisfied?", "Follow Up", "Comments",
    ]],
    body: farmers.map((f, i) => [
      i + 1,
      f.name || "",
      f.age == null ? "" : String(f.age),
      f.gender || "",
      f.district || "",
      f.ta || "",
      f.groupName || "",
      f.satisfied || "",
      f.followUp || "",
      f.comments || "",
    ]),
    margin: { left: margin, right: margin },
    styles: {
      font: "helvetica",
      fontSize: 8,
      cellPadding: 2.5,
      textColor: [38, 50, 56],
      lineColor: [220, 230, 207],
      lineWidth: 0.1,
    },
    headStyles: {
      fillColor: [darkGreen[0], darkGreen[1], darkGreen[2]],
      textColor: [255, 255, 255],
      fontStyle: "bold",
    },
    alternateRowStyles: { fillColor: [242, 249, 227] },
  });

  /* Footer */
  const pageH = doc.internal.pageSize.getHeight();
  doc.setFontSize(8);
  doc.setTextColor(grey[0], grey[1], grey[2]);
  doc.setFont("helvetica", "normal");
  doc.text("ACADES Farmers Report (Ripoti la Alimi)", margin, pageH - 10);

  return doc;
}

/*** Build and save the PDF for the last successful submission ***/
function downloadReportPdf() {
  if (!lastReport) return;
  try {
    if (!window.jspdf || !window.jspdf.jsPDF) {
      throw new Error("PDF library not loaded");
    }
    const doc = buildReportPdf(lastReport);
    const safeId = String(lastReport.submissionId || "report").replace(/[^a-zA-Z0-9_-]/g, "");
    doc.save(`Farmers_Report_${safeId}.pdf`);
  } catch (err) {
    console.error("PDF generation failed:", err);
    showBanner("error", `Could not generate the PDF. Please check your internet connection. (${err.message})`);
  }
}

/*** Reveal the download button with the data of the submitted report ***/
function showDownloadSection(report) {
  lastReport = report;
  elDownloadSection.hidden = false;
}

/* ---------------------------------------------------------
   Submit to Google Apps Script Web App
   Content-Type is deliberately text/plain: Apps Script Web Apps
   do not always send CORS pre-flight headers, and a text/plain
   body with JSON inside avoids the pre-flight request entirely.
   --------------------------------------------------------- */
async function submitToAppsScript(payload) {
  const response = await fetch(CONFIG.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "Content-Type": "text/plain;charset=utf-8" },
    body: JSON.stringify(payload),
  });
  /* The Apps Script backend always returns JSON */
  return response.json();
}

/* ---------------------------------------------------------
   Form submit handler
   --------------------------------------------------------- */
async function handleSubmit(event) {
  event.preventDefault();
  hideBanner();

  /* Basic guard: warn if the developer forgot to set the URL */
  if (CONFIG.APPS_SCRIPT_URL.startsWith("PASTE")) {
    showBanner("info", "The form is not connected yet. Paste your Apps Script Web App URL into script.js (CONFIG.APPS_SCRIPT_URL).");
    return;
  }

  /* Validate everything client-side first */
  const mainOk = validateMainForm();
  const rowsOk = validateFarmerRows();

  if (!mainOk || !rowsOk) {
    showBanner("error", "Please fix the highlighted fields and try again.");
    return;
  }

  const payload = buildPayload();

  /* Disable the button while the request is in flight */
  elSubmitBtn.disabled = true;
  elSubmitBtn.textContent = "Submitting... (Kutumiza...)";

  try {
    const result = await submitToAppsScript(payload);

    if (result && result.success) {
      const existing = loadSession();
      const submissionId = result.submissionId || (existing && existing.submissionId) || "OK";
      const submittedAt = new Date().toISOString();

      if (existing && existing.submissionId) {
        saveSession({
          submissionId,
          submittedAt,
          cbv: payload.cbv,
          summary: payload.summary,
        });
        showBanner("success", `Added ${result.appended || payload.farmers.length} farmer(s) to report ${submissionId}. The CBV details stay locked for the next batch.`);
      } else {
        saveSession({
          submissionId,
          submittedAt,
          cbv: payload.cbv,
          summary: payload.summary,
        });
        showBanner("success", `Report submitted successfully! Reference ID: ${submissionId}`);
      }

      /* Offer the PDF download right below the success message */
      showDownloadSection({
        cbv: payload.cbv,
        summary: payload.summary,
        farmers: payload.farmers,
        submissionId,
        submittedAt,
      });

      const saved = loadSession();
      if (saved && saved.submissionId) {
        applySession(saved);
      } else {
        hardResetForm();
      }
    } else {
      throw new Error((result && result.error) || "The server rejected the submission.");
    }
  } catch (err) {
    console.error("Submission failed:", err);
    showBanner("error", `Submission failed. Please check your connection and try again. (${err.message})`);
  } finally {
    elSubmitBtn.disabled = false;
    elSubmitBtn.textContent = "Submit Report (Tumizani Ripoti)";
    /* Bring the result into view */
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/* ---------------------------------------------------------
   Session persistence
   --------------------------------------------------------- */
const SESSION_KEY = "farmers_report_session";

function saveSession(data) {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(data));
  } catch (e) {
    /* storage unavailable (private mode) - session just won't persist */
  }
}

function loadSession() {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch (e) {
    return null;
  }
}

function clearSession() {
  try {
    localStorage.removeItem(SESSION_KEY);
  } catch (e) {
    /* ignore */
  }
}

/* Lock / unlock the CBV fields (locked during an active session) */
function lockCbvFields(lock) {
  [
    elForm.elements.cbvName,
    elForm.elements.cbvAge,
    elForm.elements.cbvDistrict,
    elForm.elements.cbvTa,
    elForm.elements.cbvGroup,
  ].forEach((el) => (el.disabled = lock));
  Array.from(elForm.elements.cbvGender).forEach((r) => (r.disabled = lock));
}

/*
 * Restore a saved session: CBV details are pre-filled and locked,
 * the summary is kept, and the farmer table is cleared so the CBV
 * can submit another batch of farmers under the same report.
 */
function applySession(session) {
  const cbv = session.cbv || {};
  elForm.elements.cbvName.value = cbv.name || "";
  elForm.elements.cbvAge.value = cbv.age != null ? String(cbv.age) : "";
  Array.from(elForm.elements.cbvGender).forEach((r) => {
    r.checked = r.value === cbv.gender;
  });
  elForm.elements.cbvDistrict.value = cbv.district || "";
  elForm.elements.cbvTa.value = cbv.ta || "";
  elForm.elements.cbvGroup.value = cbv.group || "";
  elForm.elements.reachedCount.value =
    session.summary && session.summary.farmersReached != null
      ? String(session.summary.farmersReached)
      : "";
  elForm.elements.commonQuestions.value = session.summary && session.summary.commonQuestions
    ? session.summary.commonQuestions
    : "";

  lockCbvFields(true);

  elTableBody.innerHTML = "";
  addFarmerRow();

  elResetBtn.textContent = "Start New Report (Yambani Ripoti Latsopano)";
}

/* Hard-reset the form to a fully blank, unlocked state (no session) */
function hardResetForm() {
  elForm.reset();
  elTableBody.innerHTML = "";
  addFarmerRow();
  elForm.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  elForm.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  elTableError.textContent = "";

  lockCbvFields(false);

  elResetBtn.textContent = "Reset Form (Bwezerani Fomu)";
}

/* The Reset button asks first when a session is active */
function handleFormReset(event) {
  event.preventDefault();
  if (loadSession()) {
    if (window.confirm("Start a new report? This ends the current session and clears its saved CBV details.")) {
      startNewReport();
    }
    return;
  }
  hardResetForm();
}

/* End the active session and clear the form for a brand-new report */
function startNewReport() {
  clearSession();
  hardResetForm();
}

/* ---------------------------------------------------------
   Initialisation
   --------------------------------------------------------- */
function init() {
  elForm = $("farmerForm");
  elBanner = $("banner");
  elTableBody = $("farmerTableBody");
  elAddRow = $("addRowBtn");
  elRowCountLabel = $("rowCountLabel");
  elSubmitBtn = $("submitBtn");
  elTableError = $("farmerTable-error");
  elResetBtn = $("resetBtn");
  elDownloadSection = $("downloadSection");
  elDownloadPdfBtn = $("downloadPdfBtn");

  /* Inject district options into the CBV section */
  $("cbvDistrict").insertAdjacentHTML("beforeend", buildDistrictOptions());

  /* Event listeners */
  elAddRow.addEventListener("click", addFarmerRow);
  elForm.addEventListener("submit", handleSubmit);
  elForm.addEventListener("reset", handleFormReset);
  elDownloadPdfBtn.addEventListener("click", downloadReportPdf);

  /* Delegate delete-row clicks to the tbody (works for all rows) */
  elTableBody.addEventListener("click", (event) => {
    const btn = event.target.closest(".delete-row");
    if (btn) deleteFarmerRow(btn.closest("tr"));
  });

  /* Start with one empty farmer row */
  addFarmerRow();

  /* Restore an active session (CBV locked, ready for more farmers) */
  const saved = loadSession();
  if (saved && saved.submissionId) {
    applySession(saved);
  }
}

/* Run when the DOM is fully loaded */
document.addEventListener("DOMContentLoaded", init);
