/**
 * Farmers Report - Google Apps Script backend
 *
 * Receives the form payload (CBV + summary + farmers) as JSON and writes it
 * to a private Google Sheet.
 *
 * Two sheets are managed inside the spreadsheet:
 *   Submissions - one row per report (CBV + summary), keyed by Submission ID.
 *   Farmers     - one row per farmer, linked back to a report by Submission ID.
 *
 * Continuation: if a payload arrives carrying an existing submissionId, this
 * is a follow-up submission from the same CBV. Only the new farmer rows are
 * appended under that ID and the Submissions row's summary numbers (Farmers
 * Reached / Number of Farmers) are refreshed. No duplicate Submissions row is
 * created.
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
  "Submission ID",
  "Row #",
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
    if (farmSheet.getLastRow() === 0) farmSheet.appendRow(FARMER_HEADERS);

    const requestedId = String(payload.submissionId || "").trim();
    const existing = requestedId ? getSubmissionRow_(subSheet, requestedId) : null;

    /* ---------- Follow-up: append farmers under the existing report ---------- */
    if (existing) {
      const startRowNo = countFarmerRows_(farmSheet, requestedId);
      const appended = appendFarmerRows_(farmSheet, requestedId, startRowNo, payload.farmers || []);
      const total = countFarmerRows_(farmSheet, requestedId);
      updateSubmissionSummary_(subSheet, existing.row, payload.summary || {}, total);
      return respond(true, "Farmers added to the existing report.", {
        submissionId: requestedId,
        appended: appended.length,
        totalFarmers: total,
      });
    }

    /* ---------- New submission ---------- */
    const submissionId = "FR-" + Utilities.getUuid().slice(0, 8).toUpperCase();
    const now = new Date();
    const cbv = payload.cbv || {};
    const summary = payload.summary || {};

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

    const appended = appendFarmerRows_(farmSheet, submissionId, 0, payload.farmers || []);
    const total = countFarmerRows_(farmSheet, submissionId);

    const subRow = getSubmissionRow_(subSheet, submissionId);
    if (subRow) updateSubmissionSummary_(subSheet, subRow.row, summary, total);

    return respond(true, "Report submitted successfully.", {
      submissionId: submissionId,
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
  const data = subSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(requestedId).trim()) {
      return { row: i + 2, values: data[i] };
    }
  }
  return null;
}

/* Count how many farmer rows already exist for a submission. */
function countFarmerRows_(farmSheet, requestedId) {
  const lastRow = farmSheet.getLastRow();
  if (lastRow < 2) return 0;
  const data = farmSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let count = 0;
  for (let i = 0; i < data.length; i++) {
    if (String(data[i][0]).trim() === String(requestedId).trim()) count++;
  }
  return count;
}

/* Append farmer rows for a submission, continuing the Row # sequence. Returns the rows. */
function appendFarmerRows_(farmSheet, requestedId, startRowNo, farmers) {
  const rows = [];
  let rowNo = startRowNo;
  farmers.forEach((f) => {
    rowNo++;
    rows.push([
      requestedId,
      rowNo,
      f.name || "",
      f.age != null ? f.age : "",
      f.gender || "",
      f.district || "",
      f.ta || "",
      f.groupName || "",
      f.satisfied || "",
      f.followUp || "",
      f.comments || "",
    ]);
  });
  if (rows.length) {
    farmSheet.getRange(farmSheet.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  }
  return rows;
}

/* Refresh the "Farmers Reached" and "Number of Farmers" cells on a Submissions row. */
function updateSubmissionSummary_(subSheet, rowNumber, summary, totalFarmers) {
  if (summary.farmersReached != null) {
    subSheet.getRange(rowNumber, FARMERS_REACHED_COL).setValue(summary.farmersReached);
  }
  subSheet.getRange(rowNumber, NUMBER_OF_FARMERS_COL).setValue(totalFarmers);
}
