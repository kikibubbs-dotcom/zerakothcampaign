# The Adventurers' Chronicle — D&D Campaign Hub

A shared campaign dashboard built with HTML, CSS, JavaScript and Supabase.

## Project files

- `index.html` — page structure and Supabase library loading.
- `styles.css` — the campaign hub styling.
- `app.js` — application behaviour, Supabase connection, live updates and campaign features.

## Run locally

You can open `index.html` in a browser for a quick visual check. For best results, use a local static server (for example, VS Code's Live Server extension) because browser security rules can affect some local-file features.

## Publish with GitHub Pages

1. Create a GitHub repository and upload all three project files to its root.
2. In the repository, open **Settings → Pages**.
3. Under **Build and deployment**, choose **Deploy from a branch**.
4. Select the `main` branch and `/ (root)`, then save.
5. Wait for GitHub Pages to publish and open the URL shown in Settings → Pages.

## Supabase configuration

The existing Supabase project URL and publishable key are currently retained in `app.js` so the migrated version can connect to the same project. A Supabase publishable key is intended for browser use; never put a `service_role` or secret key in this repository.

**Security note:** the current campaign setup uses public access policies. Anyone who can reach the site may be able to read or change shared campaign data and map files. Do not use it for private information until proper authentication and role-based permissions are added.

## Important

This is a structural migration of the existing Carrd embed into separate files. The campaign features and existing data model have been preserved rather than redesigned. Test the live site and Supabase connection before sharing it with players.
