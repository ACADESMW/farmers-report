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
| `appsscript.json` | Apps Script manifest (timezone, runtime, web app) |
| `ACADES-logo.png` | Logo shown in the page header |

## How the data is stored

The backend is connected to the Google Sheet configured as `SPREADSHEET_ID` in
`Code.gs`. New records are written to these tabs:

1. **Submissions** - one row per report with the submission ID, timestamp, CBV
   details, summary, and calculated `Number of Farmers`.
2. **Farmers** - one row per farmer with the shared submission ID, row number,
   CBV name, farmer details, satisfaction, follow-up, and comments.

The adapter matches the existing header names and appends any required missing
columns immediately after the last populated header column in the two data
tabs. It ignores formatted blank ranges when finding the next row. It does not
edit, recalculate, or write to **Monthly CBV Summary**; that tab remains
manually maintained. The hidden `_CBV_Highlight_List` tab is also left untouched.

All generated columns (`Submission ID`, `Timestamp`, `Row #`, and
`Number of Farmers`) are written by the backend. `CBV Name` is copied into every
new farmer row from its parent CBV, so the farmer tab is linked by both
`Submission ID` and CBV name. Optional `Common Questions`, farmer `Group Name`,
and `Comments` cells remain empty when no optional text is supplied.

### CBV sessions (adding farmers over time)

- After the first submit, the browser keeps the **CBV details and the
  `Submission ID`** in `localStorage` (a "session").
- On their next visit, the CBV section is pre-filled and **locked**, the farmer
  table is cleared, and the form is ready for a new batch of farmers.
- Submitting again **appends the new farmer rows under the same `Submission ID`**
  in the **Farmers** sheet and updates that submission's summary and calculated
  `Number of Farmers`. No duplicate submission row is created.
- Use the **Start New Report** button to end the session and begin a fresh
  submission (this clears the browser storage for that CBV).

> Session storage lives in the CBV's own browser. Clearing the browser data
> (or using a different device) starts a new session and a new Submission ID.

---

## Deployment Instructions (step by step)

### Part A - Google Sheet

1. Open the project spreadsheet:
   `https://docs.google.com/spreadsheets/d/1YNXMaR2qe0TXS3MINdD3ikkMS8r-GHcoFpmWgyZ4b34/edit`
2. Confirm that it contains the `Submissions` and `Farmers` tabs. The
   `Monthly CBV Summary` tab is maintained manually by the project team.
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
- Submit again to confirm the new farmers are appended under the same ID.
- In the Google Sheet, verify that every new `Submissions` and `Farmers` row
  has its generated columns populated, including the farmer-row `CBV Name`.
- Confirm that submitting does not change **Monthly CBV Summary**.
- Use **Start New Report** to begin a fresh submission.
