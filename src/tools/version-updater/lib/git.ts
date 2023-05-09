import { execSync } from "child_process";

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

export function canPull(): boolean {
    runCommandOrDie(`git fetch origin`);

    const aheadBehind = runCommandOrDie(
        `git rev-list --left-right --count master...origin/master`
    );
    const regex = new RegExp("^(\\d*)\\t(\\d*)$", "gm");
    let ahead, behind: number;
    let m;
    if ((m = regex.exec(aheadBehind)) !== null) {
        if (m.index === regex.lastIndex) {
            regex.lastIndex++;
        }
        ahead = parseInt(m[1]);
        behind = parseInt(m[2]);
    }

    if (behind !== 0) {
        const changesOnOrigin = runCommandOrDie(
            `git diff master..origin/master~${behind} --name-only`
        );
        const changesOnLocal = runCommandOrDie(
            `git diff master~${ahead}..origin/master --name-only`
        );

        const changes: string[] = changesOnOrigin
            .split(`\n`)
            .filter((item) => item.length)
            .concat(...changesOnLocal.split(`\n`).filter((item) => item.length));

        return changes.length !== new Set(changes).size;
    }
    return true;
}

export function pull(): boolean {
    const result = runCommandOrDie(`git pull --quiet`, true);
    return result === "0";
}

export function merge(currentBranch: string): boolean {
    const result = runCommandOrDie(`git merge ${currentBranch}--quiet`, true);
    return result === "0";
}

export function checkout(): boolean {
    const result = runCommandOrDie(`git checkout master --quiet`, true);
    return result === "0";
}

export function getStagedCount(): number {
    const result = runCommandOrDie(`git diff --cached --numstat | wc -l`);
    return parseInt(result);
}

export function getCurrentBranch(): string {
    return runCommandOrDie(`git rev-parse --abbrev-ref HEAD`);
}

export function getCurrentTag(): string {
    return runCommandOrDie(`git describe --tags --abbrev=0`);
}

export function getUntaggedCount(currentTag: string): number {
    const result = runCommandOrDie(`git rev-list ${currentTag}..HEAD | wc -l`);
    return parseInt(result);
}

export function getCommitList(currentTag: string): string {
    return runCommandOrDie(`git rev-list ${currentTag}..HEAD --oneline`);
}

export function stashSave(): boolean {
    const result = runCommandOrDie(`git stash save --keep-index`);
    return result.startsWith("Saved");
}
export function stashPop(): void {
    runCommandOrDie(`git stash pop`);
}

export function add(filename: string): void {
    runCommandOrDie(`git add ${filename}`);
}

export function commitTag(targetVersion: string): void {
    runCommandOrDie(
        `git commit -m "${targetVersion}" && git tag ${targetVersion}`
    );
}

export function pushCommitTag(targetVersion: string): void {
    runCommandOrDie(`git push --atomic origin master ${targetVersion}`);
}
