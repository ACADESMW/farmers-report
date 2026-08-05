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

The script creates (or reuses) two sheets inside your spreadsheet:

1. **Submissions** - one row per form submission with the CBV and summary answers.
2. **Farmers** - one row per farmer entered in the table, linked back to the
   submission by a shared `Submission ID`.

### CBV sessions (adding farmers over time)

- After the first submit, the browser keeps the **CBV details and the
  `Submission ID`** in `localStorage` (a "session").
- On their next visit, the CBV section is pre-filled and **locked**, the farmer
  table is cleared, and the form is ready for a new batch of farmers.
- Submitting again **appends the new farmer rows under the same `Submission ID`**
  in the **Farmers** sheet and updates that submission's "Farmers Reached" /
  "Number of Farmers" numbers. No duplicate submission row is created.
- Use the **Start New Report** button to end the session and begin a fresh
  submission (this clears the browser storage for that CBV).

> Session storage lives in the CBV's own browser. Clearing the browser data
> (or using a different device) starts a new session and a new Submission ID.

---

## Deployment Instructions (step by step)

### Part A - Google Sheet

1. Create a new Google Spreadsheet (or reuse an existing one).
2. Open it and copy the ID from the URL:
   `https://docs.google.com/spreadsheets/d/THIS_IS_THE_ID/edit`
3. Open `Code.gs` and paste that ID into the `SPREADSHEET_ID` constant at the top.

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
- Use **Start New Report** to begin a fresh submission.
