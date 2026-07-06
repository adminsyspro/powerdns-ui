# Sharing issued certificates over NFS

The app materializes each certificate to `${CERTS_DIR}/live/<name>/`:

    privkey.pem   cert.pem   chain.pem   fullchain.pem

By default these are owner-only (`0700` dirs, `0600` key) — not readable by a
reverse proxy on another host. To let reverse proxies (nginx/Apache) read them
over an NFS export **without making the private key world-readable**, opt in to
group-shared materialization.

## 1. Pick a numeric certs group

Use the same numeric gid on the app host and every consumer host (NFSv3 maps by
numeric id; NFSv4 must have a matching idmap domain + name mapping):

    CERTS_GID=6000
    CERTS_UID=1001   # optional; the uid to own the files. Blank = leave unchanged.

When `CERTS_GID` is set the app writes: dirs `02750` (setgid), `privkey.pem`
`0640`, the public files `0644`, owned `CERTS_UID:CERTS_GID`.

## 2. Pre-provision `CERTS_DIR` (recommended)

Because the app's `chown`/`chmod` can be squashed on NFS (`root_squash`,
`all_squash`, container-root writers), provision the export root once, server-side:

    chgrp 6000 /srv/powerdns-ui/certs
    chmod 2750 /srv/powerdns-ui/certs      # setgid → children inherit the group

`${CERTS_DIR}` may itself be a symlink to the mount; the app resolves it. The
`live/` and `live/<name>/` subdirectories under it must be real directories (the
app refuses to write through a symlinked managed subdir).

## 3. Let the app set the group where it writes

Run the app as a member of the gid so its own writes/chowns succeed, e.g. in
`docker-compose.yml` under the `powerdns-ui` service:

    group_add:
      - "6000"

(The setgid dir from step 2 also makes new files inherit the group even if the
app cannot `chown`.)

## 4. Export read-only and mount on the proxy host

Export `${CERTS_DIR}` **read-only** (`/etc/exports`), then on the reverse-proxy
host mount it read-only and run the proxy as a member of gid `6000`. nginx points
`ssl_certificate` at `fullchain.pem` and `ssl_certificate_key` at `privkey.pem`.

## Notes

- `privkey.pem` is `0640` — readable only by members of the certs group, never
  world-readable. If the app cannot verify the file's group equals `CERTS_GID`
  (e.g. chown squashed), it leaves the key at `0600` and logs a warning rather
  than exposing it under the wrong group.
- If a materialized directory ends up without the configured group or without
  the group-execute bit (so a consumer could not traverse it), the app logs a
  one-time warning naming the path — check the app logs after first issuance.
- Disabling `CERTS_GID` after having run in shared mode does not tighten
  directories that already exist: an existing `live/<name>/` directory keeps its
  previous `02750`/group ownership (Node does not chmod existing dirs). The
  private key is still rewritten `0600` on the next issuance (so the key is not
  exposed), but the directory stays group-listable. If you downgrade from shared
  to owner-only, re-tighten the tree manually, e.g.
  `chmod -R o-rwx,g-w "$CERTS_DIR"` and `chmod 0700` the dirs / `0600` the keys.
