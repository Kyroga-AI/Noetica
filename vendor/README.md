# vendor/

Vendored third-party artifacts that are NOT available on the public npm registry.

## xlsx-0.20.3.tgz  (SheetJS)
The npm `xlsx` package is abandoned at 0.18.5, which carries CVE-2023-30533
(prototype pollution) and CVE-2024-22363 (ReDoS). SheetJS ships patched releases
only from their own CDN (https://cdn.sheetjs.com), not npm.

Rather than fetch from that CDN at build time (external dependency + drops the
package out of registry audit/mirroring), the patched tarball is committed here
and referenced via `"xlsx": "file:vendor/xlsx-0.20.3.tgz"` in package.json.

- Version: 0.20.3
- Source: https://cdn.sheetjs.com/xlsx-0.20.3/xlsx-0.20.3.tgz
- sha512: oLDq3jw7AcLqKWH2AhCpVTZl8mf6X2YReP+Neh0SJUzV/BdZYjth94tG5toiMB1PPrYtxOCfaoUCkvtuH+3AJA==

To update: download the new tarball from cdn.sheetjs.com, verify its sha512, drop
it here, bump the file: reference, and delete the old one.
