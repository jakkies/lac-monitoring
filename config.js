/*
 * LAC Monitoring Report – data source configuration
 *
 * SHEET_ID: the long ID in your Google Sheet URL
 *   https://docs.google.com/spreadsheets/d/<SHEET_ID>/edit
 * The sheet must be shared as "Anyone with the link – Viewer".
 *
 * You can also override it without editing this file:  index.html?sheet=<SHEET_ID>
 * Leave it empty to run on the bundled Week 46 snapshot.
 */
window.LAC_CONFIG = {
  SHEET_ID: "1Foiaat2aS6jGKyyPdpHdG-2uKQL55KAPuB58oAOxshk",
  TABS: { settings: "Settings", cy: "Counts CY", py: "Counts PY", forecast: "Forecast" },
  REFRESH_MINUTES: 10
};
