import * as fs from "fs";
import * as path from "path";

const filepath = path.resolve(__dirname, "targets.json");
const data = JSON.parse(fs.readFileSync(filepath, "utf-8"));

const isRegisteredVals = new Set(data.map((row: any) => row.is_registered));
console.log("is_registered values in targets.json:", Array.from(isRegisteredVals));

const isRegisteredTextVals = new Set(data.map((row: any) => row.is_registered_text));
console.log("is_registered_text values in targets.json:", Array.from(isRegisteredTextVals));
