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
        // pokud je v aktuálním gitu rozdělaná (staged) práce upozorní na to a ukončí běh
        const stagedCount = runCommandOrDie(`git diff --cached --numstat | wc -l`);
        if (parseInt(stagedCount)) {
            this.rl.write(`Nejprve si ukliďte, máte v repozitáři rozpracované (stashed) soubory.\n`);

            this.stop();

            return;
        }

        // pokud je branch jiná než `master`, nabídne merge
        const currentBranch = runCommandOrDie(`git rev-parse --abbrev-ref HEAD`);
        if (currentBranch != 'master') {
            const answer: string = await new Promise(resolve => {
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
            this.rl.write(`Verze v package.json (${packageVersion}) neodpovídá tagu (${currentTag})!`);
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

        // rozparsování verze
        this.version = new Version(currentTag);

        //   zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_). Výchozí hodnotu skript odhadne podle commitů
        const versionMajor = this.version.raise(VersionPart.Major).getTag();
        const versionMinor = this.version.raise(VersionPart.Minor).getTag();
        const versionPatch = this.version.raise(VersionPart.Patch).getTag();
        const answer: string = await new Promise(resolve => {
            this.rl.question(`Jakým způsobem se má zvednout verze ${currentTag}? 1. major (${versionMajor}), 2. feat/minor (${versionMinor}), 3.fix/patch (${versionPatch}) [3]`, resolve)
        });

        let targetVersion: string;
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

        this.rl.write(`OK, bude to ${targetVersion}\n`);

        //   do changelogu přidá řádek s aktuálním datumem se všemi commity, které se pokusí seskupit podle modulu

        const commitList = runCommandOrDie(`git rev-list ${currentTag}..HEAD --oneline`);
        this.rl.write(`Toto jsou commity od posledního tagu:\n` + commitList + "\n");

        //   aktualizuje version v package.json
        const versionReplace = runCommandOrDie(`perl -i -lpe '$k+= s/"v${this.version.major}\.${this.version.minor}\.${this.version.patch}"/"${targetVersion}"/g; END{print "$k"}' package.json`);
        if (versionReplace != "1") {
            this.rl.write(`Nepodařilo se aktualizovat verzi v package.json!`);
            this.stop();
            return;
        }

        //   commit a tag verze
        // const commandCommit = runCommandOrDie(`git add package.json && git commit -m "${targetVersion}" && git tag ${targetVersion}`)

        //   push commitu i s tagy `git push --atomic origin master <tag>`
        // const pushCommit = runCommandOrDie(`git push --atomic origin master ${targetVersion}`)

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
