# LAC Monitoring Report – web prototype

A static, mobile-first version of the weekly Laeveld Agrochem monitoring report. It reads its data live from a Google Sheet. If it can't reach the sheet, it shows the bundled Week 46 snapshot.

## Connect the Google Sheet
1. Upload `../LAC Monitoring Data (Google Sheets).xlsx` to Google Drive, then choose **Open with → Google Sheets** and **File → Save as Google Sheets**.
2. Click **Share** and set **General access** to *Anyone with the link – Viewer*.
3. Copy the ID from the sheet URL (`/spreadsheets/d/<ID>/edit`) and paste it into `SHEET_ID` in `config.js`. To test without editing the file, open `index.html?sheet=<ID>` instead.

## Weekly workflow
- Enter each trap's count under its `Week N` column in **Counts CY**. Enter `*` for a trap that wasn't read.
- Change **Current Week** in **Settings**. Update the 7-day **Forecast** tab.
- The site checks the sheet for changes every 10 minutes. Readers can also pick any earlier week in the site's week selector.

## Files
`index.html`, `styles.css`, `app.js` (calculations and SVG charts), `config.js` (sheet ID), `data/snapshot.js` (offline fallback).

## Run locally
`python3 -m http.server 5173 --directory dashboard`, then open http://localhost:5173. For an offline test of the Sheets loader, add `?csv=testcsv`.

## Admin input page (`/input`)
- Use it to add a new week or edit an existing one: enter the trap counts and, for each of the 7 outlook days, the Early and Late blight risk (Low / Medium / High) plus the min and max °C. Totals, averages, % movement, Up/Down and PTM:TA update live as you type.
- Saving goes through the Apps Script in `apps-script/Code.gs`. The script is bound to the sheet (Extensions → Apps Script → "LAC Input API") and deployed as a web app; its URL is `WRITE_URL` in `config.js`.
- Every save also rebuilds the sheet's **Calculations** tab, which repeats the workbook's formulas for each week.
- The first person to open `/input` sets the admin passcode. To reset it, open the Apps Script **Project Settings → Script properties** and delete `ADMIN_KEY`.
- After changing `Code.gs`, paste it into the editor, then choose **Deploy → Manage deployments → Edit → Version: New version**. This keeps the same URL.
