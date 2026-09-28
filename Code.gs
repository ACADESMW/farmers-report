const SPREADSHEET_ID = "1YNXMaR2qe0TXS3MINdD3ikkMS8r-GHcoFpmWgyZ4b34";

/*
 * Bump this on every change and redeploy. It is echoed in every JSON response
 * so you can tell, from ?action=health, which build the web app is actually
 * serving. A stale deployment is the one failure this cannot self-heal.
 */
const APP_VERSION = "2026-09-28-r3";

const SUBMISSIONS_SHEET = "Submissions";
const FARMERS_SHEET = "Farmers";

const SUBMISSION_FIELDS = [
  { key: "timestamp", header: "Timestamp", aliases: ["Timestamp", "Submitted At"] },
  { key: "submissionDate", header: "Submission Date", aliases: ["Submission Date"] },
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
  { key: "submissionDate", header: "Submission Date", aliases: ["Submission Date"] },
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

const SPREADSHEET_EPOCH_MS = Date.UTC(1899, 11, 30);
const DAY_MS = 86400000;

/* ---------------------------------------------------------
   Responses
   --------------------------------------------------------- */
function respond(status, message, extra) {
  const output = { success: status, message: message, appVersion: APP_VERSION };
  if (!status) output.error = message;
  if (extra) {
    for (const key in extra) output[key] = extra[key];
  }
  return ContentService
    .createTextOutput(JSON.stringify(output))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ---------------------------------------------------------
   Entry point: writes
   --------------------------------------------------------- */
function doPost(e) {
  try {
    const contents = e && e.postData && e.postData.contents;
    if (!contents) throw new Error("The request body is empty.");
    const payload = JSON.parse(contents);
    validatePayload_(payload);

    const spreadsheet = openSpreadsheet_();
    const submissionsSheet = getRequiredSheet_(spreadsheet, SUBMISSIONS_SHEET);
    const farmersSheet = getRequiredSheet_(spreadsheet, FARMERS_SHEET);
    const submissionsSchema = ensureSchema_(submissionsSheet, SUBMISSION_FIELDS);
    const farmersSchema = ensureSchema_(farmersSheet, FARMER_FIELDS);

    /*
     * Refuse to write if any column could not be located. Writing with an
     * unmapped field would append a blank row that looks like real data and
     * silently discard the farmers, which is far worse than a loud failure.
     */
    assertSchemaComplete_(farmersSchema, FARMER_FIELDS, FARMERS_SHEET);
    assertSchemaComplete_(submissionsSchema, SUBMISSION_FIELDS, SUBMISSIONS_SHEET);

    const cbv = payload.cbv;
    const summary = payload.summary;
    const now = new Date();
    const farmers = Array.isArray(payload.farmers) ? payload.farmers : [];

    const existing = findSubmissionByCbv_(submissionsSheet, submissionsSchema, cbv);

    const farmerStartRow = nextDataRow_(farmersSheet, farmersSchema.width);
    let landed = 0;
    try {
      writeFarmerRows_(farmersSheet, farmersSchema, farmers, cbv, now);
      landed = verifyFarmerWrite_(farmersSheet, farmersSchema, farmerStartRow, farmers.length);
    } catch (writeError) {
      landed = 0;
    }

    if (landed !== farmers.length) {
      clearFarmerRows_(farmersSheet, farmersSchema, farmerStartRow, farmers.length);
      throw new Error(
        "Only " + landed + " of " + farmers.length + " farmer rows reached the Farmers sheet. " +
        "Nothing was added to Submissions and no partial farmer data was left behind. Please submit again."
      );
    }

    const totalFarmers = countFarmersByCbv_(farmersSheet, farmersSchema, cbv);
    const submissionRow = writeSubmissionRow_(submissionsSheet, submissionsSchema, existing, cbv, summary, now, totalFarmers);

    return respond(true, "Report submitted successfully.", {
      appended: farmers.length,
      totalFarmers: totalFarmers,
      submissionRow: submissionRow,
      submissionDate: formatStamp_(now),
      newRecord: !existing,
    });
  } catch (error) {
    return respond(false, "Server error: " + error.message);
  }
}

/* ---------------------------------------------------------
   Entry point: health and maintenance actions
   --------------------------------------------------------- */
function doGet(e) {
  const params = (e && e.parameter) || {};
  const action = text_(params.action);

  if (!action) {
    return HtmlService
      .createHtmlOutput(
        "<h1>Farmers Report API</h1>" +
        "<p>This web app accepts farmer report submissions.</p>" +
        "<p>Maintenance actions: <code>?action=health</code>, <code>?action=orphans</code>, <code>?action=count&amp;cbv=Name</code>, " +
        "<code>?action=backfillDates</code>, <code>?action=repair</code>.</p>"
      )
      .setTitle("Farmers Report API");
  }

  try {
    if (action === "health") return handleHealth_();
    if (action === "orphans") return handleOrphans_();
    if (action === "count") return handleCount_(params);
    if (action === "backfillDates") return handleBackfillDates_();
    if (action === "repair") return handleRepair_();
    return respond(false, "Unknown action: " + action);
  } catch (error) {
    return respond(false, "Server error: " + error.message);
  }
}

function handleHealth_() {
  const spreadsheet = openSpreadsheet_();
  const sheets = {};
  const tabs = spreadsheet.getSheets().map(function (sheet) {
    return sheet.getName();
  });

  [SUBMISSIONS_SHEET, FARMERS_SHEET].forEach(function (tabName) {
    const sheet = spreadsheet.getSheetByName(tabName);
    if (!sheet) {
      sheets[tabName] = { found: false };
      return;
    }
    const fields = tabName === SUBMISSIONS_SHEET ? SUBMISSION_FIELDS : FARMER_FIELDS;
    const schema = buildSchema_(sheet, fields);
    sheets[tabName] = {
      found: true,
      lastContentColumn: schema.width,
      lastDataRow: getLastContentRow_(sheet, schema.width),
      nextDataRow: nextDataRow_(sheet, schema.width),
      headers: sheet.getRange(1, 1, 1, Math.max(schema.width, 1)).getValues()[0].map(text_),
      columnMap: schema.map,
      unmappedFields: fields
        .filter(function (field) {
          return schema.map[field.key] < 0;
        })
        .map(function (field) {
          return field.key;
        }),
    };
  });

  return respond(true, "Health check complete.", {
    spreadsheetId: SPREADSHEET_ID,
    spreadsheetTitle: spreadsheet.getName(),
    spreadsheetUrl: spreadsheet.getUrl(),
    tabs: tabs,
    sheets: sheets,
  });
}

/*
 * Read-only. Finds the Submissions rows that the old, broken build left behind:
 * it wrote the Submissions row first, then wiped the farmers when the check
 * failed. Those rows are orphans - a volunteer recorded with no farmers.
 * This only lists them; it never deletes anything.
 */
function handleOrphans_() {
  const spreadsheet = openSpreadsheet_();
  const submissionsSheet = getRequiredSheet_(spreadsheet, SUBMISSIONS_SHEET);
  const farmersSheet = getRequiredSheet_(spreadsheet, FARMERS_SHEET);
  const submissionsSchema = buildSchema_(submissionsSheet, SUBMISSION_FIELDS);
  const farmersSchema = buildSchema_(farmersSheet, FARMER_FIELDS);

  const farmerCounts = {};
  getRows_(farmersSheet, farmersSchema).forEach(function (row) {
    const key = normalizeName_(valueAt_(row.values, farmersSchema.map, "cbvName"));
    if (!key) return;
    farmerCounts[key] = (farmerCounts[key] || 0) + 1;
  });

  const orphans = [];
  const names = {};
  const displayName = {};
  const rowsPerCbv = {};
  getRows_(submissionsSheet, submissionsSchema).forEach(function (row) {
    const name = text_(valueAt_(row.values, submissionsSchema.map, "name"));
    const key = normalizeName_(name);
    if (!key) return;
    names[key] = true;
    displayName[key] = name;
    rowsPerCbv[key] = (rowsPerCbv[key] || 0) + 1;
    if ((farmerCounts[key] || 0) > 0) return;
    const recorded = Number(valueAt_(row.values, submissionsSchema.map, "numberOfFarmers"));
    orphans.push({
      row: row.row,
      name: name,
      district: text_(valueAt_(row.values, submissionsSchema.map, "district")),
      submissionDate: formatStamp_(toDateValue_(valueAt_(row.values, submissionsSchema.map, "submissionDate"))),
      recordedNumberOfFarmers: Number.isFinite(recorded) ? recorded : null,
    });
  });

  /* Surplus Submissions rows for CBVs that do have farmers (legacy duplicates) */
  let extraRows = 0;
  const duplicated = [];
  Object.keys(rowsPerCbv).forEach(function (key) {
    if (rowsPerCbv[key] < 2) return;
    extraRows += rowsPerCbv[key] - 1;
    duplicated.push({
      name: displayName[key],
      submissionRows: rowsPerCbv[key],
      farmerRows: farmerCounts[key] || 0,
    });
  });

  return respond(true, "Orphan scan complete. Nothing was changed.", {
    submissionRows: getLastContentRow_(submissionsSheet, submissionsSchema.width) - 1,
    distinctCbv: Object.keys(names).length,
    orphanRows: orphans.length,
    orphans: orphans,
    duplicateCbv: duplicated.length,
    surplusSubmissionRows: extraRows,
    duplicated: duplicated,
  });
}

function handleCount_(params) {
  const name = text_(params.cbv);
  if (!name) return respond(false, "Pass the CBV name, for example ?action=count&cbv=Memory%20Mbewe");

  const spreadsheet = openSpreadsheet_();
  const submissionsSheet = getRequiredSheet_(spreadsheet, SUBMISSIONS_SHEET);
  const farmersSheet = getRequiredSheet_(spreadsheet, FARMERS_SHEET);
  const submissionsSchema = buildSchema_(submissionsSheet, SUBMISSION_FIELDS);
  const farmersSchema = buildSchema_(farmersSheet, FARMER_FIELDS);

  const total = countFarmersByCbv_(farmersSheet, farmersSchema, { name: name });
  const submission = params.district
    ? findSubmissionByCbv_(submissionsSheet, submissionsSchema, {
      name: name,
      district: text_(params.district),
      ta: "",
      group: "",
    })
    : findSubmissionByName_(submissionsSheet, submissionsSchema, name);

  return respond(true, "Counted farmer rows for " + name + ".", {
    cbv: name,
    normalizedName: normalizeName_(name),
    farmerRowsInSheet: total,
    submissionRow: submission ? submission.row : null,
    recordedNumberOfFarmers: submission
      ? text_(valueAt_(submission.values, submissionsSchema.map, "numberOfFarmers"))
      : null,
  });
}

/*
 * Fills blank Submission Date cells in the Farmers tab using the earliest
 * Submission Date recorded for that CBV in the Submissions tab. The original
 * Google Form never captured a per-farmer timestamp, so the value is inferred
 * from the CBV's earliest report rather than reconstructed.
 */
function handleBackfillDates_() {
  const spreadsheet = openSpreadsheet_();
  const submissionsSheet = getRequiredSheet_(spreadsheet, SUBMISSIONS_SHEET);
  const farmersSheet = getRequiredSheet_(spreadsheet, FARMERS_SHEET);
  const submissionsSchema = ensureSchema_(submissionsSheet, SUBMISSION_FIELDS);
  const farmersSchema = ensureSchema_(farmersSheet, FARMER_FIELDS);

  const dateColumn = farmersSchema.map.submissionDate;
  if (dateColumn < 0) return respond(false, "The Farmers sheet has no 'Submission Date' column.");

  const earliestByCbv = {};
  getRows_(submissionsSheet, submissionsSchema).forEach(function (row) {
    const key = normalizeName_(valueAt_(row.values, submissionsSchema.map, "name"));
    const date = toDateValue_(valueAt_(row.values, submissionsSchema.map, "submissionDate"));
    if (!key || !date) return;
    if (!earliestByCbv[key] || date.getTime() < earliestByCbv[key].getTime()) earliestByCbv[key] = date;
  });

  const updates = [];
  const unmatched = {};
  let alreadyFilled = 0;
  let emptySpacerRows = 0;

  getRows_(farmersSheet, farmersSchema).forEach(function (row) {
    const cbvCell = text_(valueAt_(row.values, farmersSchema.map, "cbvName"));
    const farmerCell = text_(valueAt_(row.values, farmersSchema.map, "farmerName"));
    if (!cbvCell && !farmerCell) {
      emptySpacerRows++;
      return;
    }
    if (text_(valueAt_(row.values, farmersSchema.map, "submissionDate")) !== "") {
      alreadyFilled++;
      return;
    }
    const key = normalizeName_(cbvCell);
    const date = earliestByCbv[key];
    if (!date) {
      const label = key || "(no cbv name)";
      unmatched[label] = (unmatched[label] || 0) + 1;
      return;
    }
    updates.push({ row: row.row, value: date });
  });

  const patched = patchSingleColumn_(farmersSheet, dateColumn + 1, updates, false);

  return respond(true, "Backfill complete.", {
    farmerRows: getLastContentRow_(farmersSheet, farmersSchema.width) - 1,
    alreadyHadDate: alreadyFilled,
    emptySpacerRowsSkipped: emptySpacerRows,
    filled: patched,
    stillBlank: Object.keys(unmatched).reduce(function (sum, key) {
      return sum + unmatched[key];
    }, 0),
    unmatchedByCbv: unmatched,
  });
}

/*
 * Recomputes Number of Farmers on the most recent Submissions row of every
 * CBV from the farmer rows that actually exist in the Farmers tab.
 */
function handleRepair_() {
  const spreadsheet = openSpreadsheet_();
  const submissionsSheet = getRequiredSheet_(spreadsheet, SUBMISSIONS_SHEET);
  const farmersSheet = getRequiredSheet_(spreadsheet, FARMERS_SHEET);
  const submissionsSchema = ensureSchema_(submissionsSheet, SUBMISSION_FIELDS);
  const farmersSchema = ensureSchema_(farmersSheet, FARMER_FIELDS);

  const totalColumn = submissionsSchema.map.numberOfFarmers;
  if (totalColumn < 0) return respond(false, "The Submissions sheet has no 'Number of Farmers' column.");

  const countsByCbv = {};
  getRows_(farmersSheet, farmersSchema).forEach(function (row) {
    const key = normalizeName_(valueAt_(row.values, farmersSchema.map, "cbvName"));
    if (key) countsByCbv[key] = (countsByCbv[key] || 0) + 1;
  });

  const canonical = {};
  getRows_(submissionsSheet, submissionsSchema).forEach(function (row) {
    const key = cbvKey_(
      valueAt_(row.values, submissionsSchema.map, "name"),
      valueAt_(row.values, submissionsSchema.map, "district")
    );
    if (!key) return;
    if (!canonical[key] || row.row > canonical[key].row) canonical[key] = row;
  });

  const updates = [];
  const changes = [];
  Object.keys(canonical).forEach(function (key) {
    const row = canonical[key];
    const name = valueAt_(row.values, submissionsSchema.map, "name");
    const total = countsByCbv[normalizeName_(name)] || 0;
    const current = Number(valueAt_(row.values, submissionsSchema.map, "numberOfFarmers"));
    if (Number.isInteger(current) && current === total) return;
    updates.push({ row: row.row, value: total });
    changes.push({ row: row.row, cbv: text_(name), from: current, to: total });
  });

  const patched = patchSingleColumn_(submissionsSheet, totalColumn + 1, updates, true);

  return respond(true, "Repair complete.", {
    cbvRecords: Object.keys(canonical).length,
    changed: patched,
    changes: changes,
  });
}

/* ---------------------------------------------------------
   Validation
   --------------------------------------------------------- */
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
  farmers.forEach(function (farmer, index) {
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

/* ---------------------------------------------------------
   Sheet helpers
   --------------------------------------------------------- */
function getRequiredSheet_(spreadsheet, name) {
  const sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    const present = spreadsheet.getSheets().map(function (tab) {
      return "'" + tab.getName() + "'";
    }).join(", ");
    throw new Error(
      "The '" + name + "' tab is missing from spreadsheet " + SPREADSHEET_ID +
      ". Tabs found: " + present + ". Nothing was changed."
    );
  }
  return sheet;
}

/*
 * Opening the workbook is the step most likely to fail after the project sheet
 * is replaced, because a replacement has a brand new ID. Turn that into a
 * message that says what to change instead of a bare permission error.
 */
function openSpreadsheet_() {
  try {
    return SpreadsheetApp.openById(SPREADSHEET_ID);
  } catch (error) {
    throw new Error(
      "Cannot open spreadsheet " + SPREADSHEET_ID + " (" + error.message + "). " +
      "If the project sheet was replaced, the new sheet has a different ID: open it, copy the text " +
      "between /d/ and /edit in its URL, put it in SPREADSHEET_ID at the top of Code.gs, and create " +
      "a new deployment. Nothing was changed."
    );
  }
}

/* Compact description of the first few rows, for error messages */
function previewRow_(sheet) {
  const cells = sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getValues()[0]
    .map(text_)
    .filter(function (value) {
      return value !== "";
    });
  return cells.length ? cells.slice(0, 5).join(" | ") : "(row 1 is empty)";
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
    if (values[i].some(function (value) {
      return text_(value) !== "";
    })) return i + 2;
  }
  return 0;
}

function nextDataRow_(sheet, width) {
  return Math.max(getLastContentRow_(sheet, width), 1) + 1;
}

function ensureSchema_(sheet, requiredFields) {
  const width = Math.max(getLastContentColumn_(sheet), 1);
  const firstRow = sheet.getRange(1, 1, 1, width).getValues()[0];
  const hasValues = firstRow.some(function (value) {
    return text_(value) !== "";
  });
  const hasHeaders = firstRow.some(function (value) {
    return isKnownHeader_(value, requiredFields);
  });

  if (!hasValues) {
    const headers = requiredFields.map(function (field) {
      return field.header;
    });
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else if (!hasHeaders) {
    throw new Error(
      "The '" + sheet.getName() + "' sheet has no recognisable headings in row 1 (found: " +
      previewRow_(sheet) + "). The column headings must sit in row 1. " +
      "If your headings are on another row, delete the rows above them so the headings are in row 1, " +
      "then submit again. Nothing was changed."
    );
  } else {
    const map = mapHeaders_(sheet, requiredFields);
    const missing = requiredFields.filter(function (field) {
      return map[field.key] < 0;
    });
    if (missing.length) {
      const startColumn = getLastContentColumn_(sheet) + 1;
      const headers = missing.map(function (field) {
        return field.header;
      });
      sheet.getRange(1, startColumn, 1, headers.length).setValues([headers]);
    }
  }

  return buildSchema_(sheet, requiredFields);
}

/*
 * Hard stop before any write. If a heading still cannot be found after
 * ensureSchema_ has had a chance to add it, the sheet has been restructured by
 * hand (or is protected). Appending rows now would produce blank rows and
 * silently lose the farmers, so stop and say exactly what is wrong.
 */
function assertSchemaComplete_(schema, fields, sheetName) {
  const missing = fields.filter(function (field) {
    return schema.map[field.key] < 0;
  });
  if (!missing.length) return;

  throw new Error(
    "Stopped before writing: the '" + sheetName + "' sheet is missing these column headings - " +
    missing.map(function (field) {
      return "'" + field.header + "'";
    }).join(", ") +
    ". Nothing was changed. Add the headings in row 1 of that tab (or restore them) and submit again."
  );
}

function buildSchema_(sheet, fields) {
  const lastColumn = Math.max(getLastContentColumn_(sheet), 1);
  const headers = sheet.getRange(1, 1, 1, lastColumn).getValues()[0];
  const map = {};
  const used = {};

  fields.forEach(function (field) {
    const aliases = normalizeAliases_(field);
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
  return buildSchema_(sheet, fields).map;
}

function normalizeAliases_(field) {
  return (field.aliases || [field.header]).map(normalizeHeader_);
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
  return fields.some(function (field) {
    return normalizeAliases_(field).indexOf(normalized) !== -1;
  });
}

/* ---------------------------------------------------------
   Value helpers
   --------------------------------------------------------- */
function text_(value) {
  return String(value == null ? "" : value).trim();
}

/*
 * CBV identity key. Case, punctuation, spacing and Unicode decoration are
 * ignored so that "MACHILIKA ORTON", "Machilika orton" and the superscript-caps
 * spelling used on some rows all resolve to the same volunteer. NFKD is required
 * rather than NFD: the superscript letters have compatibility decompositions, so
 * NFD alone folds them to an empty key and those farmers go missing.
 */
function normalizeName_(value) {
  if (value == null) return "";
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "");
}

function cbvKey_(name, district) {
  const normalizedName = normalizeName_(name);
  if (!normalizedName) return "";
  return normalizedName + "|" + normalizeName_(district);
}

function isAllowedValue_(value, allowed) {
  return allowed.indexOf(text_(value)) !== -1;
}

function valueAt_(values, map, key) {
  const index = map[key];
  return index == null || index < 0 ? "" : values[index];
}

function setRowValue_(values, map, key, value) {
  if (map[key] == null || map[key] < 0) return;
  values[map[key]] = value;
}

function toDateValue_(value) {
  if (value == null || value === "") return null;
  if (Object.prototype.toString.call(value) === "[object Date]") {
    return isNaN(value.getTime()) ? null : value;
  }
  if (typeof value === "number" && isFinite(value) && value > 0) {
    return new Date(SPREADSHEET_EPOCH_MS + Math.round(value * DAY_MS));
  }
  const parsed = new Date(value);
  return isNaN(parsed.getTime()) ? null : parsed;
}

function formatStamp_(date) {
  return toDateValue_(date) ? date.toISOString() : "";
}

/* ---------------------------------------------------------
   Row reading and single column patching
   --------------------------------------------------------- */
function getRows_(sheet, schema) {
  const lastRow = getLastContentRow_(sheet, schema.width);
  if (lastRow < 2) return [];
  return sheet.getRange(2, 1, lastRow - 1, schema.width).getValues().map(function (values, index) {
    return { row: index + 2, values: values };
  });
}

/*
 * Applies { row, value } updates to one column in a single write.
 * With force = false only empty cells are filled, so a backfill can be re-run
 * safely and never disturbs data it did not create. With force = true existing
 * values are replaced, which is what the recount needs.
 */
function patchSingleColumn_(sheet, columnIndex, updates, force) {
  if (!updates.length) return 0;

  let minRow = updates[0].row;
  let maxRow = updates[0].row;
  updates.forEach(function (update) {
    if (update.row < minRow) minRow = update.row;
    if (update.row > maxRow) maxRow = update.row;
  });

  const height = maxRow - minRow + 1;
  const values = sheet.getRange(minRow, columnIndex, height, 1).getValues();
  const pending = {};
  updates.forEach(function (update) {
    pending[update.row] = update.value;
  });

  let patched = 0;
  for (let i = 0; i < height; i++) {
    const rowNumber = minRow + i;
    if (!pending.hasOwnProperty(rowNumber)) continue;
    if (!force && text_(values[i][0]) !== "") continue;
    if (force && values[i][0] === pending[rowNumber]) continue;
    values[i][0] = pending[rowNumber];
    patched++;
  }

  if (patched) sheet.getRange(minRow, columnIndex, height, 1).setValues(values);
  return patched;
}

/* ---------------------------------------------------------
   CBV matching and farmer counting
   --------------------------------------------------------- */
function sameCbv_(values, schema, cbv) {
  const name = normalizeName_(valueAt_(values, schema.map, "name"));
  if (!name || name !== normalizeName_(cbv.name)) return false;

  /*
   * The key is Name + District. T/A and Group are deliberately NOT part of the
   * key: they are refreshed from the form on every submit, so gating on them
   * would spawn a second Submissions row every time a volunteer corrects
   * their own details. The district is only compared when both sides have one,
   * so ?action=count still works for a caller who does not know it.
   */
  const district = normalizeName_(valueAt_(values, schema.map, "district"));
  if (district && normalizeName_(cbv.district) && district !== normalizeName_(cbv.district)) return false;

  return true;
}

/*
 * Returns the most recent Submissions row for this CBV so a returning
 * volunteer updates one record instead of accumulating duplicates.
 */
function findSubmissionByCbv_(sheet, schema, cbv) {
  let match = null;
  getRows_(sheet, schema).forEach(function (row) {
    if (!sameCbv_(row.values, schema, cbv)) return;
    if (!match || row.row > match.row) match = row;
  });
  return match;
}

/*
 * Name-only lookup for diagnostics, where the caller often does not know the
 * district. The write path uses findSubmissionByCbv_ so two volunteers who
 * happen to share a name in different districts stay separate.
 */
function findSubmissionByName_(sheet, schema, name) {
  const key = normalizeName_(name);
  if (!key) return null;
  let match = null;
  getRows_(sheet, schema).forEach(function (row) {
    if (normalizeName_(valueAt_(row.values, schema.map, "name")) !== key) return;
    if (!match || row.row > match.row) match = row;
  });
  return match;
}

/*
 * The foreign key count. CBV Name is the only link the Farmers tab carries, so
 * every farmer row recorded against a volunteer is counted for that volunteer,
 * however many batches they submitted over time.
 */
function countFarmersByCbv_(sheet, schema, cbv) {
  const key = normalizeName_(cbv.name);
  if (!key) return 0;
  const cbvColumn = schema.map.cbvName;
  if (cbvColumn < 0) return 0;

  let total = 0;
  getRows_(sheet, schema).forEach(function (row) {
    if (normalizeName_(row.values[cbvColumn]) === key) total++;
  });
  return total;
}

/* ---------------------------------------------------------
   Writers
   --------------------------------------------------------- */
function writeFarmerRows_(sheet, schema, farmers, cbv, now) {
  if (!farmers.length) return;
  const rows = farmers.map(function (farmer) {
    const values = new Array(schema.width).fill("");
    setRowValue_(values, schema.map, "submissionDate", now);
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
    return values;
  });
  sheet.getRange(nextDataRow_(sheet, schema.width), 1, rows.length, schema.width).setValues(rows);
}

/*
 * Confirms the batch landed by reading back exactly the rows that were written.
 * Deliberately ignores District, T/A and Group: a farmer can legitimately live
 * somewhere other than the volunteer's own T/A, and comparing those attributes
 * was what made the previous verification discard valid rows.
 */
function verifyFarmerWrite_(sheet, schema, startRow, count) {
  if (!count) return 0;
  const values = sheet.getRange(startRow, 1, count, schema.width).getValues();
  const nameIndex = schema.map.farmerName;
  let landed = 0;
  values.forEach(function (row) {
    if (nameIndex >= 0) {
      if (text_(row[nameIndex]) !== "") landed++;
      return;
    }
    if (row.some(function (value) {
      return text_(value) !== "";
    })) landed++;
  });
  return landed;
}

function clearFarmerRows_(sheet, schema, startRow, count) {
  if (!count) return;
  try {
    sheet.getRange(startRow, 1, count, schema.width).clearContent();
  } catch (ignored) {
  }
}

/*
 * Writes every mapped Submissions column in one pass. Timestamp keeps the
 * first time the volunteer was seen, Submission Date always advances to the
 * current report. On an existing row the current values are carried over first,
 * so columns the app does not own (the legacy Submission ID column) are never
 * blanked.
 */
function writeSubmissionRow_(sheet, schema, existing, cbv, summary, now, totalFarmers) {
  const rowNumber = existing ? existing.row : nextDataRow_(sheet, schema.width);

  const values = new Array(schema.width).fill("");
  if (existing) {
    for (let i = 0; i < Math.min(existing.values.length, schema.width); i++) {
      values[i] = existing.values[i];
    }
  }

  if (text_(valueAt_(values, schema.map, "timestamp")) === "") {
    setRowValue_(values, schema.map, "timestamp", now);
  }
  setRowValue_(values, schema.map, "submissionDate", now);
  setRowValue_(values, schema.map, "name", text_(cbv.name));
  setRowValue_(values, schema.map, "age", Number(cbv.age));
  setRowValue_(values, schema.map, "gender", text_(cbv.gender));
  setRowValue_(values, schema.map, "district", text_(cbv.district));
  setRowValue_(values, schema.map, "ta", text_(cbv.ta));
  setRowValue_(values, schema.map, "group", text_(cbv.group));
  setRowValue_(values, schema.map, "farmersReached", Number(summary.farmersReached));
  setRowValue_(values, schema.map, "commonQuestions", text_(summary.commonQuestions));
  setRowValue_(values, schema.map, "numberOfFarmers", totalFarmers);

  sheet.getRange(rowNumber, 1, 1, schema.width).setValues([values]);
  return rowNumber;
}
