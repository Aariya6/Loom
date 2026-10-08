# Security notes

- Passwords: Argon2id with non-trivial memory/time cost.
- Sessions: random bearer token, only SHA-256 token hash persisted.
- CSRF: per-session token required on state-changing endpoints.
- Cookies: HttpOnly session cookie, SameSite=Lax; `COOKIE_SECURE=1` for HTTPS.
- Rate limits: in-process authentication attempt limiter; production deployments should move this to a shared store.
- Ownership: every project read/write/delete query includes `owner_id`.
- Input bounds: Pydantic limits on passwords, names, notes and arrays.
- Storage: revision history is bounded to prevent accidental unbounded growth.
- Project state is capped at 1 MB per save (HTTP 422 beyond that).
- Audio uploads (vocals, loops): type is decided by the file's magic bytes (WAV, MP3, OGG, FLAC, M4A, WebM only — HTML or anything else is refused with 415), 12 MB per file, 40 files / 60 MB per project, owner-checked on every read, CSRF-protected, and served back as `application/octet-stream` with `nosniff` so a browser can never render an upload as a page. Deleting a project deletes its audio.
- Sharing: a share link is an unguessable 192-bit token and shows a **frozen snapshot**; later edits stay private until re-published. Public endpoints expose only that snapshot, the walkthrough video and the audio clips the snapshot references; other files in the project return 404. Turning the link off deletes the page, its comments and reactions.
- Public comments and reactions need no account, so they are rate-limited per IP and share (comments 8 / 15 min, reactions 40 / 15 min), capped per page (300 / 3000), length-limited and stripped of control characters; reactions are an emoji whitelist, and every string is rendered as text, never HTML. The owner can delete any comment or turn comments off.
- Walkthrough video: WebM / MP4 only (magic-byte check), 48 MB each, 6 per project (150 MB); served with `nosniff` and HTTP Range support.
- Collaboration: only an existing account can be invited (owner only, rate-limited). Collaborators can read and edit the project and add audio but cannot delete it, share it or manage people. Saves carry the revision they started from; a mismatch returns HTTP 409 instead of overwriting.
- Camera, microphone and screen capture are requested by the browser only when you press record. Speech-to-text is optional and uses the browser's own service (Chrome sends the audio to Google), which the dialog says before you start.
- No arbitrary server-side file execution is accepted by the API.
- External procurement is isolated from normal request handling.

Production hardening still requires TLS termination, a shared rate-limit store and a managed secret system.
