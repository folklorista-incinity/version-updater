import * as readline from 'readline';
import { execSync } from 'child_process';
import { Version, VersionPart } from './lib/version';

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
        this.rl.write(`Commity od posledního tagu ${currentTag}:\n\n${commitList.replace(/^(\S{7})\s/gm, '    - $1: ')}\n\n`);

        // rozparsování verze
        this.version = new Version(currentTag);

        //   zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_). Výchozí hodnotu skript odhadne podle commitů
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
                targetVersion = versionMajor;
                break;
            case VersionPart.Patch:
            default:
                targetVersion = versionPatch;
        }

        // Náhled changelogu
        // TODO: pokusit se seskupit commity podle modulu
        const now = new Date();
        const changelog = `### ${targetVersion} (${now.toISOString().split('T')[0]})\n` + commitList.replace(/^(\S{7})\s(fix|feat|chore):/gm, '- **$2:**');
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

        runCommandOrDie(`git stash save --keep-index`);

        //   aktualizuje version v package.json
        const versionReplace = runCommandOrDie(`perl -i -lpe '$k+= s/"v${this.version.major}\.${this.version.minor}\.${this.version.patch}"/"${targetVersion}"/g; END{print "$k"}' package.json`);
        if (versionReplace != "1") {
            this.rl.write(`Nepodařilo se aktualizovat verzi v package.json.\n`);
            runCommandOrDie(`git stash pop`);
            this.stop();
            return;
        }
        runCommandOrDie(`git add package.json`);

        //   záznam v changelogu
        runCommandOrDie(`sed -n -i 'p;2a ${changelog.replace(/\n/gm, '\\n')}\\n' CHANGELOG.md`)
        runCommandOrDie(`git add CHANGELOG.md`)

        //   commit a tag verze
        runCommandOrDie(`git commit -m "${targetVersion}" && git tag ${targetVersion}`)

        runCommandOrDie(`git stash pop`);

        //   push commitu i s tagy `git push --atomic origin master <tag>`
        const pushCommit = runCommandOrDie(`git push --atomic origin master ${targetVersion}`)

        this.rl.write(`Je hotovo. Tag ${targetVersion} byl odeslán na server.\n`);
        this.stop();
    }

    stop() {
        this.rl.close();
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
