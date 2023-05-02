# Version publisher

Nástroj pro vystavení nové verze.

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

## Jak to funguje

- Skript lze spustit, pokud jsou v aktuálním repozitáři rozpracované (staged) soubory.
- Ve vedlejší větvi skript nabídne checkout hlavní větve a merge původní, vedlejší větve.
- Pokud je v hlavní větví, aktualizuje si commity (`pull`)
- Skript lze spustit, pokud je na lokále od posledního tagu nějaký nezaverzovaný commit.
- Skript se zeptá, o kolik má zvednout verzi (_major_, _feat/minor_ nebo _fix/patch_).
  - _TODO: výchozí hodnotu odhadne podle commitů_
- Skript navrhne uživateli nový záznam changelogu pro nový tag.
  - _TODO: seskupí commity podle modulu_
- V případě schválení uživatelem skript aktualizuje `package.json`, `CHANGELOG.md`, provede commit verze, tag verze, push commitu i s tagem.
