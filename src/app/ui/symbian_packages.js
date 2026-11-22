// @ts-check
import { h, replace } from "./dom.js";
import { sis_card_files } from "../../symbian/sis_card.js";

/** @param {Awaited<ReturnType<typeof sis_card_files>>} packages */
export function package_paths(packages)
{
    return h("ul", null, packages.map(({ file, path }) => h("li", null, file.name, " → ", h("code", null, path))));
}

export const SYBORG_INSTALL_HELP = "In Symbian File manager, copy the package from E:\\INSTALL to the Phone memory root folder. Select the copied file and use Open selected file.";

/**
 * @param {(packages: Awaited<ReturnType<typeof sis_card_files>>) => Promise<void>} attach
 * @param {{name: string, firmware: string}} device
 */
export function show_sis_transfer(attach, device)
{
    return new Promise(resolve => {
        const element = /** @type {HTMLDialogElement} */ (h("dialog.dialog.sis-transfer", { "aria-labelledby": "sis-transfer-title" }));
        const input = /** @type {HTMLInputElement} */ (h("input", { type: "file", accept: ".sis,.sisx", multiple: true }));
        const paths = h("div"), status = h("p", { role: "status" });
        let controller = new AbortController(), busy = false;
        /** @type {Awaited<ReturnType<typeof sis_card_files>>} */
        let packages = [];
        const close = () => { controller.abort(); element.close(); element.remove(); resolve(undefined); };
        const cancel = /** @type {HTMLButtonElement} */ (h("button", { type: "button", onclick: close }, "Cancel"));
        const use = /** @type {HTMLButtonElement} */ (h("button.primary", { type: "button", disabled: true, onclick: async () => {
            if(busy || !packages.length) return;
            busy = input.disabled = cancel.disabled = use.disabled = true;
            status.textContent = "Writing the transfer card…";
            try
            {
                await attach(packages);
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
            packages = [];
            use.disabled = true;
            replace(paths);
            status.textContent = files.length ? "Checking packages…" : "";
            if(!files.length) return;
            try
            {
                const result = await sis_card_files(files, signal);
                if(signal.aborted) return;
                packages = result;
                replace(paths, package_paths(packages));
                status.textContent = "";
                use.disabled = false;
            }
            catch(error)
            {
                if(!signal.aborted) status.textContent = error.message;
            }
        };
        element.append(h("form", { method: "dialog", onsubmit: event => event.preventDefault() },
            h("h2#sis-transfer-title", null, "Send SIS/SISX to " + device.name),
            h("div.dialog-body", null,
                h("p.note", null, "Firmware " + device.firmware),
                h("p", null, "Save any open work to C: first. Saving this card replaces the temporary E: drive and powers off the VM. Start it again to use the card."),
                h("p", null, SYBORG_INSTALL_HELP),
                h("p.note", null, "Symbian handles installation and decides whether to accept each package."),
                h("label.field", null, h("span", null, "Local SIS/SISX packages"), input), paths, status),
            h("div.dialog-buttons", null, cancel, use)));
        element.addEventListener("cancel", event => { event.preventDefault(); if(!busy) close(); });
        document.body.append(element);
        element.showModal();
        input.focus();
    });
}
