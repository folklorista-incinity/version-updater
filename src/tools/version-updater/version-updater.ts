import * as readline from "readline";
import { Version, VersionPart } from "./lib/version";
import {
    updateChangelog,
    updatePackageJson
} from "./lib/file"
import {
    add,
    canPull,
    checkout,
    commitTag,
    getCommitList,
    getCurrentBranch,
    getCurrentTag,
    getStagedCount,
    getUntaggedCount,
    merge,
    pull,
    pushCommitTag,
    stashPop,
    stashSave
} from "./lib/git";

interface AnalyzedCommits {
    [moduleName: string]: {
        [versionPart: string]: string[];
    };
}

export class VersionUpdater {
    private rl: readline.Interface;
    private version: Version;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout,
        });
    }

    async start() {
        let answer: string;
        let targetVersion: string;

        // pokud je v aktuálním gitu rozdělaná (staged) práce upozorní na to a ukončí běh
        if (getStagedCount()) {
            this.rl.write(
                `Nejprve si ukliďte, máte v repozitáři rozpracované (staged) soubory.\n`
            );
            return this.stop();
        }

        // pokud je branch jiná než `master`, nabídne merge
        const currentBranch = getCurrentBranch();
        if (currentBranch != "master") {
            answer = await new Promise((resolve) => {
                this.rl.question(
                    `Jste ve větvi ${currentBranch}. Chcete pokračovat v master větvi a aktuální větev zmergeovat? [a/N] `,
                    resolve
                );
            });
            switch (answer.toLowerCase()) {
                case "a":
                    if (!checkout()) {
                        this.rl.write(`Automatický checkout nelze provést.\n`);
                        return this.stop();
                    }
                    if (!canPull()) {
                        this.rl.write(
                            `Na serveru jsou změny nad commitnutými soubory. Proveďte nejprve git pull.\n`
                        );
                        return this.stop();
                    }
                    if (!pull()) {
                        this.rl.write(`Automatický pull nelze provést.\n`);
                        return this.stop();
                    }
                    if (!merge(currentBranch)) {
                        this.rl.write(`Automatický merge nelze provést.\n`);
                        return this.stop();
                    }
                    break;
                case "n":
                default:
                    this.rl.write(`OK, ukončeno zásahem uživatele.\n`);
                    return this.stop();
            }
        } else {
            if (!canPull()) {
                this.rl.write(
                    `Na serveru jsou změny nad ovlivněnými soubory. Proveďte nejprve git pull.\n`
                );
                return this.stop();
            }
            if (!pull()) {
                this.rl.write(`Automatický pull nelze provést.\n`);
                return this.stop();
            }
        }

        const currentTag = getCurrentTag();

        // kontrola, že aktuální verze sedí s verzí v package.json
        const packageVersion = require("../../../package.json").version;
        if (currentTag != packageVersion) {
            this.rl.write(
                `Verze v package.json (${packageVersion}) neodpovídá tagu (${currentTag}).\n`
            );
            return this.stop();
        }

        // kontrola, že je na masteru od posledního tagu nějaký nezatagovaný commit
        if (!getUntaggedCount(currentTag)) {
            this.rl.write(
                `V masteru není žádný nezatagovaný commit, není z čeho vyrábět novou verzi.\n`
            );
            return this.stop();
        }

        const commitList = getCommitList(currentTag);
        this.rl.write(
            `Commity od posledního tagu ${currentTag}:\n\n${commitList.replace(
                /^(\S{7,8})\s/gm,
                "    - $1: "
            )}\n\n`
        );

        // rozparsování verze
        this.version = new Version(currentTag);

        // zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_).
        const versionMajor = this.version.raise(VersionPart.Major).getTag();
        const versionMinor = this.version.raise(VersionPart.Minor).getTag();
        const versionPatch = this.version.raise(VersionPart.Patch).getTag();
        answer = await new Promise((resolve) => {
            this.rl.question(
                `Jakým způsobem se má zvednout verze ${currentTag}?\n`
                + `    1. major <${versionMajor}>\n`
                + `    2. minor <${versionMinor}>\n`
                + `    3. patch <${versionPatch}>\n`
                + `(1/2/3) [3=${versionPatch}] `,
                resolve
            );
        });
        switch (parseInt(answer)) {
            case VersionPart.Major:
                targetVersion = versionMajor;
                break;
            case VersionPart.Minor:
                targetVersion = versionMinor;
                break;
            case VersionPart.Patch:
            default:
                targetVersion = versionPatch;
        }

        // náhled changelogu
        const changelog = this.getChangelogEntry(commitList, targetVersion);
        this.rl.write(
            `Náhled zápisu do changelogu:\n\n    ${changelog.replace(
                /\n/gm,
                `\n    `
            )}\n\n`
        );

        answer = await new Promise((resolve) => {
            this.rl.question(
                `Pokračovat k zápisu a odeslání na server? (a/N) `,
                resolve
            );
        });
        switch (answer.toLowerCase()) {
            case "a":
                break;
            case "n":
            default:
                this.rl.write(
                    `Přerušeno na žádost uživatele, v repozitáři nebyly provedeny žádné změny.\n`
                );
                return this.stop();
        }

        const stashed = stashSave();

        // aktualizuje version v package.json
        if (!updatePackageJson(targetVersion, this.version)) {
            this.rl.write(`Nepodařilo se aktualizovat verzi v package.json.\n`);
            if (stashed) {
                stashPop();
            }
            return this.stop();
        }
        add(`package.json`);

        // záznam v changelogu
        updateChangelog(changelog);
        add(`CHANGELOG.md`);

        // commit a tag verze
        commitTag(targetVersion);

        if (stashed) {
            stashPop();
        }

        answer = await new Promise((resolve) => {
            this.rl.question(
                `Verze ${targetVersion} je připravena, chcete ji pushnout? (a/N) `,
                resolve
            );
        });
        switch (answer.toLowerCase()) {
            case "a":
                pushCommitTag(targetVersion);
                this.rl.write(
                    `Je hotovo. Tag ${targetVersion} byl odeslán na server.\n`
                );
                break;
            case "n":
            default:
        }

        return this.stop();
    }

    stop(): void {
        this.rl.close();
        return;
    }

    getChangelogEntry(commitList: string, targetVersion: string): string {
        let rows: string[] = [];

        const now = new Date();
        rows.push(`### ${targetVersion} (${now.toISOString().split("T")[0]})\n`);

        const analyzed = this.analyzeCommits(commitList);
        for (const moduleName in analyzed) {
            rows.push(
                ...["chore", "feat", "fix"]
                    .map((versionPart) =>
                        this.getChangelogLine(analyzed, moduleName, versionPart)
                    )
                    .filter((l) => l != "")
            );
        }
        return rows.join(`\n`);
    }

    getChangelogLine(
        analyzed: AnalyzedCommits,
        moduleName: string,
        versionPart: string
    ): string {
        let rows = [];
        if (versionPart in analyzed[moduleName]) {
            let row = `- **${versionPart}:** ` + moduleName;
            if (analyzed[moduleName][versionPart].length) {
                row += " - " + analyzed[moduleName][versionPart].join(", ");
            }
            rows.push(row);
        }
        return rows.filter((r) => r).join(`\n`);
    }

    analyzeCommits(commitList: string): AnalyzedCommits {
        const result: AnalyzedCommits = {};
        const regex = /^(\S{7,8})\s(fix|feat|chore):(\s*[^-\n]*)-?(.*)$/gm;
        let m;

        while ((m = regex.exec(commitList)) !== null) {
            if (m.index === regex.lastIndex) {
                regex.lastIndex++;
            }

            const versionPart = m[2].trim();
            const moduleName = m[3].trim();
            const message = m[4].trim();

            if (!(moduleName in result)) {
                result[moduleName] = {};
            }
            if (!(versionPart in result[moduleName])) {
                result[moduleName][versionPart] = [];
            }
            if (message.length) {
                result[moduleName][versionPart].push(message);
            }
        }

        return result;
    }
}

(async () => {
    const instance = new VersionUpdater();
    await instance.start();
})();
