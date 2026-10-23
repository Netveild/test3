# Nexus Download Center

A static download site for GitHub Pages. Anyone who visits can browse, search and download the files you put in the `downloads/` folder.

## Adding a download

1. Put the file in `downloads/`.
2. Open `config.js` and add an entry to `FILES`:

   ```js
   {
     file: "my-app.zip",
     title: "My App",
     description: "What it is and why someone would want it.",
     version: "1.0.0",
     date: "2026-10-22",
   },
   ```

Once the site is on GitHub Pages, it also lists every file in `downloads/` on its own (through the GitHub API), so step 2 is optional. You only need it for a nicer title, a description, a version, or `featured: true`.

To remove a download, delete the file from `downloads/` and remove its entry from `config.js`.

## Access code

Visitors have to enter an access code before they see the site. `config.js` stores only a fingerprint (SHA-256 hash) of the code, so it can't be read from the page source. Codes are not case-sensitive. Ticking **Remember this device** keeps the visitor unlocked on that browser; the lock button in the top bar locks the site again.

### Changing the access code

1. Open PowerShell and run this, with your new code in place of `NEWCODE`:

   ```powershell
   $code = "NEWCODE"; -join ([Security.Cryptography.SHA256]::Create().ComputeHash([Text.Encoding]::UTF8.GetBytes(($code -replace '\s','').ToUpper())) | ForEach-Object { $_.ToString("x2") })
   ```

2. Paste the long result into `accessCode.hash` in `config.js`.
3. Set `accessCode.length` to the number of characters in the new code (or `0` for a single plain text field).

Changing the code also signs out everyone who was remembered. To remove the lock entirely, set `hash: ""`.

> **Important:** the code screen keeps casual visitors out, but it is not real security. GitHub Pages sites are public, so anyone who has a file's direct link, or who looks at the repository on GitHub, can still download it without the code. Don't put anything truly secret here.

## Publishing on GitHub Pages

1. Create a new **public** repository on GitHub.
2. Upload everything in this folder, including the empty `.nojekyll` file. It makes GitHub serve your files exactly as they are.
3. In the repository, open **Settings → Pages**. Under **Source** choose *Deploy from a branch*, pick `main` and `/ (root)`, and click **Save**.
4. About a minute later the site is live at `https://<username>.github.io/<repository>/`.

## Good to know

- **100 MB limit:** GitHub rejects files larger than 100 MB. Attach big files to a [GitHub Release](https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository) and use `url:` instead of `file:` in `config.js`.
- **Everything is public:** anyone can download any file in the repository.
- **Text and settings** (site name, headline, theme, extra links) are in `config.js`.
- **Colours:** change `--accent`, `--accent-2` and `--accent-3` at the top of `assets/style.css`.
- **Local preview:** double-click `index.html`. File sizes, automatic listing and 3D build previews only show up once the site is online.
- **Litematica builds:** clicking a `.litematic` file shows a 3D preview of the build: drag to rotate, scroll to zoom, right-drag to pan. The **Layers** slider shows the build layer by layer, and **Materials** lists the blocks it uses. Blocks are drawn as plain colours, not Minecraft textures. Files linked with `url:` from another site (such as GitHub Releases) usually can't be previewed, because that site blocks it.

## Files

```
index.html          the page
config.js           your settings + the list of downloads
downloads/          ← put your files here
assets/style.css    design
assets/app.js       behaviour (no need to edit)
assets/litematic.js 3D preview for .litematic files
assets/favicon.svg  browser-tab icon
```
