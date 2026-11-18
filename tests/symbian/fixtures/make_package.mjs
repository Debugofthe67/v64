import { mkdirSync, writeFileSync } from "node:fs";
import { firmware_fixture } from "../fpsx_fixture.js";

const directory = new URL("../../../build/symbian/test-package/", import.meta.url);
const { parts, manifest } = firmware_fixture();
mkdirSync(directory, { recursive: true });
const files = { ...parts, "RM505-test.vpl": manifest("059TEST"), "RM505-other.vpl": manifest("059OTHER") };
for(const [name, bytes] of Object.entries(files)) writeFileSync(new URL(name, directory), bytes);
writeFileSync(new URL("fixtures.json", directory), JSON.stringify(Object.keys(files)));
