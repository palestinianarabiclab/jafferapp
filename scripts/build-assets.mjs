import { readdirSync, statSync, readFileSync } from "node:fs";
import { join } from "node:path";

console.log("⚡ Checking asset bundle statistics...");

const rootDir = process.cwd();
const targetFiles = [
    "index.html",
    "styles.css",
    "js/booking-app.js",
    "js/google-calendar.js",
    "js/apps-script-sync.js"
];

let totalSizeBytes = 0;

for (const relativePath of targetFiles) {
    try {
        const fullPath = join(rootDir, relativePath);
        const stats = statSync(fullPath);
        const sizeKb = (stats.size / 1024).toFixed(2);
        totalSizeBytes += stats.size;
        console.log(`  - ${relativePath.padEnd(25)} : ${sizeKb} KB`);
    } catch (err) {
        console.warn(`  - Warning: Could not read ${relativePath}: ${err.message}`);
    }
}

const totalKb = (totalSizeBytes / 1024).toFixed(2);
console.log(`\n Total Core Assets Size: ${totalKb} KB`);
console.log(" Asset verification complete.");
