import { list_fat16_directory, read_fat16_file, read_fat32_file } from "../lib/fat32_reader.mjs";
import { inspect_sis } from "../../src/symbian/sis.js";

const note_marker = "580086";
const uid = "e0860505";
const executable_sha256 = [
    "c8aabb187566c2ecd8be9ab37abd618e3f77fcf6501ee7a057414732cb3b8a95",
    "eebe8e2f6dca8e28a8e17ee195b6038b468171c575a1de0d414fd7508c2f89c2",
];
const resource_sha256 = [
    "4bf600c0a3c54cbb93aed89c73c677a6897a22dbd6561616669fcea6421a648c",
    "fd7bbbc64b77475156c4d7b721ad09461dfc05c85f60eb92d0a76262aa204c3d",
];
const controller_sha256 = [
    "88913b0ddc94d8d80feb1aa91440ab109e3577e4dba1733fc7b4d8de2e6fb8a9",
    "b2da95a9c2c1d9a920c09ef1826199623a5728ffa5ea3d9f787feb61a5deb85c",
];
const installed_paths = [
    "sys/bin/v86_notes.exe",
    "private/10003a3f/import/apps/v86_notes_reg.rsc",
    "resource/apps/v86_notes_loc.rsc",
];
const host_image = "/build/syborg-s0/s4-acceptance/E.img";

async function digest(bytes)
{
    const hash = new Uint8Array(await crypto.subtle.digest("SHA-256", bytes));
    return Array.from(hash, byte => byte.toString(16).padStart(2, "0")).join("");
}

export async function load_transfer_card()
{
    const response = await fetch(host_image);
    if(!response.ok) throw new Error("Missing local Syborg SIS transfer card " + host_image);
    const card = await response.blob();
    for(const version of [1, 2])
    {
        const package_name = "V" + version + ".SIS";
        const bytes = await read_fat32_file(card, package_name);
        const checked_in = await fetch(new URL("./fixtures/notes-v" + version + ".sisx", import.meta.url));
        if(!bytes || !checked_in.ok || await digest(bytes) !== await digest(await checked_in.arrayBuffer()))
            throw new Error("Wrong package in the local transfer card: " + package_name);
        const pkg = await inspect_sis(new File([bytes], package_name));
        if(pkg.uid !== Number.parseInt(uid, 16)) throw new Error("Unexpected test package UID");
    }
    return card;
}

// Read the stopped or closed guest's own C: volume through a read-only File.
export async function check_installed_notes(file, version)
{
    const files = await Promise.all(installed_paths.map(path => read_fat16_file(file, path)));
    const note = await read_fat16_file(file, "private/" + uid + "/note.txt");
    const registry_path = "sys/install/sisregistry/" + uid;
    const entries = await list_fat16_directory(file, registry_path);
    const controllers = entries?.filter(entry => /\.ctl$/i.test(entry.name)) || [];
    const registrations = entries?.filter(entry => /\.reg$/i.test(entry.name)) || [];
    if(!version)
    {
        if(files.some(Boolean) || note || controllers.length || registrations.length)
            throw new Error("v86 Notes still has files, saved data or an installation record on C:");
        return;
    }
    const expected = [executable_sha256[version - 1], ...resource_sha256];
    const hashes = await Promise.all(files.map(bytes => bytes && digest(bytes)));
    if(hashes.some((hash, index) => hash !== expected[index]))
        throw new Error("The v86 Notes " + version + ".0 executable or resources on C: did not match");
    if(controllers.length !== 1 || registrations.length !== 1)
        throw new Error("Expected one native v86 Notes installation record on C:");
    const [control, registration] = await Promise.all([controllers[0], registrations[0]].map(entry =>
        read_fat16_file(file, registry_path + "/" + entry.name)));
    const word = bytes => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(0, true);
    // The installed controller holds a length word followed by the signed SIS controller body.
    if(!control || control.length < 4 || word(control) !== control.length - 4 ||
        await digest(control.subarray(4)) !== controller_sha256[version - 1] ||
        !registration || registration.length < 4 || word(registration) !== Number.parseInt(uid, 16))
        throw new Error("The v86 Notes " + version + ".0 registry on C: did not match");
    if(!note || new TextDecoder().decode(note) !== note_marker)
        throw new Error("v86 Notes marker differs on C:");
}
