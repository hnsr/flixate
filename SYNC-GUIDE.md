# Google Drive sync guide

Flixate works without an account. Google Drive sync is optional and stores only
personal seen/unseen decisions in the Google account you choose. Flixate has no
account server or database.

## What is stored where

| Location | Contents |
| --- | --- |
| This browser | Seen history, filters, a random device ID, the confirmed Google account label, and—while valid—a short-lived Drive access token |
| Private Google Drive app data | TMDB title keys, seen/unseen values, change timestamps, and the random device ID that owns each sync file |
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

Seen buttons always update this browser first. With a valid token, synchronization
starts immediately. Flixate also synchronizes when an already connected browser
loads. **Sync now** is available for an explicit retry.

When Google's short-lived token expires, the next Drive-relevant interaction asks
Google for another token using the remembered account hint. This can produce a
brief popup. Flixate does not have a backend refresh token and never asks for a
Google password.

## Merge versus replacement

- **Merge browser and Drive** keeps the newest seen or unseen decision for every
  title. This is the normal and safest choice.
- **Use Drive state here** replaces the browser's personal state with the readable
  Drive state. Export a JSON backup first if the browser may contain unique history.

Account switching always returns to this confirmation step. Flixate checks an
opaque Google account identifier before listing or changing sync files.

## Offline use and recovery

Browsing and seen actions remain available offline. Changes are retained locally;
use another seen action or **Sync now** once Drive is reachable. If authorization
expired, that user action also starts reconnection.

If site data is cleared or a browser is replaced, reconnect the same Google account
and choose **Merge browser and Drive**. If Drive data was also deleted, restore a
previous JSON export with **Import backup**.

JSON export/import remains available in both local-only and connected modes. It
contains personal state and filter settings but never the Google account binding or
OAuth token.

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
- Filters are device-local and are not synchronized.
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

For a few personally known users, Google's personal-use exception does not require
full verification, but an app left in **Testing** limits access to listed test users
and test authorizations expire after seven days. Moving the audience to
**In production** avoids that testing-mode expiry; review the consent screen and
warning shown to each intended user before rollout. See Google's current
[app audience documentation](https://support.google.com/cloud/answer/15549945) and
[personal-use exception](https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification).
