# Version updater

Nástroj, který zpracuje nezaverzované commity a připraví novou verzi kódu.

Po spuštění se zeptá, o kolik má zvednout verzi (_major_, _minor_ nebo _patch_), seskupí commity podle modulu a typu úpravy (_chore_/_feat_/_fix_) a navrhne uživateli zápis do changelogu.

V případě schválení uživatelem aktualizuje `package.json`, `CHANGELOG.md`, provede commit verze, tag verze, volitelně může provést push commitu i s tagem. Prefix verze se zachovává - tedy umožňuje, aby v tagu (a v changelogu) byla verze `v1.2.3` a v package.json verze `1.2.3`.

Skript lze spustit v případě, že existuje od posledního tagu nějaký nezaverzovaný commit a zároveň se aktuálním repozitáři nenachází žádné rozpracované (_staged_) soubory.

## Instalace

Mezi skripty v `package.json` stačí přidat:

```json
{
  // …
  "scripts": {
    // …
    "update-version": "node ./dist/tools/version-updater/version-updater.js"
  }
}
```

## Použití

Spouští se z linuxové příkazové řádky:

```shell
npm run update-version
```
