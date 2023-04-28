# Version publisher

Nástroj pro vystavení nové verze Invipo Data Engine

## instalace

Přidat mezi skripty v `package.json`:

```json
{
    // …
    "scripts": {
        // …
        "update-version": "node ./dist/tools/version-updater/version-updater.js"
    }
}
```

Pro potřeby vývoje tohoto skriptu lze přidat i kompilaci:

```json
{
    // …
    "scripts": {
        // …
        "update-version-test": "tsc -p tsconfig-version-updater.json && npm run update-version"
    }
}
```

## spuštění

```shell
npm run update-version
```

## jak to funguje

-   každý krok musí potvrdit uživatel
-   pokud je v aktuálním gitu rozdělaná (staged) práce upozorní na to a ukončí běh
-   v branchi mimo master nabídne `git checkout master` a `git merge <původní branch>`
-   zkontroluje že je na masteru od posledního tagu nějaká nezaverzovaný comit
-   zeptá se, o kolik má zvednout verzi (_feat/major_ nebo _fix/patch_). Výchozí hodnotu skript odhadne podle comitů
-   do changelogu přidá řádek s aktuálním datumem se všemi commity, které se pokusí seskupit podle modulu
-   commit verze `git commit -m "<tag>"`
-   tag verze `git tage <tag>`
-   push commitu i s tagy `git push --atomic origin master <tag>`

```changelog
- ### v11.492.1 (2023-04-25)
- **fix:** Violations - datasety ViolationRegister.V2.ViolationOptions, ViolationRegister.Violation.List - filtrování bez date range
```

