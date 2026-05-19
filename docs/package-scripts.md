# package.json — Required Modifications

After `npm create vite@latest task-monitor -- --template react`, Vite generates
a default `package.json`. You need to add TWO scripts to its `"scripts"` block.

## Open your package.json and find this:

```json
"scripts": {
  "dev": "vite",
  "build": "vite",
  "lint": "eslint .",
  "preview": "vite preview"
}
```

## Replace it with this (adds predeploy + deploy):

```json
"scripts": {
  "dev": "vite",
  "build": "vite build",
  "lint": "eslint .",
  "preview": "vite preview",
  "predeploy": "npm run build",
  "deploy": "gh-pages -d dist"
}
```

## Required dependencies (install with npm)

These should already be added by Phase 2 of BUILD-GUIDE.md, but for reference:

```bash
# Runtime dependencies
npm install firebase

# Dev dependencies
npm install -D gh-pages
```

## What each script does

| Script | Purpose |
|---|---|
| `npm run dev` | Local development server with hot reload at `localhost:5173/task-monitor/` |
| `npm run build` | Production build into `dist/` |
| `npm run preview` | Locally preview the production build |
| `npm run predeploy` | Automatically runs before `deploy` — builds the app |
| `npm run deploy` | Pushes `dist/` to the `gh-pages` branch on your GitHub remote |

## After first deploy

The `gh-pages` package creates a new branch automatically. You just need to
configure GitHub once:

1. GitHub repo → **Settings** → **Pages**
2. Source: **Deploy from a branch**
3. Branch: **gh-pages** → folder: **/ (root)** → **Save**

After that, every `npm run deploy` updates the live site within ~1 minute.
