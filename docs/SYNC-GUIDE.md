# Google Drive sync guide

Flixate works without an account. Google Drive sync is optional and stores only
personal seen/unseen decisions and watchlists in the Google account you choose. Flixate has no
account server or database.

## What is stored where

| Location | Contents |
| --- | --- |
| This browser | Seen history, watchlists, filters and saved filter presets, a random device ID, the confirmed Google account label, and—while valid—a short-lived Drive access token |
| Private Google Drive app data | TMDB title keys, seen/unseen values, watchlist IDs/names/memberships/deletion markers, change timestamps, and the random device ID that owns each sync file |
| GitHub Pages and Actions | The public app and catalog; no personal history, Google account, or OAuth access token |
| Service-worker caches | App files, catalog data, synopsis shards, and a bounded poster cache; never Google Identity or Drive responses |

Drive app data is hidden from the normal Drive interface and accessible only to
Flixate through the narrow `drive.appdata` permission. It contains no catalog,
synopsis, Google password, refresh token, personal rating, or notes.

## Connect and use sync

1. Open **Local only** in the top bar and choose **Connect Google Drive**.
2. Select the intended Google account.
3. Choose **Merge browser and Drive** unless you deliberately want to discard the
   local copy. Merge retains the newest decision for each title.
4. Wait for the status to report the number of seen titles saved or matched.

Seen buttons and watchlist edits always update this browser first. With a valid token, synchronization
starts immediately. Flixate also synchronizes when an already connected browser
loads. **Sync now** is available for an explicit retry.

When Google's short-lived token expires, the next Drive-relevant interaction asks
Google for another token using the remembered account hint. This can produce a
brief popup. Flixate does not have a backend refresh token and never asks for a
Google password.

## Merge versus replacement

- **Merge browser and Drive** keeps the newest seen or unseen decision for every
  title, watchlist name, and title/list membership. A deleted list stays deleted,
  even if an older device later renames it. This is the normal and safest choice.
- **Use Drive state here** replaces the browser's personal state with the readable
  Drive state. Export a JSON backup first if the browser may contain unique history.

Account switching always returns to this confirmation step. Flixate checks an
opaque Google account identifier before listing or changing sync files.

## Offline use and recovery

Browsing, seen actions, and watchlist edits remain available offline. Changes are retained locally;
use another seen/watchlist action or **Sync now** once Drive is reachable. If authorization
expired, that user action also starts reconnection.

If site data is cleared or a browser is replaced, reconnect the same Google account
and choose **Merge browser and Drive**. If Drive data was also deleted, restore a
previous JSON export with **Import backup**.

JSON export/import remains available in both local-only and connected modes. It
contains seen history, watchlists (including removal/deletion markers), and current
filter settings, but never saved filter presets, the Google account binding, or
OAuth token. New exports use backup version 2; older seen-only backups still import.

## Watchlists and the Phase 4 update

Create lists under **Manage watchlists**, then use **Lists** on a title card to
choose its memberships. Select a list to browse it, rename it, or delete it with
confirmation. Seen history is independent: deleting a list or removing a title
does not change seen status or other lists. List browsing initially includes seen
titles and has no 100-title display cap. Titles absent from the latest streaming
catalog remain saved; the list shows their TMDB identifiers with links and removal
controls until catalog details return.

Reload/update Flixate on every device when installing Phase 4. The new app reads
existing seen history automatically but writes a separate version-2 local record
and version-2 Drive filename so an old cached app cannot erase watchlists. Old apps
can still upload seen edits that the new app reads, but cannot see changes written
by the new app until they update. Legacy Drive files are retained, not deleted.

## Disconnect, revoke access, and delete data

These actions are deliberately separate:

- **Disconnect** forgets the token and account binding in this browser. Local and
  Drive history remain.
- **Delete Drive history** requires a second confirmation, permanently deletes all
  validated Flixate files in that Google account, disconnects this browser, and
  retains its local history.
- Removing Flixate from [Google Account third-party connections](https://myaccount.google.com/connections)
  revokes future account access. Do this after deleting the Drive copy if both are
  desired, because revocation prevents Flixate from reaching those files.
- Clearing Flixate's site data removes this browser's local history, token, account
  label, filters, and caches. It does not by itself delete Drive data.

Another connected device can recreate deleted Drive history from its local copy.
For complete removal, first disconnect every other browser/device, then use
**Delete Drive history** on the final connected browser. Clear Flixate site data on
each device if the local copies should also disappear, and optionally revoke the
Google connection afterward.

Google documents the hidden folder and its deletion behavior in
[Store application-specific data](https://developers.google.com/workspace/drive/api/guides/appdata).
Google separately documents permission removal under
[Manage links between your Google Account and apps](https://support.google.com/accounts/answer/13533235).

## Current limitations

- Sync runs only while Flixate is open; there is no background server.
- Different Google accounts cannot share one household history.
- Filters and named filter presets are device-local and are not synchronized.
- A device with an expired token cannot synchronize until a user interaction lets
  Google issue another short-lived token.
- A still-connected device can upload its retained local history after remote data
  was deleted elsewhere.

## Google Cloud setup for the owner

The Drive API must be enabled and the Web OAuth client must authorize the exact
production JavaScript origin `https://hnsr.github.io`. The app requests only:

```text
https://www.googleapis.com/auth/drive.appdata
```

Keep `VITE_GOOGLE_CLIENT_ID` as a GitHub repository variable; it is public client
configuration, not a secret. Never add a client secret to this static app.

The production app uses an **External**, **In production** audience without OAuth
verification. Google's personal-use exception permits fewer than 100 users to
continue through the unverified-app warning. This keeps ordinary personal Google
accounts usable and avoids Testing mode's seven-day authorization expiry. An
**Internal** audience would restrict Flixate to accounts in one Google Workspace or
Cloud Identity organization and is therefore not appropriate here. See Google's
current [app audience documentation](https://support.google.com/cloud/answer/15549945)
and [personal-use exception](https://support.google.com/cloud/answer/13464323).
