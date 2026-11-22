import { delete_disk, disk_path, finish_disk, make_room } from "./browser_disks.js";
import { new_symbian_config } from "./vm_config.js";
import { query_append } from "./emulator_bridge.js";
import { SYBORG_DEVICE, SYBORG_MEDIA } from "../symbian/catalog.js";

const IMPORT_LOCK = "v86-symbian-firmware-import";
const IMPORT_DIR = "symbian-imports";
const VM_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

function worker_request(message, options)
{
    options.signal?.throwIfAborted();
    const worker = new Worker("build/symbian-import-worker.js" + query_append(), { type: "module" });
    return new Promise((resolve, reject) => {
        const close = () => {
            worker.terminate();
            options.signal?.removeEventListener("abort", abort);
        };
        const abort = () => {
            close();
            reject(options.signal.reason);
        };
        const fail = error => { close(); reject(error); };
        options.signal?.addEventListener("abort", abort);
        worker.onmessage = ({ data }) => {
            if(data.progress) { options.progress?.(data.progress); return; }
            close();
            if(data.error) reject(new Error(data.error));
            else resolve(data.result);
        };
        worker.onerror = event => fail(new Error(event.message || "The Symbian firmware worker could not start"));
        worker.onmessageerror = () => fail(new Error("The Symbian firmware worker returned unreadable data"));
        try
        {
            worker.postMessage(message);
        }
        catch(error) { fail(error); }
    });
}

export function check_syborg_package(file, options = {})
{
    return worker_request({ op: "check-syborg", file }, options);
}

async function import_directory(create)
{
    let directory = await navigator.storage.getDirectory();
    try
    {
        directory = await directory.getDirectoryHandle("v86", { create });
        return await directory.getDirectoryHandle(IMPORT_DIR, { create });
    }
    catch(error)
    {
        if(create || error.name !== "NotFoundError") throw error;
        return null;
    }
}

function media_ids(vm_id, roles)
{
    return Object.fromEntries(roles.map(role => [role, vm_id + "-symbian-" + role]));
}

async function discard_import(ids)
{
    // A terminated worker can briefly hold an OPFS synchronous access handle.
    for(const id of Object.values(ids))
    {
        for(let attempt = 0; ; attempt++)
        {
            try
            {
                await delete_disk(id);
                break;
            }
            catch(error)
            {
                if(attempt === 9) throw error;
                await new Promise(resolve => setTimeout(resolve, 50));
            }
        }
    }
}

export async function recover_symbian_imports(store)
{
    if(!navigator.storage?.getDirectory || !navigator.locks) return;
    await navigator.locks.request(IMPORT_LOCK, { ifAvailable: true }, async lock => {
        if(!lock) return;
        const directory = await import_directory(false);
        if(!directory) return;
        for await (const [id, handle] of directory.entries())
        {
            if(handle.kind !== "file" || !VM_ID.test(id)) continue;
            if(!(await store.get(id))?.symbian)
                await discard_import(media_ids(id, Object.keys(SYBORG_MEDIA)));
            await directory.removeEntry(id);
        }
    });
}

export async function import_syborg_package(file, expected, name, notes, options)
{
    if(!navigator.storage?.getDirectory || !navigator.locks)
    {
        throw new Error("Importing Symbian firmware needs browser private storage and Web Locks");
    }
    return navigator.locks.request(IMPORT_LOCK, { signal: options.signal }, async () => {
        const required = Object.values(expected.media).reduce((sum, disk) => sum + disk.size, 0);
        await make_room(required, options.store);
        options.signal?.throwIfAborted();
        const config = new_symbian_config(name, notes);
        const ids = media_ids(config.id, Object.keys(expected.media));
        const manifest = expected.manifest;
        const journal = await import_directory(true);
        await journal.getFileHandle(config.id, { create: true });
        let stored;
        try
        {
            await worker_request({ op: "import-syborg", file, expected, ids }, options);
            const media = {};
            for(const [role, { size, sha256 }] of Object.entries(expected.media))
            {
                options.signal?.throwIfAborted();
                const id = ids[role];
                const disk = await finish_disk(id, name + " · " + SYBORG_MEDIA[role], {
                    size, sha256, symbian: { owner: config.id, role }, source: manifest,
                });
                if(disk.size !== size) throw new Error("Incorrect stored size for " + SYBORG_MEDIA[role]);
                media[role] = { kind: "browser", path: disk_path(id), size, sha256 };
            }
            options.signal?.throwIfAborted();
            config.symbian = { device: SYBORG_DEVICE.id, model: SYBORG_DEVICE.model, sw_version: expected.firmware_version,
                manifest, manifest_sha256: media.manifest.sha256, media, webgpu: true };
            options.signal?.throwIfAborted();
            stored = await options.store.put(config);
        }
        catch(error)
        {
            await discard_import(ids);
            await journal.removeEntry(config.id);
            throw error;
        }
        // A journal entry left after commit is harmless. Recovery preserves its disks.
        await journal.removeEntry(config.id).catch(() => {});
        return stored;
    });
}
