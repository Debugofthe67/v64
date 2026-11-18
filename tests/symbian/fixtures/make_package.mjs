import { mkdirSync, writeFileSync } from "node:fs";
import { firmware_fixture } from "../fpsx_fixture.js";

const directory = new URL("../../../build/symbian/test-package/", import.meta.url);
// ARM probe entered by the fixture's normal XIP reset vector. Read the
// final page through CS0; only if its first cell is erased, unlock and
// program 0xA55A. Leave all other guest-visible cells alone and halt in a loop.
const bootstrap = Buffer.from(
    "4c009fe54c109fe5b010c0e1793ba0e3021ba0e3b010c3e13c409fe50010" +
    "a0e3b010c4e1015ba0e3b060d5e12c709fe5070056e10500001a2710a0e3" +
    "b010c4e11c109fe5b010c5e18010a0e3b010c4e1feffffea00e20100ff07" +
    "000040e40100ffff00005aa50000", "hex");
const { parts, manifest } = firmware_fixture(bootstrap);
mkdirSync(directory, { recursive: true });
const files = { ...parts, "RM505-test.vpl": manifest("059TEST"), "RM505-other.vpl": manifest("059OTHER") };
for(const [name, bytes] of Object.entries(files)) writeFileSync(new URL(name, directory), bytes);
writeFileSync(new URL("fixtures.json", directory), JSON.stringify(Object.keys(files)));
