import { execSync } from "child_process";
import { Version } from "./version";

function runCommandOrDie(command: string, returnOnError?: boolean): string {
    try {
        return execSync(
            command + (returnOnError ? " && echo $?" : "") + " | sed -z '$ s/\\n$//'"
        ).toString();
    } catch (e) {
        if (returnOnError) {
            return e.stderr.toString();
        } else {
            console.error(e.stderr.toString());
        }
    }
}

export function updateChangelog(newEntry: string): void {
    runCommandOrDie(
        `sed -n -i "p;2a ${newEntry
            .replace(/\n/gm, "\\n")
            .replace(/(\"|\`)/gm, "\\$1")
            .replace(/\`/gm, "`")}\\n" CHANGELOG.md`
    );
}

export function updatePackageJson(
    targetVersion: string,
    version: Version,
    prefix = ''
): boolean {
    const result = runCommandOrDie(
        `perl -i -lpe '$k+= s/"${prefix}${version.major}\.${version.minor}\.${version.patch}"/"${prefix}${targetVersion}"/g; END{print "$k"}' package.json`
    );
    return result == "1";
}
