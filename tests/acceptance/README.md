# Acceptance records

These versioned records describe completed runs, their inputs, results and
limitations. They are historical evidence; they do not replace a fresh test run.

- [D3D and graphics proxy acceptance](d3d/)
- [GTA SA buffer-map ordering regression](d3d/gtasa-buffer-map-ordering-20261117.json)
- [NV40 acceptance](nv40/)
- [Site-specific acceptance and image deployments](../../../retro-gaming-site/tests/acceptance/)

Fixed test inputs belong beside their tests, including the
[D3D7 native references and image samples](../glbridge/fixtures/d3d-review/).
Markdown explanations and plans belong in `docs/`. Large logs, captures and
private guest images remain in ignored local build directories.

## Archive relocation

The JSON and compressed image payloads were moved without changing their bytes.
Embedded paths, commands, commits and hashes describe the original capture's
checkout and remain part of that evidence. Current test and documentation paths
use the new locations:

- Former `docs/fixtures/d3d-review/` results are in `d3d/`; its D3D7 native
  reference inputs are in `tests/glbridge/fixtures/d3d-review/`.
- Former `docs/fixtures/nv40/` records are in `nv40/`.
- The site's former `docs/d3d-stage6-*-validation.json` files were identical
  copies of the corresponding `d3d/stage6-*-validation.json` records here.
- Identical site copies formerly under `glbridge/deployments/` were also
  removed. Site-specific records remain in the site acceptance directory linked
  above. Each shared record has a single canonical copy in this repository.
