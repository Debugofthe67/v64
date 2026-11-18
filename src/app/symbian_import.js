import { delete_disk, disk_path, finish_disk, make_room } from "./browser_disks.js";
import { new_symbian_config } from "./vm_config.js";
import { query_append } from "./emulator_bridge.js";
import { N97_DEVICE, N97_MEDIA } from "../symbian/catalog.js";

const IMPORT_LOCK = "v86-symbian-firmware-import";
const IMPORT_DIR = "symbian-imports";
const VM_ID = /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/;

export const firmware_path = file => file.webkitRelativePath || file.name;

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
            const describe = file => ({ name: file.name, size: file.size, path: firmware_path(file), file });
            worker.postMessage({ ...message, files: message.files.map(describe), supplements: (options.supplements || []).map(describe) });
        }
        catch(error) { fail(error); }
    });
}

export function scan_symbian_packages(files, options = {})
{
    return worker_request({ op: "scan", files }, options);
}

export function check_symbian_package(files, selection, options = {})
{
    return worker_request({ op: "check", files, selection }, options);
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

function media_ids(vm_id)
{
    return Object.fromEntries(Object.keys(N97_MEDIA).map(role => [role, vm_id + "-symbian-" + role]));
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
        for await(const [id, handle] of directory.entries())
        {
            if(handle.kind !== "file" || !VM_ID.test(id)) continue;
            if(!(await store.get(id))?.symbian) await discard_import(media_ids(id));
            await directory.removeEntry(id);
        }
    });
}

export async function import_symbian_package(files, selection, expected, name, notes, options)
{
    if(!navigator.storage?.getDirectory || !navigator.locks)
    {
        throw new Error("Importing Symbian firmware needs browser private storage and Web Locks");
    }
    return navigator.locks.request(IMPORT_LOCK, { signal: options.signal }, async () => {
        const logical_size = Object.values(expected.media).reduce((sum, disk) => sum + disk.size, 0);
        await make_room(logical_size, options.store);
        options.signal?.throwIfAborted();
        const config = new_symbian_config(name, notes);
        const ids = media_ids(config.id);
        const { product_code, sw_version, variant_version, description, manifest, manifest_sha256 } = selection;
        const journal = await import_directory(true);
        await journal.getFileHandle(config.id, { create: true });
        let stored;
        try
        {
            await worker_request({ op: "import", files, selection, expected, ids }, options);
            const media = {};
            for(const [role, id] of Object.entries(ids))
            {
                options.signal?.throwIfAborted();
                const { size, sha256 } = expected.media[role];
                const disk = await finish_disk(id, name + " · " + N97_MEDIA[role], {
                    size, sha256, symbian: { owner: config.id, role }, source: manifest,
                });
                if(disk.size !== size) throw new Error("Incorrect stored size for " + N97_MEDIA[role]);
                media[role] = { kind: "browser", path: disk_path(id), size, sha256 };
            }
            config.symbian = { device: N97_DEVICE.id, model: N97_DEVICE.model,
                product_code, sw_version, variant_version, description, manifest, manifest_sha256, media, languages: expected.languages };
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
