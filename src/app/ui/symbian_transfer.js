// @ts-check
import { h, replace } from "./dom.js";
import { transfer_card_files } from "../../symbian/transfer_card.js";

/** @param {Awaited<ReturnType<typeof transfer_card_files>>} files */
export function transfer_paths(files)
{
    return h("ul", null, files.map(({ path }) => h("li", null, h("code", null, path))));
}

export const SYBORG_TRANSFER_HELP = "In Symbian File manager, look in E:\\Transfer for files and E:\\INSTALL for SIS/SISX packages.";
const INSTALL_HELP = "To install a package, copy it from E:\\INSTALL to the Phone memory root. Select the copy and use Open selected file.";

/**
 * @param {(files: Awaited<ReturnType<typeof transfer_card_files>>) => Promise<void>} attach
 * @param {string} device_name
 */
export function show_file_transfer(attach, device_name)
{
    return new Promise(resolve => {
        const element = /** @type {HTMLDialogElement} */ (h("dialog.dialog.file-transfer", { "aria-labelledby": "file-transfer-title" }));
        const input = /** @type {HTMLInputElement} */ (h("input", { type: "file", multiple: true }));
        const paths = h("div"), status = h("p", { role: "status" });
        let controller = new AbortController(), busy = false;
        /** @type {Awaited<ReturnType<typeof transfer_card_files>>} */
        let selected = [];
        const close = () => { controller.abort(); element.close(); element.remove(); resolve(undefined); };
        const cancel = /** @type {HTMLButtonElement} */ (h("button", { type: "button", onclick: close }, "Cancel"));
        const use = /** @type {HTMLButtonElement} */ (h("button.primary", { type: "button", disabled: true, onclick: async () => {
            if(busy || !selected.length) return;
            busy = input.disabled = cancel.disabled = use.disabled = true;
            status.textContent = "Writing the transfer card…";
            try
            {
                await attach(selected);
                close();
            }
            catch(error)
            {
                status.textContent = error.message;
                busy = input.disabled = cancel.disabled = false;
                use.disabled = false;
            }
        } }, "Save card and power off"));
        input.onchange = async () => {
            controller.abort();
            const { signal } = controller = new AbortController();
            const files = Array.from(input.files || []);
            selected = [];
            use.disabled = true;
            replace(paths);
            status.textContent = files.length ? "Checking files…" : "";
            if(!files.length) return;
            try
            {
                const result = await transfer_card_files(files, signal);
                if(signal.aborted) return;
                selected = result;
                replace(paths, transfer_paths(selected), selected.some(file => file.folder === "INSTALL") && h("p.note", null, INSTALL_HELP));
                status.textContent = "";
                use.disabled = false;
            }
            catch(error)
            {
                if(!signal.aborted) status.textContent = error.message;
            }
        };
        element.append(h("form", { method: "dialog", onsubmit: event => event.preventDefault() },
            h("h2#file-transfer-title", null, "Send Files to " + device_name),
            h("div.dialog-body", null,
                h("p", null, "Save any open work to C: first. Saving this card replaces the temporary E: drive and powers off the VM. Start it again to open the files."),
                h("label.field", null, h("span", null, "Files"), input), paths, status),
            h("div.dialog-buttons", null, cancel, use)));
        element.addEventListener("cancel", event => { event.preventDefault(); if(!busy) close(); });
        document.body.append(element);
        element.showModal();
        input.focus();
    });
}
