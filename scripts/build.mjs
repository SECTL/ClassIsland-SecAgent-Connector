import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const root = path.resolve(import.meta.dirname, "..");
const dist = path.join(root, "dist");
fs.rmSync(dist, { recursive: true, force: true });
fs.mkdirSync(dist, { recursive: true });
fs.copyFileSync(path.join(root, "main.mjs"), path.join(dist, "main.mjs"));
fs.copyFileSync(path.join(root, "secagent-plugin.json"), path.join(dist, "secagent-plugin.json"));
fs.cpSync(path.join(root, "skills"), path.join(dist, "skills"), { recursive: true });
const archive = new AdmZip();
archive.addLocalFolder(dist);
archive.writeZip(path.join(dist, "classisland-connector-1.0.0.zip"));
console.log("Created dist/classisland-connector-1.0.0.zip");
