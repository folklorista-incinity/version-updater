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
        const stagedCount = runCommandOrDie(`git diff --cached --numstat | wc -l`);
        if (parseInt(stagedCount)) {
            this.rl.write(`Nejprve si ukliďte, máte v repozitáři rozpracované (staged) soubory.\n`);

            this.stop();

            return;
        }

        // pokud je branch jiná než `master`, nabídne merge
        const currentBranch = runCommandOrDie(`git rev-parse --abbrev-ref HEAD`);
        if (currentBranch != 'master') {
            answer = await new Promise(resolve => {
                this.rl.question(`Jste ve větvi ${currentBranch}. Chcete pokračovat v master větvi a aktuální větev zmergeovat? [a/N] `, resolve)
            });

            switch (answer.toLowerCase()) {
                case 'a':
                    const checkoutResult = runCommandOrDie(`git checkout master --quiet`, true);
                    if (checkoutResult != '0') {
                        this.rl.write(`Checkout nelze provést, já radši končím.\n`);
                        this.stop();
                        return;
                    }
                    const pullResult = runCommandOrDie(`git pull --quiet`, true);
                    if (pullResult != '0') {
                        this.rl.write(`Pull nelze provést, já radši končím.\n`);
                        this.stop();
                        return;
                    }
                    const mergeResult = runCommandOrDie(`git merge ${currentBranch}--quiet`, true);
                    if (mergeResult != '0') {
                        this.rl.write(`Merge nelze provést, já radši končím.\n`);
                        this.stop();
                        return;
                    }
                    break;
                case 'n':
                default:
                    this.rl.write(`OK, tak já radši končím.\n`);
                    this.stop();
                    return;
            }
        } else {
            runCommandOrDie(`git fetch origin`);
            const aheadBehind = runCommandOrDie(`git rev-list --left-right --count master...origin/master`);
            if (aheadBehind !== "0	0") {
                this.rl.write(`Na serveru jsou změny. Proveďte git pull. Končím.\n`);
                this.stop();
                return;
            }
        }

        const currentTag = runCommandOrDie(`git describe --tags --abbrev=0`);

        // kontrola, že aktuální verze sedí s verzí v package.json
        const packageVersion = require("../../../package.json").version;
        if (currentTag != packageVersion) {
            this.rl.write(`Verze v package.json (${packageVersion}) neodpovídá tagu (${currentTag}).\n`);
            this.stop();
            return;
        }

        // kontrola, že je na masteru od posledního tagu nějaký nezatagovaný commit
        const untaggedCount = runCommandOrDie(`git rev-list ${currentTag}..HEAD | wc -l`)
        if (!parseInt(untaggedCount)) {
            this.rl.write(`V masteru není žádný nezatagovaný commit, není z čeho vyrábět novou verzi. Končím.\n`);
            this.stop();
            return;
        }

        const commitList: string = runCommandOrDie(`git rev-list ${currentTag}..HEAD --oneline`);
        this.rl.write(`Commity od posledního tagu ${currentTag}:\n\n${commitList.replace(/^(\S{7,8})\s/gm, '    - $1: ')}\n\n`);

        // rozparsování verze
        this.version = new Version(currentTag);

        // zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_). Výchozí hodnotu skript odhadne podle commitů
        const versionMajor = this.version.raise(VersionPart.Major).getTag();
        const versionMinor = this.version.raise(VersionPart.Minor).getTag();
        const versionPatch = this.version.raise(VersionPart.Patch).getTag();
        answer = await new Promise(resolve => {
            this.rl.question(`Jakým způsobem se má zvednout verze ${currentTag}?\n1. major <${versionMajor}>, 2. feat/minor <${versionMinor}>, 3.fix/patch <${versionPatch}> (1/2/3) [3] `, resolve)
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
                this.stop();
                return;
        }

        const stashed = runCommandOrDie(`git stash save --keep-index`).startsWith('Saved');

        // aktualizuje version v package.json
        const versionReplace = runCommandOrDie(`perl -i -lpe '$k+= s/"v${this.version.major}\.${this.version.minor}\.${this.version.patch}"/"${targetVersion}"/g; END{print "$k"}' package.json`);
        if (versionReplace != "1") {
            this.rl.write(`Nepodařilo se aktualizovat verzi v package.json.\n`);
            if (stashed) {
                runCommandOrDie(`git stash pop`);
            }
            this.stop();
            return;
        }
        runCommandOrDie(`git add package.json`);

        // záznam v changelogu
        runCommandOrDie(`sed -n -i "p;2a ${changelog.replace(/\n/gm, '\\n').replace(/(\"|\`)/gm, '\\$1').replace(/\`/gm, '\`')}\\n" CHANGELOG.md`)
        runCommandOrDie(`git add CHANGELOG.md`)

        // commit a tag verze
        runCommandOrDie(`git commit -m "${targetVersion}" && git tag ${targetVersion}`)

        if (stashed) {
            runCommandOrDie(`git stash pop`);
        }

        answer = await new Promise(resolve => {
            this.rl.question(`Verze ${targetVersion} je připravena, chcete ji pushnout? (a/N) `, resolve)
        });
        switch (answer.toLowerCase()) {
            case 'a':
                const pushCommit = runCommandOrDie(`git push --atomic origin master ${targetVersion}`)
                this.rl.write(`Je hotovo. Tag ${targetVersion} byl odeslán na server.\n`);
                break;
            case 'n':
            default:
        }

        this.stop();
        return;
    }

    stop() {
        this.rl.close();
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
