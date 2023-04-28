import * as readline from 'readline';
import { exec, execSync } from 'child_process';

export class VersionUpdater {
    private rl: readline.Interface;

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
            this.rl.write('Nejprve si ukliďte, máte v repozitáři rozpracované (stashed) soubory.');

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
                        this.rl.write('Checkout nelze provést, já radši končím.');
                        this.stop();
                        return;
                    }
                    const pullResult = runCommandOrDie(`git pull --quiet`, true);
                    if (pullResult != '0') {
                        this.rl.write('Pull nelze provést, já radši končím.');
                        this.stop();
                        return;
                    }
                    const mergeResult = runCommandOrDie(`git merge ${currentBranch}--quiet`, true);
                    if (mergeResult != '0') {
                        this.rl.write('Merge nelze provést, já radši končím.');
                        this.stop();
                        return;
                    }
                    break;
                case 'n':
                default:
                    this.rl.write('OK, tak já radši končím.');
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
            this.rl.write('V masteru není žádný nezatagovaný commit, není z čeho vyrábět novou verzi. Končím.');
            this.stop();
            return;
        }

        //   zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_). Výchozí hodnotu skript odhadne podle commitů
        //   do changelogu přidá řádek s aktuálním datumem se všemi commity, které se pokusí seskupit podle modulu
        //   commit verze `git commit -m "<tag>"`
        //   tag verze `git tage <tag>`
        //   push commitu i s tagy `git push --atomic origin master <tag>`


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