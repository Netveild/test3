/* ==========================================================================
   SITE CONFIG: the only file you need to edit
   ==========================================================================

   HOW TO ADD A DOWNLOAD
     1. Put the file in the  downloads/  folder.
     2. Add an entry for it to FILES below.

   When the site runs on GitHub Pages (username.github.io), every file in
   downloads/ is also listed automatically, so step 2 is optional. Use it to
   give a file a nicer title, a description, a version, or to feature it.

   FILE FIELDS (only `file` or `url` is required)
     file         name of the file inside downloads/      "my-app.zip"
     url          full link instead of `file` (GitHub Releases, Drive, ...)
     title        display name             (default: made from the file name)
     description  short text shown on the card
     version      "1.2.0"
     date         "YYYY-MM-DD"             (used for sorting + the "New" badge)
     category     filter group             (default: the file type)
     size         "350 MB"                 (detected automatically online)
     featured     true = pinned to the top with a highlight

   GitHub rejects files over 100 MB. Attach big files to a GitHub Release
   and use `url` instead of `file` (see the example at the bottom).
   ========================================================================== */

window.SITE = {
  name: "Nexus",
  tagline: "Download Center",

  heroTitle: "Everything you need,",
  heroHighlight: "one click away.",
  heroText: "Browse the latest releases, assets and documents. Free to download and always up to date.",

  // ACCESS CODE: visitors must enter it before they can see the site.
  // Only a fingerprint (SHA-256 hash) of the code is stored, so the code itself
  // can't be read from the page source. Codes are not case-sensitive.
  // To change the code, see "Changing the access code" in README.md.
  // To remove the lock completely, set  hash: ""
  accessCode: {
    hash: "d827c98d4c41c1b99aad5d849836f368ad1aa4e1e70f4fbc12becc7d4132ac83",
    length: 8,                // number of boxes in the code field (0 = one plain text field)
  },

  theme: "dark",              // "dark" | "light" | "system"
  downloadsFolder: "downloads",
  newBadgeDays: 14,           // files dated within this many days get a "New" badge

  // List files in downloads/ automatically via the GitHub API (github.io only).
  autoList: true,
  github: {
    user: "",                 // your GitHub username (auto-detected on *.github.io)
    repo: "",                 // your repository name (auto-detected on *.github.io)
    branch: "",               // leave empty for the default branch
    path: "",                 // only if the site lives in a subfolder, e.g. "docs/downloads"
  },

  // Extra links in the top bar, e.g. { label: "Discord", url: "https://discord.gg/..." }
  links: [],

  footerText: "Hosted on GitHub Pages.",
};

window.FILES = [
  // Add your files here, e.g.
  // {
  //   file: "my-app.zip",
  //   title: "My App",
  //   description: "What it is and why someone would want it.",
  //   version: "1.0.0",
  //   date: "2026-10-22",
  // },

  // Example: a large file hosted on GitHub Releases
  // {
  //   url: "https://github.com/USERNAME/REPO/releases/download/v1.0.0/big-file.zip",
  //   title: "Big File",
  //   description: "Too large for the repo, so it lives on GitHub Releases.",
  //   size: "350 MB",
  //   version: "1.0.0",
  //   date: "2026-10-01",
  // },
];
