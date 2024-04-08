import fs from "fs";
import { homedir } from "os";

const path_file = "path-config.json";
const default_path = homedir() + "/.relayer";

export function GetPathConfig() {
  if (!fs.existsSync(path_file)) {
    const data = `{"path": "${default_path}"}`;
    fs.writeFileSync(path_file, data);
  }

  const rawData = fs.readFileSync(path_file, { encoding: "utf8", flag: "r" });
  const data = JSON.parse(rawData);
  return data.path;
}

export function UpdatePathConfig(newPathConfig: string) {
  const rawData = fs.readFileSync(path_file, { encoding: "utf8", flag: "r" });
  let data = JSON.parse(rawData);
  data.path = newPathConfig;
  fs.writeFileSync(path_file, JSON.stringify(data));
}
