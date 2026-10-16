// Plain (non-"use client") module so the server page can read the tab list as a value.
// Exported from job-detail.tsx ("use client") it became a client reference and `.includes` crashed the page.
export const JOB_TABS = ["overview", "schedule", "team", "notes", "photos", "expenses", "documents", "activity"] as const;
export type JobTab = (typeof JOB_TABS)[number];
