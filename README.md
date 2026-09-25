# Farmers Report - Web Form + Google Apps Script Backend

A complete replacement for the Google Form. Collects CBV details, farmer summary
information, and a dynamic farmer data table, then stores everything in a private
Google Sheet through a Google Apps Script Web App. Users never touch the Sheet.

## Files

| File | Purpose |
|------|---------|
| `index.html` | The responsive, mobile-friendly form |
| `style.css` | Professional styling (green/agricultural theme) |
| `script.js` | Farmer table logic, client-side validation, submission, session handling |
| `Code.gs` | Google Apps Script backend that writes to the Sheet |
| `CBV-Farmers-Database  (1).xlsx` | Reference workbook schema for the Sheet tabs |
| `appsscript.json` | Apps Script manifest (timezone, runtime, web app) |
| `ACADES-logo.png` | Logo shown in the page header |

## How the data is stored

The backend is connected to the Google Sheet configured as `SPREADSHEET_ID` in
`Code.gs`. New records are written to these tabs:

1. **Submissions** - one row per report with `Timestamp`, CBV details, summary,
   `Submission ID`, and calculated `Number of Farmers`.
2. **Farmers** - one row per farmer with the reference workbook's A:K fields:
   `Submission Date`, `CBV Name`, farmer details, satisfaction, follow-up, and
   `Comments (Zowonjezera)`. The backend does not add or write `Submission ID` or
   `Row #` to this tab.

The adapter matches the existing header names and appends the two missing
backend columns (`Submission ID` and `Number of Farmers`) to `Submissions` after
its existing A:J fields. It ignores formatted blank ranges when finding the next
row. It does not edit, recalculate, or write to **Monthly CBV Summary**; that
tab remains manually maintained. The hidden `_CBV_Highlight_List` tab is also
left untouched.

`Submission ID` is retained in `Submissions` and in the browser session. Farmer
rows are associated by `CBV Name`, `District`, `T/A`, and `Group Name` where
available. `Submission Date` and `Comments (Zowonjezera)` are written in the
Farmers tab. Optional `Common Questions` and farmer `Group Name` cells remain
empty when no optional text is supplied.

### CBV sessions (adding farmers over time)

- After the first submit, the browser keeps the **CBV details and the
  `Submission ID`** in `localStorage` (a "session").
- On their next visit, the CBV section is pre-filled and **locked**, the farmer
  table is cleared, and the form is ready for a new batch of farmers.
- Submitting again **appends the new farmer rows to the same report** in the
  **Farmers** sheet and updates that submission's summary and calculated
  `Number of Farmers`. No duplicate submission row is created.
- Use the **Start New Report** button to end the session and begin a fresh
  submission (this clears the browser storage for that CBV).

> If a browser does not have the session, the backend tries to match the
> submission by CBV details before creating a new one.

---

## Deployment Instructions (step by step)

### Part A - Google Sheet

1. Open the project spreadsheet:
   `https://docs.google.com/spreadsheets/d/1YNXMaR2qe0TXS3MINdD3ikkMS8r-GHcoFpmWgyZ4b34/edit`
2. Confirm that it contains the `Submissions` and `Farmers` tabs, with the
   expected column headings in row 1 of each data tab. The `Monthly CBV Summary`
   tab is maintained manually by the project team.
3. Share the spreadsheet with the Google account that owns the Apps Script
   project, or grant that account access through your organisation's sharing
   policy.
4. Keep the `SPREADSHEET_ID` value in `Code.gs` equal to the ID above.

### Part B - Apps Script backend

1. In the spreadsheet, go to **Extensions > Apps Script**.
2. Delete the default `myFunction()` code and paste the contents of `Code.gs`.
3. Click **Project Settings** (gear icon) and tick **Show "appsscript.json" manifest file**.
4. Replace the generated `appsscript.json` with the one from this repo
   (timezone `Africa/Blantyre`, runtime V8, web app access `ANYONE_ANONYMOUS`).
5. **Save** the project.

### Part C - Deploy the Web App

1. Click **Deploy > New deployment**.
2. Choose **Web app** as the type.
3. Set:
   - **Execute as:** Me (your Google account)
   - **Who has access:** Anyone (the form is public)
4. Click **Deploy** and copy the Web App URL (it ends in `/exec`).
5. Open `script.js` and paste that URL into `CONFIG.APPS_SCRIPT_URL`.
6. **Important:** every time you change `Code.gs`, you must create a
   **New deployment** again (or edit the existing deployment) so the web app
   uses the new code. The URL may change - if it does, update `script.js`.

### Part D - Host the form on GitHub Pages

1. Push this folder to a GitHub repository.
2. In the repo, go to **Settings > Pages**, choose **Deploy from a branch**,
   select the branch (e.g. `main`) and the root folder `/`, then **Save**.
3. Your form will be live at `https://<username>.github.io/<repo>/`.

---

## Testing

Open `index.html` in a browser and:

- Confirm all 28 districts appear in both dropdowns.
- Submit with empty fields to check the validation messages.
- Enter a full farmer row, submit, then reload - the CBV section should be
  locked with the same Report ID and a fresh empty farmer table.
- Submit again to confirm the new farmers are appended to the same report.
- In the Google Sheet, verify that `Submissions` has `Submission ID` and
  `Number of Farmers` after the reference A:J columns, and that `Farmers` has
  the reference A:K columns with `Submission Date` and comments populated.
- Confirm that `Farmers` does not gain `Submission ID` or `Row #` columns.
- Confirm that submitting does not change **Monthly CBV Summary**.
- Use **Start New Report** to begin a fresh submission.
