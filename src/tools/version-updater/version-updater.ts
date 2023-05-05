import * as readline from 'readline';
import { execSync } from 'child_process';
import { Version, VersionPart } from './lib/version';

interface AnalyzedCommits {
    [moduleName: string]: {
        [versionPart: string]: string[]
    }
}

export class VersionUpdater {
    private rl: readline.Interface;
    private version: Version;

    constructor() {
        this.rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
    }

    async start() {
        let answer: string;
        let targetVersion: string;

        // pokud je v aktuálním gitu rozdělaná (staged) práce upozorní na to a ukončí běh
        if (this.getStagedCount()) {
            this.rl.write(`Nejprve si ukliďte, máte v repozitáři rozpracované (staged) soubory.\n`);
            return this.stop();
        }

        // pokud je branch jiná než `master`, nabídne merge
        const currentBranch = this.getCurrentBranch();
        if (currentBranch != 'master') {
            answer = await new Promise(resolve => {
                this.rl.question(`Jste ve větvi ${currentBranch}. Chcete pokračovat v master větvi a aktuální větev zmergeovat? [a/N] `, resolve)
            });
            switch (answer.toLowerCase()) {
                case 'a':
                    if (!this.checkout()) {
                        this.rl.write(`Checkout nelze provést.\n`);
                        return this.stop();
                    }
                    if (!this.canPull()) {
                        this.rl.write(`Na serveru jsou změny nad commitnutými soubory. Proveďte nejprve git pull.\n`);
                        return this.stop();
                    }
                    if (!this.pull()) {
                        this.rl.write(`Pull nelze provést.\n`);
                        return this.stop();
                    }
                    if (!this.merge(currentBranch)) {
                        this.rl.write(`Merge nelze provést.\n`);
                        return this.stop();
                    }
                    break;
                case 'n':
                default:
                    this.rl.write(`OK, ukončeno zásahem uživatele.\n`);
                    return this.stop();
            }
        } else {
            if (!this.canPull()) {
                this.rl.write(`Na serveru jsou změny nad ovlivněnými soubory. Proveďte nejprve git pull.\n`);
                return this.stop();
            }
            if (!this.pull()) {
                this.rl.write(`Pull nelze provést.\n`);
                return this.stop();
            }
        }

        const currentTag = this.getCurrentTag();

        // kontrola, že aktuální verze sedí s verzí v package.json
        const packageVersion = require("../../../package.json").version;
        if (currentTag != packageVersion) {
            this.rl.write(`Verze v package.json (${packageVersion}) neodpovídá tagu (${currentTag}).\n`);
            return this.stop();
        }

        // kontrola, že je na masteru od posledního tagu nějaký nezatagovaný commit
        if (!this.getUntaggedCount(currentTag)) {
            this.rl.write(`V masteru není žádný nezatagovaný commit, není z čeho vyrábět novou verzi.\n`);
            return this.stop();
        }

        const commitList = this.getCommitList(currentTag);
        this.rl.write(`Commity od posledního tagu ${currentTag}:\n\n${commitList.replace(/^(\S{7,8})\s/gm, '    - $1: ')}\n\n`);

        // rozparsování verze
        this.version = new Version(currentTag);

        // zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_).
        const versionMajor = this.version.raise(VersionPart.Major).getTag();
        const versionMinor = this.version.raise(VersionPart.Minor).getTag();
        const versionPatch = this.version.raise(VersionPart.Patch).getTag();
        answer = await new Promise(resolve => {
            this.rl.question(`Jakým způsobem se má zvednout verze ${currentTag}?\n    1. major <${versionMajor}>\n    2. minor <${versionMinor}>\n    3. patch <${versionPatch}>\n(1/2/3) [3] `, resolve)
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
        this.rl.write(`Náhled zápisu do changelogu:\n\n    ${changelog.replace(/\n/gm, `\n    `)}\n\n`);

        answer = await new Promise(resolve => {
            this.rl.question(`Pokračovat k zápisu a odeslání na server? (a/N) `, resolve)
        });
        switch (answer.toLowerCase()) {
            case 'a':
                break;
            case 'n':
            default:
                this.rl.write(`Přerušeno na žádost uživatele, v repozitáři nebyly provedeny žádné změny.\n`);
                return this.stop();
        }

        const stashed = this.stashSave();

        // aktualizuje version v package.json
        if (this.updatePackageJson(targetVersion)) {
            this.rl.write(`Nepodařilo se aktualizovat verzi v package.json.\n`);
            if (stashed) {
                this.stashPop();
            }
            return this.stop();
        }
        this.add(`package.json`);

        // záznam v changelogu
        this.updateChangelog(changelog);
        this.add(`CHANGELOG.md`);

        // commit a tag verze
        this.commitTag(targetVersion);

        if (stashed) {
            this.stashPop();
        }

        answer = await new Promise(resolve => {
            this.rl.question(`Verze ${targetVersion} je připravena, chcete ji pushnout? (a/N) `, resolve)
        });
        switch (answer.toLowerCase()) {
            case 'a':
                this.pushCommitTag(targetVersion)
                this.rl.write(`Je hotovo. Tag ${targetVersion} byl odeslán na server.\n`);
                break;
            case 'n':
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
        rows.push(`### ${targetVersion} (${now.toISOString().split('T')[0]})\n`);

        const analyzed = this.analyzeCommits(commitList);
        for (const moduleName in analyzed) {
            rows.push(...['chore', 'feat', 'fix'].map((versionPart) => this.getChangelogLine(analyzed, moduleName, versionPart)).filter(l => l != ""));
        }
        return rows.join(`\n`)
    }

    getChangelogLine(analyzed: AnalyzedCommits, moduleName: string, versionPart: string): string {
        let rows = [];
        if (versionPart in analyzed[moduleName]) {
            let row = `- **${versionPart}:** ` + moduleName;
            if (analyzed[moduleName][versionPart].length) {
                row += ' - ' + analyzed[moduleName][versionPart].join(', ');
            }
            rows.push(row);
        }
        return rows.filter(r => r).join(`\n`);
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

    canPull(): boolean {
        runCommandOrDie(`git fetch origin`);

        const aheadBehind = runCommandOrDie(`git rev-list --left-right --count master...origin/master`);
        const regex = new RegExp('^(\\d*)\\t(\\d*)$', 'gm');
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
            const changesOnOrigin = runCommandOrDie(`git diff master..origin/master~${behind} --name-only`)
            const changesOnLocal = runCommandOrDie(`git diff master~${ahead}..origin/master --name-only`)

            const changes: string[] = changesOnOrigin.split(`\n`).filter(item => item.length).concat(...changesOnLocal.split(`\n`).filter(item => item.length));

            return (changes.length !== new Set(changes).size);
        }
        return true;
    }

    pull(): boolean {
        const result = runCommandOrDie(`git pull --quiet`, true);
        return result === '0';
    }

    merge(currentBranch: string): boolean {
        const result = runCommandOrDie(`git merge ${currentBranch}--quiet`, true);
        return result === '0';;
    }

    checkout(): boolean {
        const result = runCommandOrDie(`git checkout master --quiet`, true);
        return result === '0';
    }

    getStagedCount(): number {
        const result = runCommandOrDie(`git diff --cached --numstat | wc -l`);
        return parseInt(result);
    }

    getCurrentBranch(): string {
        return runCommandOrDie(`git rev-parse --abbrev-ref HEAD`);
    }

    getCurrentTag(): string {
        return runCommandOrDie(`git describe --tags --abbrev=0`);
    }

    getUntaggedCount(currentTag: string): number {
        const result = runCommandOrDie(`git rev-list ${currentTag}..HEAD | wc -l`)
        return parseInt(result);
    }

    getCommitList(currentTag: string): string {
        return runCommandOrDie(`git rev-list ${currentTag}..HEAD --oneline`);
    }

    stashSave(): boolean {
        const result = runCommandOrDie(`git stash save --keep-index`);
        return result.startsWith('Saved')
    }
    stashPop(): void {
        runCommandOrDie(`git stash pop`);
    }

    updateChangelog(newEntry: string): void {
        runCommandOrDie(`sed -n -i "p;2a ${newEntry.replace(/\n/gm, '\\n').replace(/(\"|\`)/gm, '\\$1').replace(/\`/gm, '\`')}\\n" CHANGELOG.md`)
    }

    add(filename: string): void {
        runCommandOrDie(`git add ${filename}`)
    }

    commitTag(targetVersion: string): void {
        runCommandOrDie(`git commit -m "${targetVersion}" && git tag ${targetVersion}`)
    }

    pushCommitTag(targetVersion: string): void {
        runCommandOrDie(`git push --atomic origin master ${targetVersion}`);
    }

    updatePackageJson(targetVersion: string): boolean {
        const result = runCommandOrDie(`perl -i -lpe '$k+= s/"v${this.version.major}\.${this.version.minor}\.${this.version.patch}"/"${targetVersion}"/g; END{print "$k"}' package.json`);
        return (result == "1");
    }
}

(async () => {
    const instance = new VersionUpdater();
    await instance.start();
})();

export function runCommandOrDie(command: string, returnOnError?: boolean): string {
    try {
        return execSync(command + (returnOnError ? " && echo $?" : "") + " | sed -z '$ s/\\n$//'").toString();
    } catch (e) {
        if (returnOnError) {
            return e.stderr.toString();
        } else {
            console.error(e.stderr.toString());
        }
    }
}
