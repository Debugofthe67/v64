// SPDX-License-Identifier: BSD-2-Clause
import { GLES_APIS } from "../../../src/gles/gles_protocol.js";
import { SYBORG_GLES_COMMANDS } from "../../../src/gles/syborg_transport.js";

for(const api of ["gles1", "gles2"])
{
    const { commands, base } = GLES_APIS[api];
    console.log("namespace " + api + " { enum {");
    commands.forEach(([name], index) => {
        if(SYBORG_GLES_COMMANDS.has(name)) console.log("    " + name + " = " + (base + index) + ",");
    });
    console.log("}; }");
}
