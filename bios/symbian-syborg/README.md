# Nokia 5800 Syborg assembly components

`syborg-5800-components.bin` contains the Syborg replacement binaries, device tree and XIP layout for RM-356 31.0.101. The importer takes the Nokia user-side XIP bytes and ROFS partitions from the user's firmware archive.

The component pack comes from the [pinned qembian source and dependency lock](https://github.com/emgfc/qembian/tree/aae8b5f4ecf4fccacac91b2b93a6a24df586d9bb). The [build instructions](https://github.com/speedyHKjournalist/v64/blob/2ac1033e7618613c3a16ba2b45e7fce734642abc/docs/symbian-syborg-reference.md#build-the-firmware-folder) identify the inputs and explain how to reproduce it with `tools/symbian/syborg.mjs components`. See [qembian's license notice](QEMBIAN-LICENSE.txt) for the applicable licenses and upstream sources.

`make pages` checks the SHA-256 in `tools/pages_dist.mjs` and publishes the binary at `build/syborg-5800-components.bin`. Update the hash when intentionally replacing the release asset.
