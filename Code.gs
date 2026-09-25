const SPREADSHEET_ID = "1YNXMaR2qe0TXS3MINdD3ikkMS8r-GHcoFpmWgyZ4b34";

const SUBMISSIONS_SHEET = "Submissions";
const FARMERS_SHEET = "Farmers";

const SUBMISSION_FIELDS = [
  { key: "submissionId", header: "Submission ID", aliases: ["Submission ID"] },
  { key: "timestamp", header: "Timestamp", aliases: ["Timestamp", "Submitted At"] },
  { key: "name", header: "Name (Dzina Lanu)", aliases: ["Name (Dzina Lanu)", "CBV Name", "Name"] },
  { key: "age", header: "Age (Zaka zanu)", aliases: ["Age (Zaka zanu)", "CBV Age", "Age"] },
  { key: "gender", header: "Gender (Mamuna kapena Mkazi)", aliases: ["Gender (Mamuna kapena Mkazi)", "CBV Gender", "Gender"] },
  { key: "district", header: "District (Boma)", aliases: ["District (Boma)", "District"] },
  { key: "ta", header: "T/A", aliases: ["T/A", "TA"] },
  { key: "group", header: "Group (Dzina la Gulu)", aliases: ["Group (Dzina la Gulu)", "Group Name", "Group"] },
  { key: "farmersReached", header: "Farmers Reached (Mwafikira Alimi angati)", aliases: ["Farmers Reached (Mwafikira Alimi angati)", "Farmers Reached"] },
  { key: "commonQuestions", header: "Common Questions (Mafunso)", aliases: ["Common Questions (Mafunso)", "Common Questions"] },
  { key: "numberOfFarmers", header: "Number of Farmers", aliases: ["Number of Farmers"] },
];

const FARMER_FIELDS = [
  { key: "cbvName", header: "CBV Name", aliases: ["CBV Name"] },
  { key: "farmerName", header: "Farmer Name (Dzina)", aliases: ["Farmer Name (Dzina)", "Farmer Name"] },
  { key: "age", header: "Age (Zaka)", aliases: ["Age (Zaka)", "Age"] },
  { key: "gender", header: "Gender (Mamuna/Mkazi)", aliases: ["Gender (Mamuna/Mkazi)", "Gender"] },
  { key: "district", header: "District (Boma)", aliases: ["District (Boma)", "District"] },
  { key: "ta", header: "T/A", aliases: ["T/A", "TA"] },
  { key: "groupName", header: "Group Name", aliases: ["Group Name", "Group"] },
  { key: "satisfied", header: "Satisfied? (Eya/Ayi)", aliases: ["Satisfied? (Eya/Ayi)", "Satisfied?", "Satisfied"] },
  { key: "followUp", header: "Follow Up Visit (Eya/Ayi)", aliases: ["Follow Up Visit (Eya/Ayi)", "Follow Up", "Follow Up?"] },
  { key: "comments", header: "Comments (Zowonjezera)", aliases: ["Comments (Zowonjezera)", "Comments"] },
];

const OPTIONAL_SUBMISSION_FIELDS = [
  { key: "submissionDate", aliases: ["Submission Date"] },
];

const OPTIONAL_FARMER_FIELDS = [
  { key: "submissionDate", aliases: ["Submission Date"] },
];

function respond(status, message, extra) {
  const output = { success: status, message: message };
  if (!status) output.error = message;
  if (extra) {
    for (const key in extra) output[key] = extra[key];
  }
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return HtmlService
    .createHtmlOutput(
      "<h1>Farmers Report API</h1>" +
      "<p>This web app accepts farmer report submissions.</p>"
    )
    .setTitle("Farmers Report API");
}

function doPost(e) {
  try {
    const contents = e && e.postData && e.postData.contents;
    if (!contents) throw new Error("The request body is empty.");
    const payload = JSON.parse(contents);
    validatePayload_(payload);

    const spreadsheet = SpreadsheetApp.openById(SPREADSHEET_ID);
    const submissionsSheet = getRequiredSheet_(spreadsheet, SUBMISSIONS_SHEET);
    const farmersSheet = getRequiredSheet_(spreadsheet, FARMERS_SHEET);
    const submissionsSchema = ensureSchema_(submissionsSheet, SUBMISSION_FIELDS, OPTIONAL_SUBMISSION_FIELDS);
    const farmersSchema = ensureSchema_(farmersSheet, FARMER_FIELDS, OPTIONAL_FARMER_FIELDS);
    const cbv = payload.cbv;
    const summary = payload.summary;
    const now = new Date();

    let existing = null;
    const requestedId = text_(payload.submissionId);
    if (requestedId) {
      existing = getSubmissionRow_(submissionsSheet, submissionsSchema, requestedId);
      if (existing && !sameCbv_(existing.values, submissionsSchema, cbv)) existing = null;
    }
    if (!existing) existing = getSubmissionByCbv_(submissionsSheet, submissionsSchema, cbv);

    if (existing) {
      let submissionId = text_(valueAt_(existing.values, submissionsSchema.map, "submissionId"));
      if (!submissionId) {
        submissionId = createSubmissionId_();
        submissionsSheet.getRange(existing.row, submissionsSchema.map.submissionId + 1).setValue(submissionId);
      }

      const appended = appendFarmerRows_(farmersSheet, farmersSchema, payload.farmers, cbv, now);
      const total = countFarmerRows_(farmersSheet, farmersSchema, cbv);
      updateSubmissionSummary_(submissionsSheet, submissionsSchema, existing.row, summary, total);
      return respond(true, "Farmers added to the existing report.", {
        submissionId: submissionId,
        appended: appended.length,
        totalFarmers: total,
      });
    }

    const submissionId = createSubmissionId_();
    const submissionRow = appendSubmission_(submissionsSheet, submissionsSchema, submissionId, cbv, summary, now);
    const farmerStartRow = nextDataRow_(farmersSheet, farmersSchema.width);

    try {
      const appended = appendFarmerRows_(farmersSheet, farmersSchema, payload.farmers, cbv, now);
      const total = countFarmerRows_(farmersSheet, farmersSchema, cbv);
      const savedSubmissionRow = getSubmissionRow_(submissionsSheet, submissionsSchema, submissionId);
      if (!savedSubmissionRow) throw new Error("The new submission row could not be read back.");
      updateSubmissionSummary_(submissionsSheet, submissionsSchema, savedSubmissionRow.row, summary, total);

      return respond(true, "Report submitted successfully.", {
        submissionId: submissionId,
        appended: appended.length,
        totalFarmers: total,
      });
    } catch (error) {
      try {
        farmersSheet.getRange(farmerStartRow, 1, payload.farmers.length, farmersSchema.width).clearContent();
      } catch (ignored) {
      }
      try {
        submissionsSheet.getRange(submissionRow, 1, 1, submissionsSchema.width).clearContent();
      } catch (ignored) {
      }
      throw new Error("Farmers sheet write failed: " + error.message);
    }
  } catch (error) {
    return respond(false, "Server error: " + error.message);
  }
}

function validatePayload_(payload) {
  if (!payload || typeof payload !== "object") throw new Error("Invalid submission payload.");

  const cbv = payload.cbv || {};
  if (!text_(cbv.name) || text_(cbv.name).length < 2) throw new Error("CBV name is required.");
  const cbvAge = Number(cbv.age);
  if (!Number.isInteger(cbvAge) || cbvAge < 5 || cbvAge > 120) throw new Error("CBV age must be a whole number between 5 and 120.");
  if (!isAllowedValue_(cbv.gender, ["Mamuna", "Mkazi"])) throw new Error("CBV gender is invalid.");
  if (!text_(cbv.district)) throw new Error("CBV district is required.");
  if (!text_(cbv.ta) || text_(cbv.ta).length < 2) throw new Error("CBV T/A is required.");
  if (!text_(cbv.group) || text_(cbv.group).length < 2) throw new Error("CBV group is required.");

  const summary = payload.summary || {};
  const reached = Number(summary.farmersReached);
  if (!Number.isInteger(reached) || reached < 0 || reached > 10000) throw new Error("Farmers reached is invalid.");
  if (summary.commonQuestions != null && String(summary.commonQuestions).length > 5000) throw new Error("Common questions is too long.");

  const farmers = Array.isArray(payload.farmers) ? payload.farmers : [];
  if (!farmers.length) throw new Error("At least one farmer is required.");
  farmers.forEach((farmer, index) => {
    if (!farmer || typeof farmer !== "object") throw new Error("Farmer row " + (index + 1) + " is invalid.");
    if (!text_(farmer.name)) throw new Error("Farmer name is required on row " + (index + 1) + ".");
    const age = Number(farmer.age);
    if (!Number.isInteger(age) || age < 1 || age > 120) throw new Error("Farmer age is invalid on row " + (index + 1) + ".");
    if (!isAllowedValue_(farmer.gender, ["Mamuna", "Mkazi"])) throw new Error("Farmer gender is invalid on row " + (index + 1) + ".");
    if (!text_(farmer.district)) throw new Error("Farmer district is required on row " + (index + 1) + ".");
    if (!text_(farmer.ta) || text_(farmer.ta).length < 2) throw new Error("Farmer T/A is required on row " + (index + 1) + ".");
    if (!isAllowedValue_(farmer.satisfied, ["Eya", "Ayi"])) throw new Error("Satisfied value is invalid on row " + (index + 1) + ".");
    if (!isAllowedValue_(farmer.followUp, ["Eya", "Ayi"])) throw new Error("Follow-up value is invalid on row " + (index + 1) + ".");
  });
}

function getRequiredSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) throw new Error("Required sheet tab not found: " + name);
  return sheet;
}

function getLastContentColumn_(sheet) {
  const lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) return 0;
  const values = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  for (let i = values.length - 1; i >= 0; i--) {
    if (text_(values[i]) !== "") return i + 1;
  }
  return 0;
}

function getLastContentRow_(sheet, width) {
  const lastRow = sheet.getLastRow();
  if (lastRow < 2) return 0;
  const readWidth = Math.max(width, 1);
  const values = sheet.getRange(2, 1, lastRow - 1, readWidth).getValues();
  for (let i = values.length - 1; i >= 0; i--) {
    if (values[i].some((value) => text_(value) !== "")) return i + 2;
  }
  return 0;
}

function nextDataRow_(sheet, width) {
  return Math.max(getLastContentRow_(sheet, width), 1) + 1;
}

function ensureSchema_(sheet, requiredFields, optionalFields) {
  const allFields = requiredFields.concat(optionalFields || []);
  const width = Math.max(getLastContentColumn_(sheet), 1);
  const firstRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  const hasValues = firstRow.some((value) => text_(value) !== "");
  const hasHeaders = firstRow.some((value) => isKnownHeader_(value, allFields));

  if (!hasValues) {
    const headers = requiredFields.map((field) => field.header);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (!hasHeaders) {
    throw new Error("The " + sheet.getName() + " header row is invalid. Restore its column headings before submitting.");
  } else {
    const map = mapHeaders_(sheet, allFields);
    const missing = requiredFields.filter((field) => map[field.key] < 0);
    if (missing.length) {
      const startColumn = getLastContentColumn_(sheet) + 1;
      sheet.getRange(1, startColumn, 1, missing.length).setValues([missing.map((field) => field.header)]);
    }
  }

  return buildSchema_(sheet, allFields);
}

function buildSchema_(sheet, fields) {
  const lastColumn = Math.max(getLastContentColumn_(sheet), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const map = {};
  const used = {};

  fields.forEach((field) => {
    const aliases = (field.aliases || [field.header]).map(normalizeHeader_);
    map[field.key] = -1;
    for (let i = 0; i < headers.length; i++) {
      if (used[i]) continue;
      if (aliases.indexOf(normalizeHeader_(headers[i])) !== -1) {
        map[field.key] = i;
        used[i] = true;
        break;
      }
    }
  });

  return { map: map, width: lastColumn };
}

function mapHeaders_(sheet, fields) {
  const lastColumn = Math.max(getLastContentColumn_(sheet), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const map = {};
  const used = {};

  fields.forEach((field) => {
    const aliases = (field.aliases || [field.header]).map(normalizeHeader_);
    map[field.key] = -1;
    for (let i = 0; i < headers.length; i++) {
      if (used[i]) continue;
      if (aliases.indexOf(normalizeHeader_(headers[i])) !== -1) {
        map[field.key] = i;
        used[i] = true;
        break;
      }
    }
  });

  return map;
}

function normalizeHeader_(value) {
  return String(value == null ? "" : value)
    .toLowerCase()
    .replace(/\([^)]*\)/g, "")
    .replace(/[^a-z0-9]+/g, "");
}

function isKnownHeader_(value, fields) {
  const normalized = normalizeHeader_(value);
  if (!normalized) return false;
  return fields.some((field) => (field.aliases || [field.header]).some((alias) => normalizeHeader_(alias) === normalized));
}

function text_(value) {
  return String(value == null ? "" : value).trim();
}

function isAllowedValue_(value, allowed) {
  return allowed.indexOf(text_(value)) !== -1;
}

function valueAt_(values, map, key) {
  const index = map[key];
  return index == null || index < 0 ? "" : values[index];
}

function getRows_(sheet, schema) {
  const lastRow = getLastContentRow_(sheet, schema.width);
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, schema.width).getValues().map((values, index) => ({
    row: index + 2,
    values: values,
  }));
}

function getSubmissionRow_(sheet, schema, requestedId) {
  const target = text_(requestedId);
  if (!target) return null;
  const rows = getRows_(sheet, schema);
  for (let i = 0; i < rows.length; i++) {
    if (text_(valueAt_(rows[i].values, schema.map, "submissionId")) === target) return rows[i];
  }
  return null;
}

function getSubmissionByCbv_(sheet, schema, cbv) {
  const rows = getRows_(sheet, schema);
  for (let i = 0; i < rows.length; i++) {
    if (sameCbv_(rows[i].values, schema, cbv)) return rows[i];
  }
  return null;
}

function sameCbv_(values, schema, cbv) {
  const name = text_(valueAt_(values, schema.map, "name")).toLowerCase();
  const district = text_(valueAt_(values, schema.map, "district")).toLowerCase();
  const ta = text_(valueAt_(values, schema.map, "ta")).toLowerCase();
  const group = text_(valueAt_(values, schema.map, "group")).toLowerCase();
  const requestedName = text_(cbv.name).toLowerCase();
  const requestedDistrict = text_(cbv.district).toLowerCase();
  const requestedTa = text_(cbv.ta).toLowerCase();
  const requestedGroup = text_(cbv.group).toLowerCase();
  return name !== "" && name === requestedName &&
    district !== "" && district === requestedDistrict &&
    (!ta || !requestedTa || ta === requestedTa) &&
    (!group || !requestedGroup || group === requestedGroup);
}

function sameFarmerCbv_(values, schema, cbv) {
  const name = text_(valueAt_(values, schema.map, "cbvName")).toLowerCase();
  const district = text_(valueAt_(values, schema.map, "district")).toLowerCase();
  const ta = text_(valueAt_(values, schema.map, "ta")).toLowerCase();
  const group = text_(valueAt_(values, schema.map, "groupName")).toLowerCase();
  const requestedName = text_(cbv.name).toLowerCase();
  const requestedDistrict = text_(cbv.district).toLowerCase();
  const requestedTa = text_(cbv.ta).toLowerCase();
  const requestedGroup = text_(cbv.group).toLowerCase();
  return name !== "" && name === requestedName &&
    district !== "" && district === requestedDistrict &&
    (!ta || !requestedTa || ta === requestedTa) &&
    (!group || !requestedGroup || group === requestedGroup);
}

function countFarmerRows_(sheet, schema, cbv) {
  const rows = getRows_(sheet, schema);
  return rows.filter((row) => sameFarmerCbv_(row.values, schema, cbv)).length;
}

function createSubmissionId_() {
  return "FR-" + Utilities.getUuid().slice(0, 8).toUpperCase();
}

function appendSubmission_(sheet, schema, submissionId, cbv, summary, now) {
  const values = new Array(schema.width).fill("");
  setRowValue_(values, schema.map, "submissionId", submissionId);
  setRowValue_(values, schema.map, "timestamp", now);
  setRowValue_(values, schema.map, "name", text_(cbv.name));
  setRowValue_(values, schema.map, "age", Number(cbv.age));
  setRowValue_(values, schema.map, "gender", text_(cbv.gender));
  setRowValue_(values, schema.map, "district", text_(cbv.district));
  setRowValue_(values, schema.map, "ta", text_(cbv.ta));
  setRowValue_(values, schema.map, "group", text_(cbv.group));
  setRowValue_(values, schema.map, "farmersReached", Number(summary.farmersReached));
  setRowValue_(values, schema.map, "commonQuestions", text_(summary.commonQuestions));
  setRowValue_(values, schema.map, "numberOfFarmers", 0);
  if (schema.map.submissionDate >= 0) setRowValue_(values, schema.map, "submissionDate", now);
  const rowNumber = nextDataRow_(sheet, schema.width);
  sheet.getRange(rowNumber, 1, 1, values.length).setValues([values]);
  return rowNumber;
}

function appendFarmerRows_(sheet, schema, farmers, cbv, now) {
  const rows = [];
  (farmers || []).forEach((farmer) => {
    const values = new Array(schema.width).fill("");
    setRowValue_(values, schema.map, "cbvName", text_(cbv.name));
    setRowValue_(values, schema.map, "farmerName", text_(farmer.name));
    setRowValue_(values, schema.map, "age", Number(farmer.age));
    setRowValue_(values, schema.map, "gender", text_(farmer.gender));
    setRowValue_(values, schema.map, "district", text_(farmer.district));
    setRowValue_(values, schema.map, "ta", text_(farmer.ta));
    setRowValue_(values, schema.map, "groupName", text_(farmer.groupName));
    setRowValue_(values, schema.map, "satisfied", text_(farmer.satisfied));
    setRowValue_(values, schema.map, "followUp", text_(farmer.followUp));
    setRowValue_(values, schema.map, "comments", text_(farmer.comments));
    if (schema.map.submissionDate >= 0) setRowValue_(values, schema.map, "submissionDate", now);
    rows.push(values);
  });
  if (rows.length) sheet.getRange(nextDataRow_(sheet, schema.width), 1, rows.length, schema.width).setValues(rows);
  return rows;
}

function setRowValue_(values, map, key, value) {
  if (map[key] == null || map[key] < 0) return;
  values[map[key]] = value;
}

function updateSubmissionSummary_(sheet, schema, rowNumber, summary, totalFarmers) {
  const farmersReachedColumn = schema.map.farmersReached;
  const commonQuestionsColumn = schema.map.commonQuestions;
  const numberOfFarmersColumn = schema.map.numberOfFarmers;
  if (farmersReachedColumn >= 0) sheet.getRange(rowNumber, farmersReachedColumn + 1).setValue(Number(summary.farmersReached));
  if (commonQuestionsColumn >= 0) sheet.getRange(rowNumber, commonQuestionsColumn + 1).setValue(text_(summary.commonQuestions));
  if (numberOfFarmersColumn >= 0) sheet.getRange(rowNumber, numberOfFarmersColumn + 1).setValue(totalFarmers);
}
