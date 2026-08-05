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
  APPS_SCRIPT_URL: "https://script.google.com/macros/s/AKfycbyXBLPpTF-VTUPJuBzmHONq_R50Jef92sgPMrWrClZatj8szLnVlWdUuI6vzIA5ygCO/exec", // e.g. "https://script.google.com/macros/s/XXXX/exec"
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
    `<select class="f-gender"><option value="">-Select-</option>` +
    `<option value="Mamuna">Mamuna</option><option value="Mkazi">Mkazi</option></select>`,
    "Gender"
  ));

  /* District */
  tr.appendChild(cell(
    "",
    `<select class="f-district"><option value="">-Select-</option>${buildDistrictOptions()}</select>`,
    "District (Boma)"
  ));

  /* T/A */
  tr.appendChild(cell(
    "",
    `<input type="text" class="f-ta" maxlength="100" placeholder="e.g. Chindi" autocomplete="off">`,
    "T/A"
  ));

  /* Group Name */
  tr.appendChild(cell(
    "",
    `<input type="text" class="f-group" maxlength="100" placeholder="e.g. Kalonga" autocomplete="off">`,
    "Group Name"
  ));

  /* Satisfied? Eya / Ayi */
  tr.appendChild(cell(
    "",
    `<select class="f-satisfied"><option value="">-Select-</option>` +
    `<option value="Eya">Eya</option><option value="Ayi">Ayi</option></select>`,
    "Satisfied? (Eya/Ayi)"
  ));

  /* Follow Up Visit? Eya / Ayi */
  tr.appendChild(cell(
    "",
    `<select class="f-follow"><option value="">-Select-</option>` +
    `<option value="Eya">Eya</option><option value="Ayi">Ayi</option></select>`,
    "Follow Up Visit"
  ));

  /* Comments */
  tr.appendChild(cell(
    "comments-cell",
    `<input type="text" class="f-comments" maxlength="500" placeholder="Optional" autocomplete="off">`,
    "Comments (Zowonjezera)"
  ));

  /* Delete button */
  const actionTd = cell("actions-col", `<button type="button" class="delete-row" title="Delete this row">x</button>`, "Action");
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
  elRowCountLabel.textContent = `${elTableBody.children.length} farmer(s)`;
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

    /* A fully empty row (other than comments) is simply skipped */
    const coreFilled = ["name", "age", "gender", "district", "ta", "group", "satisfied", "follow"]
      .some((k) => String(cellMap[k].value).trim() !== "");
    if (!coreFilled) {
      return; // empty row - ignore
    }

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
    if (!String(cellMap.group.value).trim()) rowErrors.push("Group Name is required");
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
        (key === "group" && !String(el.value).trim()) ||
        (key === "satisfied" && !el.value) ||
        (key === "follow" && !el.value);
      el.classList.toggle("invalid", isBad);
    });

    if (rowErrors.length) {
      errors.push(`Row ${rowNum}: ${rowErrors.join(", ")}`);
    }
  });

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
    gender: (elForm.elements.cbvGender.value || ""),
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

  return { cbv, summary, farmers };
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
  elSubmitBtn.textContent = "Submitting...";

  try {
    const result = await submitToAppsScript(payload);

    if (result && result.success) {
      showBanner("success", `Report submitted successfully! Reference ID: ${result.submissionId || "OK"}`);
      resetForm();
    } else {
      throw new Error((result && result.error) || "The server rejected the submission.");
    }
  } catch (err) {
    console.error("Submission failed:", err);
    showBanner("error", `Submission failed. Please check your connection and try again. (${err.message})`);
  } finally {
    elSubmitBtn.disabled = false;
    elSubmitBtn.textContent = "Submit Report";
    /* Bring the result into view */
    window.scrollTo({ top: 0, behavior: "smooth" });
  }
}

/* ---------------------------------------------------------
   Reset the whole form to a blank state
   --------------------------------------------------------- */
function resetForm() {
  elForm.reset();
  /* Rebuild the farmer table with a single clean row */
  elTableBody.innerHTML = "";
  addFarmerRow();
  /* Clear any leftover validation highlighting */
  elForm.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid"));
  elForm.querySelectorAll(".field-error").forEach((el) => (el.textContent = ""));
  elTableError.textContent = "";
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

  /* Inject district options into the CBV section */
  $("cbvDistrict").insertAdjacentHTML("beforeend", buildDistrictOptions());

  /* Event listeners */
  elAddRow.addEventListener("click", addFarmerRow);
  elForm.addEventListener("submit", handleSubmit);
  elForm.addEventListener("reset", resetForm);

  /* Delegate delete-row clicks to the tbody (works for all rows) */
  elTableBody.addEventListener("click", (event) => {
    const btn = event.target.closest(".delete-row");
    if (btn) deleteFarmerRow(btn.closest("tr"));
  });

  /* Start with one empty farmer row */
  addFarmerRow();
}

/* Run when the DOM is fully loaded */
document.addEventListener("DOMContentLoaded", init);
