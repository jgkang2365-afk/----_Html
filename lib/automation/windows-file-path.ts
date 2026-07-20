import path from "path";
import { execFileSync } from "child_process";

type ResolveDialogPathOptions = {
  storageRoot?: string;
  uncRoot?: string;
  lookupMappedDrive?: (driveName: string) => string | null;
};

export function replaceWindowsPathRoot(
  filePath: string,
  sourceRoot: string,
  targetRoot: string
): string {
  if (!filePath || !sourceRoot || !targetRoot) return filePath;

  const normalizedFile = path.win32.normalize(filePath);
  const normalizedSource = path.win32.normalize(sourceRoot);
  const relative = path.win32.relative(normalizedSource, normalizedFile);

  if (relative === "") return path.win32.normalize(targetRoot);
  if (relative.startsWith("..") || path.win32.isAbsolute(relative)) return filePath;

  return path.win32.join(targetRoot, relative);
}

export function lookupWindowsMappedDrive(driveName: string): string | null {
  if (process.platform !== "win32" || !/^[A-Za-z]:$/.test(driveName)) return null;

  const command = `
$driveName = '${driveName.toUpperCase()}'
$network = New-Object -ComObject WScript.Network
$drives = $network.EnumNetworkDrives()
$mappedRoot = $null
for ($i = 0; $i -lt $drives.Count; $i += 2) {
    if ([string]::Equals([string]$drives.Item($i), $driveName, [System.StringComparison]::OrdinalIgnoreCase)) {
        $mappedRoot = [string]$drives.Item($i + 1)
        break
    }
}
if ($mappedRoot) {
    [Convert]::ToBase64String([Text.Encoding]::UTF8.GetBytes($mappedRoot))
}
`;

  try {
    const encodedCommand = Buffer.from(command, "utf16le").toString("base64");
    const encodedRoot = execFileSync(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-EncodedCommand", encodedCommand],
      { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }
    ).trim();
    return encodedRoot ? Buffer.from(encodedRoot, "base64").toString("utf8").trim() || null : null;
  } catch {
    return null;
  }
}

export function resolveWindowsDialogPath(
  filePath: string,
  options: ResolveDialogPathOptions = {}
): string {
  const storageRoot = options.storageRoot?.trim();
  const uncRoot = options.uncRoot?.trim();

  if (storageRoot && uncRoot) {
    const configuredPath = replaceWindowsPathRoot(filePath, storageRoot, uncRoot);
    if (configuredPath !== filePath) return configuredPath;
  }

  const driveMatch = /^([A-Za-z]:)[\\/]/.exec(filePath);
  if (!driveMatch) return filePath;

  const lookupMappedDrive = options.lookupMappedDrive || lookupWindowsMappedDrive;
  const mappedRoot = lookupMappedDrive(driveMatch[1]);
  if (!mappedRoot) return filePath;

  return replaceWindowsPathRoot(filePath, `${driveMatch[1]}\\`, mappedRoot);
}
