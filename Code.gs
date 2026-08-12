/**
 * Farmers Report - Google Apps Script backend
 *
 * Receives the form payload (CBV + summary + farmers) as JSON and writes it
 * to a private Google Sheet.
 *
 * Two sheets are managed inside the spreadsheet:
 *   Submissions - one row per CBV report (CBV details + summary).
 *   Farmers     - one row per farmer, identified by the CBV name.
 *
 * Linking: the two tables are linked by the CBV's name (Name / Dzina Lanu),
 * the same name entered in the CBV section. Farmers accumulate under the name
 * of the CBV who submitted them, so the same CBV always lands in the same
 * report no matter when, or from which device/browser, they submit. Only the
 * new farmer rows are appended and the Submissions row's summary numbers
 * (Farmers Reached / Number of Farmers) are refreshed. No duplicate
 * Submissions row is created for the same CBV.
 */

const SPREADSHEET_ID = "1XtMJTwIgBbMLitbYrp2k9r-lUwVQ9YdSgWiNqwP0zbQ";

const SUBMISSIONS_SHEET = "Submissions";
const FARMERS_SHEET = "Farmers";

/* Column indexes (1-based) inside the Submissions sheet */
const SUBMISSION_ID_COL = 1;
const FARMERS_REACHED_COL = 9;
const NUMBER_OF_FARMERS_COL = 11;

const SUBMISSION_HEADERS = [
  "Submission ID",
  "Submitted At",
  "CBV Name",
  "CBV Age",
  "CBV Gender",
  "District",
  "T/A",
  "Group Name",
  "Farmers Reached",
  "Common Questions",
  "Number of Farmers",
];

const FARMER_HEADERS = [
  "Row #",
  "CBV Name",
  "Farmer Name",
  "Age",
  "Gender",
  "District",
  "T/A",
  "Group Name",
  "Satisfied",
  "Follow Up",
  "Comments",
];

/* A uniform JSON response helper */
function respond(status, message, extra) {
  const out = { success: status, message: message };
  if (extra) {
    for (const key in extra) out[key] = extra[key];
  }
  return ContentService
    .createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return HtmlService
    .createHtmlOutput(
      "<h1>Farmers Report API</h1>" +
      "<p>This web app only accepts POST requests from the Farmers Report form.</p>"
    )
    .setTitle("Farmers Report API");
}

function doPost(e) {
  try {
    const payload = JSON.parse(e.postData.contents);

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const subSheet = ss.getSheetByName(SUBMISSIONS_SHEET) || ss.insertSheet(SUBMISSIONS_SHEET);
    const farmSheet = ss.getSheetByName(FARMERS_SHEET) || ss.insertSheet(FARMERS_SHEET);

    if (subSheet.getLastRow() === 0) subSheet.appendRow(SUBMISSION_HEADERS);
    ensureFarmerSheet_(farmSheet);

    const cbv = payload.cbv || {};
    const summary = payload.summary || {};
    const cbvName = String(cbv.name || "").trim();

    if (!cbvName) {
      return respond(false, "CBV name is required.");
    }

    /* The two tables are linked by the CBV's name (Name / Dzina Lanu), so the
       same CBV always accumulates farmers under one report - no matter when,
       or from which device or browser, they submit. */
    const existing = getSubmissionByCbv_(subSheet, cbvName);

    /* ---------- Same CBV: append farmers under their existing report ---------- */
    if (existing) {
      const startRowNo = countFarmerRows_(farmSheet, cbvName);
      const appended = appendFarmerRows_(farmSheet, existing.values[0], cbvName, startRowNo, payload.farmers || []);
      const total = countFarmerRows_(farmSheet, cbvName);
      updateSubmissionSummary_(subSheet, existing.row, summary, total);
      backfillCbvNames_(subSheet, farmSheet);
      return respond(true, "Farmers added to the existing report.", {
        submissionId: existing.values[0],
        cbvName: cbvName,
        appended: appended.length,
        totalFarmers: total,
      });
    }

    /* ---------- New CBV: create their first report ---------- */
    const submissionId = "FR-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const now = new Date();

    subSheet.appendRow([
      submissionId,
      now,
      cbv.name || "",
      cbv.age != null ? cbv.age : "",
      cbv.gender || "",
      cbv.district || "",
      cbv.ta || "",
      cbv.group || "",
      summary.farmersReached != null ? summary.farmersReached : "",
      summary.commonQuestions || "",
    ]);

    const appended = appendFarmerRows_(farmSheet, submissionId, cbvName, 0, payload.farmers || []);
    const total = countFarmerRows_(farmSheet, cbvName);

    const subRow = getSubmissionRow_(subSheet, submissionId);
    if (subRow) updateSubmissionSummary_(subSheet, subRow.row, summary, total);
    backfillCbvNames_(subSheet, farmSheet);

    return respond(true, "Report submitted successfully.", {
      submissionId: submissionId,
      cbvName: cbvName,
      appended: appended.length,
      totalFarmers: total,
    });
  } catch (err) {
    return respond(false, "Server error: " + err.message);
  }
}

/* Find the row (2..lastRow) of a submission by its ID. Returns { row, values } or null. */
function getSubmissionRow_(subSheet, requestedId) {
  const lastRow = subSheet.getLastRow();
  if (lastRow < 2) return null;
  const data = subSheet.getRange(2, 1, lastRow - 1, SUBMISSION_HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(requestedId).trim()) {
      return { row: i + 2, values: data[i] };
    }
  }
  return null;
}

/* Find an existing submission for the same CBV by name. */
function getSubmissionByCbv_(subSheet, cbvName) {
  const lastRow = subSheet.getLastRow();
  if (lastRow < 2) return null;
  const data = subSheet.getRange(2, 1, lastRow - 1, SUBMISSION_HEADERS.length).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][2]).trim() === String(cbvName).trim()) {
      return { row: i + 2, values: data[i] };
    }
  }
  return null;
}

/* Normalize a header for matching: lower-case, drop bracketed notes such as
   "(Dzina)" / "(Eya/Ayi)", collapse whitespace. */
function normalizeHeader_(text) {
  return String(text)
    .replace(/\s*\([^)]*\)\s*/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/* Match a sheet header to one of the canonical FARMER_HEADERS. Tolerates the
   bilingual labels the sheet uses (e.g. "Farmer Name (Dzina)",
   "Satisfied? (Eya/Ayi)"). Returns the canonical header text, or "" if no
   match. */
function matchFarmerHeader_(sheetHeader) {
  const normalized = normalizeHeader_(sheetHeader);
  if (!normalized) return "";
  const candidates = FARMER_HEADERS.filter((h) => {
    const n = normalizeHeader_(h);
    return n && (normalized === n || normalized.includes(n) || n.includes(normalized));
  });
  if (!candidates.length) return "";
  const exact = candidates.filter((h) => normalizeHeader_(h) === normalized);
  const pool = exact.length ? exact : candidates;
  pool.sort((a, b) => normalizeHeader_(b).length - normalizeHeader_(a).length);
  return pool[0];
}

/* Find a column's 1-based index by its header text. Returns 0 if not found. */
function findColumnByHeader_(sheet, headerText) {
  const lastCol = sheet.getLastColumn();
  if (lastCol < 1) return 0;
  const headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const wanted = normalizeHeader_(headerText);
  for (let i = 0; i < headers.length; i++) {
    if (normalizeHeader_(headers[i]) === wanted) return i + 1;
  }
  for (let i = 0; i < headers.length; i++) {
    const n = normalizeHeader_(headers[i]);
    if (n && (n.includes(wanted) || wanted.includes(n))) return i + 1;
  }
  return 0;
}

/* Map every canonical farmer header name to its 1-based column index in the
   Farmers sheet, matching headers that carry bilingual labels. */
function getFarmerColumnMap_(farmSheet) {
  const lastCol = farmSheet.getLastColumn();
  const headers = farmSheet.getRange(1, 1, 1, lastCol).getValues()[0];
  const map = {};
  for (let i = 0; i < headers.length; i++) {
    const canonical = matchFarmerHeader_(headers[i]);
    if (canonical && map[canonical] == null) map[canonical] = i + 1;
  }
  return map;
}

/* Make sure the Farmers sheet has a "CBV Name" column. The user may have added
   it manually anywhere - if it exists, its position is respected. If it is
   missing, insert it right after "Row #" (or "Submission ID" on legacy sheets). */
function ensureFarmerSheet_(farmSheet) {
  if (farmSheet.getLastRow() === 0) {
    farmSheet.appendRow(FARMER_HEADERS);
    return;
  }
  if (findColumnByHeader_(farmSheet, "CBV Name")) return;

  const after = findColumnByHeader_(farmSheet, "Row #") ||
                findColumnByHeader_(farmSheet, "Submission ID");
  if (after) {
    farmSheet.insertColumnAfter(after);
    farmSheet.getRange(1, after + 1).setValue("CBV Name");
  } else {
    farmSheet.getRange(1, farmSheet.getLastColumn() + 1).setValue("CBV Name");
  }
}

/* Count how many farmer rows already exist for a CBV (by CBV name). */
function countFarmerRows_(farmSheet, cbvName) {
  const cbvCol = findColumnByHeader_(farmSheet, "CBV Name");
  if (!cbvCol) return 0;
  const lastRow = farmSheet.getLastRow();
  if (lastRow < 2) return 0;
  const data = farmSheet.getRange(2, cbvCol, lastRow - 1, 1).getValues();
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(cbvName).trim()) count++;
  }
  return count;
}

/* Append farmer rows, writing each value into its header-matched column so the
   exact column order on the sheet does not matter. Returns the rows. */
function appendFarmerRows_(farmSheet, submissionId, cbvName, startRowNo, farmers) {
  const map = getFarmerColumnMap_(farmSheet);
  const cols = {
    id: map["Submission ID"] || 0,
    rowNo: map["Row #"] || 0,
    cbvName: map["CBV Name"] || 0,
    name: map["Farmer Name"] || 0,
    age: map["Age"] || 0,
    gender: map["Gender"] || 0,
    district: map["District"] || 0,
    ta: map["T/A"] || 0,
    group: map["Group Name"] || 0,
    satisfied: map["Satisfied"] || 0,
    followUp: map["Follow Up"] || 0,
    comments: map["Comments"] || 0,
  };
  if (!cols.rowNo || !cols.cbvName) {
    throw new Error("Farmers sheet is missing the 'Row #' or 'CBV Name' column.");
  }

  const width = farmSheet.getLastColumn();
  const rows = [];
  let rowNo = startRowNo;
  farmers.forEach((f) => {
    rowNo++;
    const row = new Array(width).fill("");
    const set = (col, value) => { if (col) row[col - 1] = value; };
    set(cols.id, submissionId);
    set(cols.rowNo, rowNo);
    set(cols.cbvName, cbvName);
    set(cols.name, f.name || "");
    set(cols.age, f.age != null ? f.age : "");
    set(cols.gender, f.gender || "");
    set(cols.district, f.district || "");
    set(cols.ta, f.ta || "");
    set(cols.group, f.groupName || "");
    set(cols.satisfied, f.satisfied || "");
    set(cols.followUp, f.followUp || "");
    set(cols.comments, f.comments || "");
    rows.push(row);
  });
  if (rows.length) {
    farmSheet.getRange(farmSheet.getLastRow() + 1, 1, rows.length, width).setValues(rows);
  }
  return rows;
}

/* Auto-generate the CBV Name column from the Submissions table: for every
   farmer row whose CBV Name is blank, look up the Submission ID (the link to
   the Submissions sheet) and copy that CBV's name across. Returns how many
   rows were filled. */
function backfillCbvNames_(subSheet, farmSheet) {
  if (!subSheet || !farmSheet) return 0;

  const nameById = {};
  if (subSheet.getLastRow() > 1) {
    const subValues = subSheet
      .getRange(2, 1, subSheet.getLastRow() - 1, SUBMISSION_HEADERS.length)
      .getValues();
    for (let i = 0; i < subValues.length; i++) {
      const id = String(subValues[i][0]).trim();
      const name = String(subValues[i][2]).trim();
      if (id && name) nameById[id] = name;
    }
  }

  const map = getFarmerColumnMap_(farmSheet);
  const cbvCol = map["CBV Name"] || 0;
  const idCol = map["Submission ID"] || 0;
  const lastRow = farmSheet.getLastRow();
  if (!cbvCol || lastRow < 2) return 0;

  const width = farmSheet.getLastColumn();
  const range = farmSheet.getRange(2, 1, lastRow - 1, width);
  const values = range.getValues();
  let updated = 0;
  for (let i = 0; i < values.length; i++) {
    if (String(values[i][cbvCol - 1]).trim()) continue;
    let name = "";
    if (idCol) name = nameById[String(values[i][idCol - 1]).trim()] || "";
    if (!name) continue;
    values[i][cbvCol - 1] = name;
    updated++;
  }
  if (updated) range.setValues(values);
  return updated;
}

/* Run manually from the Apps Script editor to fill the CBV Name column once. */
function backfillCbvNames() {
  const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  const filled = backfillCbvNames_(
    ss.getSheetByName(SUBMISSIONS_SHEET),
    ss.getSheetByName(FARMERS_SHEET)
  );
  Logger.log("Backfilled CBV names on " + filled + " farmer row(s).");
  return filled;
}

/* Refresh the "Farmers Reached" and "Number of Farmers" cells on a Submissions row. */
function updateSubmissionSummary_(subSheet, rowNumber, summary, totalFarmers) {
  if (summary.farmersReached != null) {
    subSheet.getRange(rowNumber, FARMERS_REACHED_COL).setValue(summary.farmersReached);
  }
  subSheet.getRange(rowNumber, NUMBER_OF_FARMERS_COL).setValue(totalFarmers);
}
