const MAX_ARCHIVE = 256 * 1024 * 1024;
const MAX_LISTING_LINES = 50000;
const FORMATS = [
    [".zip", "zip", [0x50, 0x4B, 0x03, 0x04]],
    [".rar", "rar", [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 0]],
    [".rar", "rar5", [0x52, 0x61, 0x72, 0x21, 0x1A, 0x07, 1, 0]],
    [".7z", "7z", [0x37, 0x7A, 0xBC, 0xAF, 0x27, 0x1C]],
];

export function symbian_worker_asset(name)
{
    const worker = new URL(globalThis.location.href);
    const asset = new URL(name, worker);
    asset.search = worker.search;
    return asset.href;
}

/** Read only selected, bounded entries inside the archive worker's virtual filesystem. */
export async function open_symbian_archive(file)
{
    if(!file?.size || file.size > MAX_ARCHIVE)
        throw new Error("Choose a Nokia 5800 firmware archive up to 256 MiB");
    const signature = new Uint8Array(await file.slice(0, 8).arrayBuffer());
    const format = FORMATS.find(([extension, , bytes]) =>
        file.name.toLowerCase().endsWith(extension) && bytes.every((byte, index) => signature[index] === byte));
    if(!format) throw new Error("Choose a valid ZIP, RAR or 7z firmware archive");
    const [, type] = format;
    const stdout = [];
    const print = line => {
        if(stdout.length === MAX_LISTING_LINES) throw new Error("The firmware archive contains too many entries");
        stdout.push(line);
    };
    const { default: create_decoder } = await import(symbian_worker_asset("symbian-archive.js"));
    const decoder = await create_decoder({
        locateFile: () => symbian_worker_asset("symbian-archive.wasm"),
        print, printErr: print,
        stdin: () => null,
    });
    const fs = decoder.FS;
    fs.mkdir("/input");
    fs.mount(fs.filesystems.WORKERFS, { blobs: [{ name: "firmware", data: file }] }, "/input");
    const input = "/input/firmware";
    const flags = ["-t" + type, "-bd", "-bsp0", "-sccUTF-8"];
    if(decoder.callMain(["l", "-slt", "-ba", ...flags, input]))
        throw new Error("Could not read the firmware archive. Choose a complete ZIP, RAR or 7z without a password");
    const entries = stdout.join("\n").split(/\n\n+/).flatMap(block => {
        const path = /^Path = (.+)$/m.exec(block)?.[1]?.replace(/\\/g, "/");
        if(!path || /^Folder = \+$/m.test(block)) return [];
        const size = Number(/^Size = (\d+)$/m.exec(block)?.[1]);
        const directory = path.slice(0, path.lastIndexOf("/") + 1);
        const name = path.slice(directory.length);
        return [{ path, directory, name, size, unsafe: /^(?:Encrypted = \+|Symbolic Link = |Hard Link = )/m.test(block) }];
    });

    function extract(selected)
    {
        for(const entry of selected)
        {
            if(entry.unsafe || !Number.isSafeInteger(entry.size) || entry.size <= 0 || entry.size > MAX_ARCHIVE ||
                entry.path.length > 4096 || /[\u0000-\u001F\u007F]/.test(entry.path) || /^[\/@-]/.test(entry.path) ||
                entry.path.split("/").some(part => part === "" || part === "." || part === ".."))
                throw new Error("Invalid or encrypted archive entry " + entry.name);
        }
        if(selected.reduce((size, entry) => size + entry.size, 0) > MAX_ARCHIVE)
            throw new Error("Extracted firmware exceeds 256 MiB");
        stdout.length = 0;
        if(decoder.callMain(["e", "-y", "-spd", "-o/output", ...flags, "--", input, ...selected.map(entry => entry.path)]))
            throw new Error("Could not extract the firmware files. The archive may be damaged");
        return selected.map(entry => {
            const name = "/output/" + entry.name;
            if(!fs.analyzePath(name).exists || !fs.isFile(fs.lstat(name).mode))
                throw new Error("The archive did not contain a regular file for " + entry.name);
            const bytes = fs.readFile(name);
            fs.unlink(name);
            if(bytes.length !== entry.size) throw new Error("Incorrect extracted size for " + entry.name);
            return bytes;
        });
    }
    return { entries, extract };
}
