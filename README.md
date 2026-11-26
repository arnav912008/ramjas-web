# Ramjas College question papers

Two public tabs: **Papers** (search, filter and sort previous year papers) and **Grievance** (Google Form). The **admin page** (upload and delete papers) is hidden: it has no link on the site and lives at a private address (see below).

## Run it

You need [Node.js](https://nodejs.org) version 22.16 or newer (the "LTS" download is fine). Nothing is compiled, so install is quick.

```
npm install
npm run setup     # asks for an admin username, password and the Google Form link
npm run dev       # try it at http://localhost:3000   (the console prints your private admin address)
```

For real use run `npm start` instead of `npm run dev`.

To change the admin password or the form link later, run `npm run setup` again.

## Put it online

Any host that runs Node works (Render, Railway, Fly.io, a VPS behind HTTPS).

1. Upload the project (without `node_modules`, `.env` or `data`).
2. Build command `npm install`, start command `npm start`.
3. Add the values from your local `.env` as environment variables in the host's dashboard.
4. Add a **persistent disk** and set `DATA_DIR` to its path (for example `/var/data`). Without it, uploaded papers disappear on every restart.
5. Set the health check path to `/healthz`.
6. The host provides HTTPS. If you also put Cloudflare in front, set `TRUST_PROXY=2`.

## Google Form link

In Google Forms click **Send**, choose the link tab, and copy the long `https://docs.google.com/forms/...` address. The short `forms.gle` link and the `/edit` link will not work.

## Backups

`npm run backup` copies the database and every uploaded paper to `backups/` and keeps the newest 14 copies. Schedule it daily and copy the folder somewhere safe.

## Security in short

- Admin passwords are stored as a salted scrypt hash, never in plain text. Sessions are random tokens kept on the server, so signing out really ends them.
- Sign-in is limited to 5 wrong attempts per 15 minutes per visitor, uploads to 30 per hour.
- Uploads are checked by their real content (only PDF, JPG, PNG, max 15 MB), renamed by the server, and stored outside the public folder.
- Strict content security policy, HTTPS redirect with HSTS, no cross-site requests to the admin API, no stack traces shown to visitors.
- No third-party scripts, fonts or trackers: everything is served from this site.

## Hidden admin page

There is no Admin tab. The page is at a private address like `/manage-3fa9c2e1b7d04a68`, created by `npm run setup` and stored as `ADMIN_PATH` in `.env`. Bookmark it on your phone. `/admin` returns "Page not found". The address is only a first layer: you still need the username and password, and sign-in is rate limited. Change `ADMIN_PATH` any time to move the page.

## Background photos

Put your campus photos (JPG, PNG, WebP or AVIF) in `public/img/campus/`. They fade in one after another behind the pages, in random order. Nothing else to configure: restart is not even needed, and with no photos the site shows a plain dark maroon background.

- Use photos the college owns or has permission to use.
- Resize them first to about 1600 px on the long side and under 300 KB each, because most students are on mobile data. [squoosh.app](https://squoosh.app) does this in a few clicks.
- Up to 30 photos are used. Landscape photos look best.

## Checks

`npm test` starts the server on a temporary folder and runs the automated checks.

## If something goes wrong

| Message | Fix |
| --- | --- |
| "The admin login has not been set up yet" | Run `npm run setup` |
| "Port 3000 is already in use" | Close the other program or set `PORT` in `.env` |
| Papers vanish after a restart | The host has no persistent disk, or `DATA_DIR` does not point at it |
| Grievance page says the form is not available | Check `GRIEVANCE_FORM_URL` (see "Google Form link") |
