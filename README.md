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
| `CBV-Farmers-Database  (2).xlsx` | Reference workbook schema for the Sheet tabs |
| `appsscript.json` | Apps Script manifest (timezone, runtime, web app) |
| `ACADES-logo.png` | Logo shown in the page header |

## How the data is stored

The backend is connected to the Google Sheet configured as `SPREADSHEET_ID` in
`Code.gs`. There is **no submission ID**. A volunteer is recognised by their
**name**, so every farmer they record is linked to the one Submissions row that
belongs to them.

### Submissions - one row per CBV, updated in place

| Column | On the first submit | On later submits |
|--------|---------------------|------------------|
| `Timestamp` | now | kept (first time seen) |
| `Submission Date` | now | advanced to the current report |
| `Name (Dzina Lanu)` | from the form | refreshed |
| `Age (Zaka zanu)` | from the form | refreshed |
| `Gender (Mamuna kapena Mkazi)` | from the form | refreshed |
| `District (Boma)` | from the form | refreshed |
| `T/A` | from the form | refreshed |
| `Group (Dzina la Gulu)` | from the form | refreshed |
| `Farmers Reached (Mwafikira Alimi angati)` | from the form | refreshed |
| `Common Questions (Mafunso)` | from the form | refreshed |
| `Number of Farmers` | count of linked farmer rows | recounted |

The row is matched on `Name (Dzina Lanu)` plus `District (Boma)`, compared
case-insensitively and ignoring punctuation, spacing and Unicode decoration, so
`MACHILIKA ORTON`, `Machilika orton` and the superscript-caps spelling all resolve
to the same volunteer. The **most recent** matching row is the one updated.

A legacy `Submission ID` column may still exist further right in this tab. The
backend never writes it, and existing values are never blanked.

### Farmers - one row per farmer, all columns written

`Submission Date`, `CBV Name`, `Farmer Name (Dzina)`, `Age (Zaka)`,
`Gender (Mamuna/Mkazi)`, `District (Boma)`, `T/A`, `Group Name`,
`Satisfied? (Eya/Ayi)`, `Follow Up Visit (Eya/Ayi)`, `Comments (Zowonjezera)`.

`CBV Name` is the foreign key: `Number of Farmers` in the Submissions tab is the
number of Farmers rows whose `CBV Name` matches that volunteer, however many
batches they submitted over time. `Submission Date` is always written.

Note that `District (Boma)` and `T/A` on a farmer row are **that farmer's** own
location, which is often not the volunteer's. Do not group or total by those
columns.

The backend does not write to **Monthly CBV Summary** (maintained manually by the
project team) and does not touch the hidden `_CBV_Highlight_List` tab.

### Write order and safety

Farmer rows are written to the Farmers tab **first**, then read back at exactly
those row positions to confirm they landed. Only then is the Submissions row
written. If the farmer write is short or fails, those rows are cleared and the
request is rejected - the Submissions tab never records farmers that are not in
the sheet. Nothing is deleted on a successful write.

## Maintenance actions

Append an action to the web app URL and open it in a browser:

| URL | What it does |
|-----|--------------|
| `?action=health` | Reports the build version, the tabs found, their headers, the column each field resolved to, the last data row, and any field that failed to map. Read-only. |
| `?action=orphans` | Read-only. Lists Submissions rows for volunteers who have **no** farmer rows at all, and counts the surplus duplicate rows. These are the casualties of the old build, which wrote the Submissions row first and then wiped the farmers. Changes nothing. |
| `?action=count&cbv=Name` | Counts the Farmers rows linked to one CBV and shows the total currently recorded in Submissions. Add `&district=X` to scope the lookup. |
| `?action=backfillDates` | Fills blank `Submission Date` cells in the Farmers tab using the **earliest** Submission Date recorded for that CBV. Only fills empty cells, so it is safe to re-run. |
| `?action=repair` | Recomputes `Number of Farmers` on the most recent Submissions row of every CBV from the rows that actually exist. Safe to re-run. |

> `backfillDates` **infers** the value. The original Google Form never captured a
> per-farmer timestamp, so for rows written before this project existed the date
> is taken from the volunteer's earliest report rather than reconstructed. Rows
> whose CBV Name matches no Submissions row are left blank and listed in the
> response as `unmatchedByCbv`.

### Locating the columns

The backend does not assume the column headings are in row 1. On each tab it
scans the first ten rows for the row that best matches the expected headings and
uses that. A sheet that has gained a title row, or that was rebuilt by hand, so
keeps working:

- Headings are found wherever they are in the first ten rows.
- A heading that is missing is added to the same row as the others.
- A tab with no recognisable heading row at all is refused, and the error quotes
  the first five rows so you can see what it found.
- A field that still cannot be located stops the write before anything changes,
  naming the exact heading.

`?action=health` reports `headerRow` for each tab, so you can see which row the
app decided was the heading row.

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

### Part D - Prove the new code is the code that is live

A deployment that was not updated is the single failure this project cannot
detect from inside itself, so check it explicitly:

1. Open `.../exec?action=health` in a browser.
2. If you get a **web page** instead of JSON, the app is running an old build.
3. If you get JSON, look at `appVersion`. It must match `APP_VERSION` at the top
   of `Code.gs`.
4. Check `sheets.Farmers.unmappedFields` and `sheets.Submissions.unmappedFields`
   - both must be `[]`. If a field is listed, the app will refuse to write and
   say which heading is missing.
5. `sheets.Farmers.nextDataRow` is the row the next farmer will land on. After a
   test submission it should have increased by the number of farmers entered.

Then `.../exec?action=orphans` to list the Submissions rows the old build left
without farmers. It only reports; it never deletes.

### Part E - Host the form on GitHub Pages

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
  locked with the same details and a fresh empty farmer table.
- Submit again to confirm the new farmers are appended and the reported total
  increases, with no second Submissions row created.
- Open `.../exec?action=health` and confirm `unmappedFields` is empty for both
  tabs and that `appVersion` matches the top of `Code.gs`.
- Open `.../exec?action=orphans` and note how many Submissions rows have no
  farmers at all.
- Open `.../exec?action=count&cbv=<name>` and confirm the farmer row count
  matches what is visible in the Farmers tab and in `Number of Farmers`.
- Check `sheets.Farmers.nextDataRow` before and after a test submission; it
  should rise by exactly the number of farmers entered.
- Use **Start New Report** and confirm the CBV fields are actually blank
  afterwards.
- Confirm that submitting does not change **Monthly CBV Summary**.
